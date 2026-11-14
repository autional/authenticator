import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));

vi.mock('@autional/shared', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@autional/shared')>();
	return { ...actual, apiClient: { post: mockPost } };
});

import {
	PROOF_BEGIN_PATH,
	TICKET_PATH,
	buildMfaLoginUrl,
	computeMfaProof,
	hasMfaSsoFlag,
	startMfaSsoLogin,
	stripMfaSsoFlag,
	usableMfaAccounts,
	withMfaSsoFlag,
} from '../mfa-sso';
import { base32Decode } from '../totp';
import type { TotpAccount } from '../store';

// 已知答案（RFC 4648 / pyotp 文档里的经典样例）：JBSWY3DPEHPK3PXP → "Hello!\xde\xad\xbe\xef"。
// 测试里用它当**独立**基准：既不调用被测的 base32Decode，也不复用被测的 HMAC 封装。
const SECRET = 'JBSWY3DPEHPK3PXP';
const SECRET_BYTES = Buffer.from('Hello!\xde\xad\xbe\xef', 'latin1');

function expectedProof(challenge: string): string {
	return createHmac('sha256', SECRET_BYTES).update(challenge, 'utf8').digest('base64');
}

function mockTicketFlow(challenge = 'ch-1', ticket = 'tid.secret') {
	mockPost.mockImplementation((path: string) => {
		if (path === PROOF_BEGIN_PATH) {
			return Promise.resolve({ data: { challenge, expiresIn: 120 } });
		}
		if (path === TICKET_PATH) {
			return Promise.resolve({ data: { ticket, expiresIn: 300 } });
		}
		return Promise.reject(new Error(`unexpected path: ${path}`));
	});
}

describe('computeMfaProof（challenge 签名）', () => {
	it('base32 解码与已知答案一致（独立基准）', () => {
		expect(Array.from(base32Decode(SECRET))).toEqual(Array.from(SECRET_BYTES));
	});

	it('固定 secret + challenge → 与独立计算的 base64(HMAC-SHA256) 一致', async () => {
		const challenge = 'challenge-9f2c4a';
		await expect(computeMfaProof(SECRET, challenge)).resolves.toBe(expectedProof(challenge));
	});

	it('challenge 按 UTF-8 编码（非 ASCII 也一致）', async () => {
		const challenge = 'c-中文-🔐';
		await expect(computeMfaProof(SECRET, challenge)).resolves.toBe(expectedProof(challenge));
	});

	it('空/无效 secret → 抛错（不返回空 proof 冒充成功）', async () => {
		await expect(computeMfaProof('   ', 'ch')).rejects.toThrow();
	});
});

