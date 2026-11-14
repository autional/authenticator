import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockPost, mockNavigate } = vi.hoisted(() => ({
	mockPost: vi.fn(),
	mockNavigate: vi.fn(),
}));

vi.mock('@autional/shared', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@autional/shared')>();
	return { ...actual, apiClient: { post: mockPost } };
});

// 只替换 navigation 副作用；startMfaSsoLogin / 建 URL 全部走真实实现（断言才有意义）。
vi.mock('@/lib/mfa-sso', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/mfa-sso')>();
	return { ...actual, navigateToLoginPage: mockNavigate };
});

vi.mock('react-i18next', () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

interface MockStoreState {
	accounts: Array<{
		id: string;
		name: string;
		username: string;
		secret: string;
		type: 'totp';
		algorithm: 'SHA1';
		digits: number;
		period: number;
		createdAt: number;
	}>;
}
let storeState: MockStoreState = { accounts: [] };
vi.mock('@/lib/store', () => ({
	useAuthenticatorStore: (selector?: unknown) =>
		typeof selector === 'function'
			? (selector as (state: unknown) => unknown)(storeState)
			: storeState,
}));

let lastTenantSlug = '';
vi.mock('@/lib/slug', () => ({
	readLastTenantSlug: () => lastTenantSlug,
	rememberTenantSlug: () => {},
	useTenantSlug: () => lastTenantSlug,
}));

import MfaSsoButton from '../MfaSsoButton';
import { PROOF_BEGIN_PATH, TICKET_PATH } from '@/lib/mfa-sso';

const SECRET = 'JBSWY3DPEHPK3PXP';

const account = (id: string, username: string) => ({
	id,
	name: `svc-${id}`,
	username,
	secret: SECRET,
	type: 'totp' as const,
	algorithm: 'SHA1' as const,
	digits: 6,
	period: 30,
	createdAt: 0,
});

function mockTicketFlow() {
	mockPost.mockImplementation((path: string) => {
		if (path === PROOF_BEGIN_PATH) {
			return Promise.resolve({ data: { challenge: 'ch-1', expiresIn: 120 } });
		}
		if (path === TICKET_PATH) {
			return Promise.resolve({ data: { ticket: 'tid.secret', expiresIn: 300 } });
		}
		return Promise.reject(new Error(`unexpected path: ${path}`));
	});
}

/** 断言「跳到了哪个登录页」（组件经 navigateToLoginPage 收口，单点可替换）。 */
function stubAssign() {
	return mockNavigate;
}

describe('MfaSsoButton（用本机验证器登录）', () => {
	beforeEach(() => {
		lastTenantSlug = '';
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		mockPost.mockReset();
		mockNavigate.mockReset();
		vi.unstubAllGlobals();
	});

	it('只有一个带用户名的账户 → 自动选中，点击后跳到带票据的登录页', async () => {
		storeState = { accounts: [account('a1', 'admin@autional.com'), account('a2', '   ')] };
		mockTicketFlow();
		const assign = stubAssign();
		const onFallback = vi.fn();

		render(<MfaSsoButton slug="acme" onFallback={onFallback} />);

		// 只有一个可用账户 → 不渲染下拉
		expect(screen.queryByRole('combobox')).toBeNull();

		await userEvent.click(screen.getByRole('button', { name: 'signIn.mfaSso' }));

		await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
		const loginUrl = assign.mock.calls[0][0] as string;
		const [head, fragment] = loginUrl.split('#');
		expect(fragment).toContain(`mfa_ticket=${encodeURIComponent('tid.secret')}`);
		expect(fragment).toContain(`identity=${encodeURIComponent('admin@autional.com')}`);
		const redirect = new URL(head).searchParams.get('redirect');
		expect(new URL(redirect as string).searchParams.get('mfa_sso')).toBe('1');
		expect(onFallback).not.toHaveBeenCalled();
	});

	it('begin / ticket 报错 → 回落普通 signIn，且不跳票据地址', async () => {
		storeState = { accounts: [account('a1', 'admin@autional.com')] };
		mockPost.mockRejectedValue(new Error('network down'));
		const assign = stubAssign();
		const onFallback = vi.fn();

		render(<MfaSsoButton slug="acme" onFallback={onFallback} />);
		await userEvent.click(screen.getByRole('button', { name: 'signIn.mfaSso' }));

		await waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1));
		expect(assign).not.toHaveBeenCalled();
		// 失败后不锁死按钮：用户可以再试或直接用手动登录
		expect(screen.getByRole('button', { name: 'signIn.mfaSso' })).toBeEnabled();
	});

	it('保险库里没有填用户名的账户 → 按钮禁用并给提示', () => {
		storeState = { accounts: [account('a1', '  ')] };
		const onFallback = vi.fn();

		render(<MfaSsoButton slug="acme" onFallback={onFallback} />);

		expect(screen.getByRole('button', { name: 'signIn.mfaSso' })).toBeDisabled();
		expect(screen.getByText('signIn.mfaSsoNoAccount')).toBeInTheDocument();
		expect(mockPost).not.toHaveBeenCalled();
	});

	it('多个账户 → 下拉可选择，换票用选中的用户名', async () => {
		storeState = {
			accounts: [account('a1', 'first@autional.com'), account('a2', 'second@autional.com')],
		};
		mockTicketFlow();
		const assign = stubAssign();

		render(<MfaSsoButton slug="acme" onFallback={vi.fn()} />);

		const select = screen.getByRole('combobox', { name: 'signIn.mfaSsoAccount' });
		await userEvent.selectOptions(select, 'a2');
		await userEvent.click(screen.getByRole('button', { name: 'signIn.mfaSso' }));

		await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
		expect(mockPost.mock.calls[0][1]).toEqual({
			identity: 'second@autional.com',
			tenant: 'acme',
		});
	});

	it('没有租户上下文 → 先弹现有租户选择弹窗，选完再换票', async () => {
		storeState = { accounts: [account('a1', 'admin@autional.com')] };
		mockTicketFlow();
		const assign = stubAssign();

		render(<MfaSsoButton slug="" onFallback={vi.fn()} />);
		await userEvent.click(screen.getByRole('button', { name: 'signIn.mfaSso' }));

		const dialog = await screen.findByRole('dialog');
		expect(mockPost).not.toHaveBeenCalled();

		await userEvent.type(within(dialog).getByLabelText('signIn.label'), 'Acme');
		await userEvent.click(within(dialog).getByRole('button', { name: 'signIn.continue' }));

		await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
		expect(mockPost.mock.calls[0][1]).toEqual({ identity: 'admin@autional.com', tenant: 'acme' });
	});
});
