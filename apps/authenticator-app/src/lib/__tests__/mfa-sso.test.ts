// client-id-literal: test-fixture（ULID 字面量仅作测试夹具；生产路径禁止出现）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));

vi.mock('@autional/shared', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@autional/shared')>();
	return { ...actual, apiClient: { post: mockPost } };
});

import { snakeCaseKeys } from '@autional/shared';
import {
	PROOF_BEGIN_PATH,
	TICKET_PATH,
	buildMfaLoginUrl,
	computeMfaProof,
	hasMfaSsoFlag,
	redirectHostOf,
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

/** runtime 配置里的 OAuth client_id（`public/env.js` 的 VITE_OAUTH_CLIENT_ID）。 */
const CLIENT_ID = '01AR0000000000000000000005';

type ConfigHost = { window: { __APP_CONFIG__?: unknown } };

/** 注入运行时配置（等价于 index.html 内联的 env.js 已执行）。 */
function setRuntimeConfig(config: unknown): void {
	(globalThis as unknown as ConfigHost).window.__APP_CONFIG__ = config;
}

/**
 * 拦截器把 body 的 camel 书面键转成 wire 上的 snake_case（`shared/api/client.ts`）。
 * 测试 mock 掉的是 axios 之前的 `apiClient.post`，所以**必须**再跑一遍这个转换，
 * 才能断言「真正的 wire 字段是 client_id / redirect_host」。
 */
function wireBody(callIndex: number): Record<string, unknown> {
	return snakeCaseKeys(mockPost.mock.calls[callIndex][1]) as Record<string, unknown>;
}

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
		// client_id 只有运行时一个来源（env.js 已内联）；没有它整条桥路径不存在。
		setRuntimeConfig({ VITE_OAUTH_CLIENT_ID: CLIENT_ID });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		mockPost.mockReset();
		delete (globalThis as unknown as ConfigHost).window.__APP_CONFIG__;
		window.history.pushState({}, '', '/');
	});

	it('成功路径：fragment 带 ticket/identity/client_id，回跳地址带 mfa_sso=1', async () => {
		mockTicketFlow();

		const loginUrl = await startMfaSsoLogin(
			{ username: ' admin@autional.com ', secret: SECRET },
			'ACME',
		);

		// begin：身份/租户归一（trim + 小写）+ 运行时 client_id，不带 secret
		expect(mockPost).toHaveBeenNthCalledWith(1, PROOF_BEGIN_PATH, {
			identity: 'admin@autional.com',
			tenant: 'acme',
			clientId: CLIENT_ID,
		});
		// ticket：challenge + 独立算出的 proof + client_id + redirect_host
		const ticketBody = mockPost.mock.calls[1][1];
		expect(mockPost.mock.calls[1][0]).toBe(TICKET_PATH);
		expect(ticketBody).toEqual({
			identity: 'admin@autional.com',
			tenant: 'acme',
			challenge: 'ch-1',
			proof: expectedProof('ch-1'),
			clientId: CLIENT_ID,
			redirectHost: window.location.host,
		});

		const [head, fragment] = loginUrl.split('#');
		expect(fragment).toBe(
			`mfa_ticket=${encodeURIComponent('tid.secret')}&identity=${encodeURIComponent('admin@autional.com')}&client_id=${encodeURIComponent(CLIENT_ID)}`,
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

	it('wire 字段是 client_id / redirect_host（camel 书面键经拦截器归一）', async () => {
		mockTicketFlow();
		await startMfaSsoLogin({ username: 'admin@autional.com', secret: SECRET }, 'acme');

		expect(wireBody(0)).toEqual({
			identity: 'admin@autional.com',
			tenant: 'acme',
			client_id: CLIENT_ID,
		});
		expect(wireBody(1)).toEqual({
			identity: 'admin@autional.com',
			tenant: 'acme',
			challenge: 'ch-1',
			proof: expectedProof('ch-1'),
			client_id: CLIENT_ID,
			redirect_host: window.location.host,
		});
	});

	it('client_id 来自运行时 __APP_CONFIG__（而非 import.meta.env）', async () => {
		vi.stubEnv('VITE_OAUTH_CLIENT_ID', 'from-import-meta-env');
		setRuntimeConfig({ VITE_OAUTH_CLIENT_ID: CLIENT_ID });
		mockTicketFlow();

		await startMfaSsoLogin({ username: 'admin@autional.com', secret: SECRET }, 'acme');

		expect(mockPost.mock.calls[0][1]).toMatchObject({ clientId: CLIENT_ID });
		vi.unstubAllEnvs();
	});

	it('运行时没有 client_id → 抛错且**一次请求都不发**（fail-closed，调用方回落 legacy）', async () => {
		delete (globalThis as unknown as ConfigHost).window.__APP_CONFIG__;

		await expect(
			startMfaSsoLogin({ username: 'admin@autional.com', secret: SECRET }, 'acme'),
		).rejects.toThrow('mfa_sso_missing_client_id');
		expect(mockPost).not.toHaveBeenCalled();
	});

	it('client_id 只有空白 → 同样不发请求', async () => {
		setRuntimeConfig({ VITE_OAUTH_CLIENT_ID: '   ' });

		await expect(
			startMfaSsoLogin({ username: 'admin@autional.com', secret: SECRET }, 'acme'),
		).rejects.toThrow('mfa_sso_missing_client_id');
		expect(mockPost).not.toHaveBeenCalled();
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
		// client_id 是公开标识，但仍只走 fragment 一条投递路径：不落 storage、不进日志。
		expect(storageDump).not.toContain(CLIENT_ID);
		expect(consoleDump).not.toContain(CLIENT_ID);
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
		const url = buildMfaLoginUrl('https://app.example/acme/x', 'acme', 'tid.sec', 'u@x.io', CLIENT_ID);
		const [head, fragment] = url.split('#');
		expect(fragment).toBe(
			`mfa_ticket=${encodeURIComponent('tid.sec')}&identity=${encodeURIComponent('u@x.io')}&client_id=${encodeURIComponent(CLIENT_ID)}`,
		);
		expect(head).not.toContain('tid.sec');
		// ticket / client_id 都只在 fragment：不出现在请求路径或 query 里
		expect(head).not.toContain(CLIENT_ID);
		const redirect = new URL(head).searchParams.get('redirect');
		expect(new URL(redirect as string).searchParams.get('mfa_sso')).toBe('1');
	});

	it('buildMfaLoginUrl 对 client_id 做 URL 编码', () => {
		const url = buildMfaLoginUrl('https://app.example/acme/x', 'acme', 't', 'u@x.io', 'a b&c=d');
		expect(url.split('#')[1]).toBe(
			`mfa_ticket=t&identity=${encodeURIComponent('u@x.io')}&client_id=${encodeURIComponent('a b&c=d')}`,
		);
	});

	it('redirectHostOf 取回跳目标 host（供后端 redirect_host audit-only 比对）', () => {
		expect(redirectHostOf('https://authenticator.autional.cn/acme/devices')).toBe(
			'authenticator.autional.cn',
		);
		expect(redirectHostOf('http://localhost:13108/acme/')).toBe('localhost:13108');
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