describe('startMfaSsoLogin（begin → proof → ticket → 登录页 URL）', () => {
	beforeEach(() => {
		window.history.pushState({}, '', '/devices?tab=all');
	});

	afterEach(() => {
		vi.restoreAllMocks();
		mockPost.mockReset();
		window.history.pushState({}, '', '/');
	});

	it('成功路径：fragment 带 ticket/identity，回跳地址带 mfa_sso=1', async () => {
		mockTicketFlow();

		const loginUrl = await startMfaSsoLogin(
			{ username: ' admin@autional.com ', secret: SECRET },
			'ACME',
		);

		// begin：身份/租户归一（trim + 小写），不带 secret
		expect(mockPost).toHaveBeenNthCalledWith(1, PROOF_BEGIN_PATH, {
			identity: 'admin@autional.com',
			tenant: 'acme',
		});
		// ticket：challenge + 独立算出的 proof
		const ticketBody = mockPost.mock.calls[1][1];
		expect(mockPost.mock.calls[1][0]).toBe(TICKET_PATH);
		expect(ticketBody).toEqual({
			identity: 'admin@autional.com',
			tenant: 'acme',
			challenge: 'ch-1',
			proof: expectedProof('ch-1'),
		});

		const [head, fragment] = loginUrl.split('#');
		expect(fragment).toBe(
			`mfa_ticket=${encodeURIComponent('tid.secret')}&identity=${encodeURIComponent('admin@autional.com')}`,
		);

		const login = new URL(head);
		const redirect = login.searchParams.get('redirect');
		expect(redirect).toBeTruthy();
		const target = new URL(redirect as string);
		expect(target.pathname).toBe('/acme/devices');
		expect(target.searchParams.get('tab')).toBe('all');
		expect(target.searchParams.get('mfa_sso')).toBe('1');
		// 登录页落在租户段上（buildLoginUrl 的 slug 参数生效）
		expect(login.pathname).toContain('/acme/login');
	});

	it('begin 失败 → 抛错（调用方回落手动登录），不继续换票', async () => {
		mockPost.mockRejectedValueOnce(new Error('network down'));

		await expect(
			startMfaSsoLogin({ username: 'admin@autional.com', secret: SECRET }, 'acme'),
		).rejects.toThrow();
		expect(mockPost).toHaveBeenCalledTimes(1);
	});

	it('ticket 失败 → 抛错，不返回半成品 URL', async () => {
		mockPost.mockResolvedValueOnce({ data: { challenge: 'ch-2', expiresIn: 120 } });
		mockPost.mockRejectedValueOnce(new Error('403'));

		await expect(
			startMfaSsoLogin({ username: 'admin@autional.com', secret: SECRET }, 'acme'),
		).rejects.toThrow();
	});

	it('begin 响应缺少 challenge → 抛错（不拿空挑战硬签）', async () => {
		mockPost.mockResolvedValueOnce({ data: { expiresIn: 120 } });

		await expect(
			startMfaSsoLogin({ username: 'admin@autional.com', secret: SECRET }, 'acme'),
		).rejects.toThrow();
	});

	it('没有租户 → 抛错（由 UI 先弹租户选择）', async () => {
		await expect(
			startMfaSsoLogin({ username: 'admin@autional.com', secret: SECRET }, '   '),
		).rejects.toThrow();
		expect(mockPost).not.toHaveBeenCalled();
	});

	it('secret / proof / ticket 不落 storage，也不进 console', async () => {
		mockTicketFlow();
		const setItem = vi.spyOn(Storage.prototype, 'setItem');
		const consoleCalls: string[] = [];
		for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
			vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
				consoleCalls.push(args.map((a) => String(a)).join(' '));
			});
		}

		const loginUrl = await startMfaSsoLogin(
			{ username: 'admin@autional.com', secret: SECRET },
			'acme',
		);

		const proof = expectedProof('ch-1');
		const storageDump = [
			...setItem.mock.calls.map(([key, value]) => `${String(key)}=${String(value)}`),
			...Object.entries({ ...localStorage }),
			...Object.entries({ ...sessionStorage }),
		].join('\n');
		const consoleDump = consoleCalls.join('\n');

		for (const secretish of [SECRET, proof, 'tid.secret', loginUrl.split('#')[1]]) {
			expect(storageDump).not.toContain(secretish);
			expect(consoleDump).not.toContain(secretish);
		}
	});
});

describe('回跳标记（mfa_sso）', () => {
	it('withMfaSsoFlag 保留 path / query / hash，只加标记', () => {
		const marked = new URL(withMfaSsoFlag('https://app.example/acme/devices?tab=all#top'));
		expect(marked.pathname).toBe('/acme/devices');
		expect(marked.searchParams.get('tab')).toBe('all');
		expect(marked.searchParams.get('mfa_sso')).toBe('1');
		expect(marked.hash).toBe('#top');
	});

	it('buildMfaLoginUrl 把标记放在 redirect 里，ticket 只进 fragment', () => {
		const url = buildMfaLoginUrl('https://app.example/acme/x', 'acme', 'tid.sec', 'u@x.io');
		const [head, fragment] = url.split('#');
		expect(fragment).toBe(`mfa_ticket=${encodeURIComponent('tid.sec')}&identity=${encodeURIComponent('u@x.io')}`);
		expect(head).not.toContain('tid.sec');
		const redirect = new URL(head).searchParams.get('redirect');
		expect(new URL(redirect as string).searchParams.get('mfa_sso')).toBe('1');
	});

	it('hasMfaSsoFlag / stripMfaSsoFlag', () => {
		expect(hasMfaSsoFlag('?a=1&mfa_sso=1')).toBe(true);
		expect(hasMfaSsoFlag('?mfa_sso=0')).toBe(false);
		expect(hasMfaSsoFlag('')).toBe(false);
		expect(stripMfaSsoFlag('?a=1&mfa_sso=1')).toBe('?a=1');
		expect(stripMfaSsoFlag('?mfa_sso=1')).toBe('');
	});
});

describe('usableMfaAccounts', () => {
	const account = (patch: Partial<TotpAccount>): TotpAccount => ({
		id: 'a',
		name: 'n',
		username: '',
		secret: SECRET,
		type: 'totp',
		algorithm: 'SHA1',
		digits: 6,
		period: 30,
		createdAt: 0,
		...patch,
	});

	it('只保留既有 username 又有 secret 的账户', () => {
		const list = [
			account({ id: 'a1', username: 'admin@autional.com' }),
			account({ id: 'a2', username: '   ' }),
			account({ id: 'a3', username: 'b@x.io', secret: '  ' }),
		];
		expect(usableMfaAccounts(list).map((a) => a.id)).toEqual(['a1']);
	});
});
