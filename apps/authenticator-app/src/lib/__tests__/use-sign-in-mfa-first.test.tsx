import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { TotpAccount } from '../store';

/**
 * 登录入口默认优先走「本机票据」（MFA SSO）：
 *   ① 有可用账户 + 已知租户 → 换票并跳 auth 登录页（回跳地址保留）；
 *   ② 换票抛错 / 无账户 / 无租户 → 静默回落原有 OAuth / 租户选择，**不跳**票据地址；
 *   ③ 连点只换一次票（换票是网络往返，重复点会重复消耗挑战）；
 *   ④ 失败后不锁死 —— 用户可以再点一次（或直接走手动登录）。
 */

const { mockStartMfaSsoLogin, mockNavigateToLoginPage, mockInitiateOAuthLogin } = vi.hoisted(() => ({
	mockStartMfaSsoLogin: vi.fn(),
	mockNavigateToLoginPage: vi.fn(),
	mockInitiateOAuthLogin: vi.fn(),
}));

// OAuth 常开（不真跳转：initiateOAuthLogin 整个替换成 spy）。
vi.mock('@autional/shared', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@autional/shared')>();
	return {
		...actual,
		isOAuthEnabled: () => true,
		initiateOAuthLogin: mockInitiateOAuthLogin,
	};
});

// 只替换「换票 + 跳转」两个副作用；usableMfaAccounts 保持真实口径（有身份 + 有密钥）。
vi.mock('@/lib/mfa-sso', () => ({
	startMfaSsoLogin: mockStartMfaSsoLogin,
	navigateToLoginPage: mockNavigateToLoginPage,
	usableMfaAccounts: (accounts: TotpAccount[]) =>
		accounts.filter(
			(account) => Boolean(account.username?.trim()) && Boolean(account.secret?.trim()),
		),
}));

interface MockStoreState {
	accounts: TotpAccount[];
}
let storeState: MockStoreState = { accounts: [] };
vi.mock('@/lib/store', () => ({
	useAuthenticatorStore: (selector?: unknown) =>
		typeof selector === 'function'
			? (selector as (state: unknown) => unknown)(storeState)
			: storeState,
}));

vi.mock('react-i18next', () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { useSignIn } from '../use-sign-in';

const LAST_TENANT_KEY = 'authenticator-last-tenant-slug';

const SECRET = 'JBSWY3DPEHPK3PXP';

const account = (id: string, username: string): TotpAccount => ({
	id,
	name: `svc-${id}`,
	username,
	secret: SECRET,
	type: 'totp',
	algorithm: 'SHA1',
	digits: 6,
	period: 30,
	createdAt: 0,
});

function Harness() {
	const { signIn, dialog } = useSignIn();
	return (
		<div>
			<button type="button" onClick={signIn}>
				login
			</button>
			{dialog}
		</div>
	);
}

/** `path` 决定路由里有没有 `:tenantSlug`（无租户场景用 `/*`，避免把首段当租户）。 */
function renderApp(entry: string, path: string) {
	return render(
		<MemoryRouter initialEntries={[entry]}>
			<Routes>
				<Route path={path} element={<Harness />} />
			</Routes>
		</MemoryRouter>,
	);
}

async function clickLogin() {
	await userEvent.click(screen.getByRole('button', { name: 'login' }));
}

describe('useSignIn（默认优先本机票据）', () => {
	beforeEach(() => {
		storeState = { accounts: [] };
		localStorage.clear();
		// 回跳地址读的是真实地址栏（MemoryRouter 不改 window.location）。
		window.history.replaceState({}, '', '/devices');
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		mockStartMfaSsoLogin.mockReset();
		mockNavigateToLoginPage.mockReset();
		mockInitiateOAuthLogin.mockReset();
	});

	it('有可用账户 + 最近租户 → 换票并跳登录页，不走 OAuth', async () => {
		const admin = account('a1', 'admin@autional.com');
		storeState = { accounts: [admin] };
		localStorage.setItem(LAST_TENANT_KEY, 'acme');
		mockStartMfaSsoLogin.mockResolvedValue('https://auth.test/login#mfa_ticket=t1');

		renderApp('/devices', '/*');
		await clickLogin();

		await waitFor(() => expect(mockStartMfaSsoLogin).toHaveBeenCalledTimes(1));
		expect(mockStartMfaSsoLogin).toHaveBeenCalledWith(admin, 'acme');
		expect(mockNavigateToLoginPage).toHaveBeenCalledWith('https://auth.test/login#mfa_ticket=t1');
		expect(mockInitiateOAuthLogin).not.toHaveBeenCalled();
	});

	it('URL 租户段优先于最近租户', async () => {
		storeState = { accounts: [account('a1', 'admin@autional.com')] };
		localStorage.setItem(LAST_TENANT_KEY, 'stale');
		mockStartMfaSsoLogin.mockResolvedValue('https://auth.test/login#mfa_ticket=t1');

		renderApp('/acme/devices', '/:tenantSlug/*');
		await clickLogin();

		await waitFor(() => expect(mockStartMfaSsoLogin).toHaveBeenCalledTimes(1));
		expect(mockStartMfaSsoLogin.mock.calls[0][1]).toBe('acme');
	});

	it('多个可用账户 → 默认用第一个（不加选择弹窗）', async () => {
		const first = account('a1', 'first@autional.com');
		storeState = { accounts: [first, account('a2', 'second@autional.com')] };
		mockStartMfaSsoLogin.mockResolvedValue('https://auth.test/login#mfa_ticket=t1');

		renderApp('/acme/devices', '/:tenantSlug/*');
		await clickLogin();

		await waitFor(() => expect(mockStartMfaSsoLogin).toHaveBeenCalledTimes(1));
		expect(mockStartMfaSsoLogin).toHaveBeenCalledWith(first, 'acme');
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('换票抛错 → 回落原有 OAuth，且不跳票据地址', async () => {
		storeState = { accounts: [account('a1', 'admin@autional.com')] };
		mockStartMfaSsoLogin.mockRejectedValue(new Error('identity down'));

		renderApp('/acme/devices', '/:tenantSlug/*');
		await clickLogin();

		await waitFor(() => expect(mockInitiateOAuthLogin).toHaveBeenCalledTimes(1));
		expect(mockNavigateToLoginPage).not.toHaveBeenCalled();
		// 回跳地址保留租户段（与改造前的 startSignIn 一致）
		const target = mockInitiateOAuthLogin.mock.calls[0][1] as string;
		expect(new URL(target).pathname).toBe('/acme/devices');
	});

	it('失败后可重试：guard 释放，再点仍会换票', async () => {
		storeState = { accounts: [account('a1', 'admin@autional.com')] };
		mockStartMfaSsoLogin.mockRejectedValueOnce(new Error('identity down'));
		mockStartMfaSsoLogin.mockResolvedValue('https://auth.test/login#mfa_ticket=t1');

		renderApp('/acme/devices', '/:tenantSlug/*');
		await clickLogin();
		await waitFor(() => expect(mockInitiateOAuthLogin).toHaveBeenCalledTimes(1));

		await clickLogin();
		await waitFor(() => expect(mockStartMfaSsoLogin).toHaveBeenCalledTimes(2));
		expect(mockNavigateToLoginPage).toHaveBeenCalledWith('https://auth.test/login#mfa_ticket=t1');
	});

	it('没有可用账户（缺用户名）→ 走原有 OAuth', async () => {
		storeState = { accounts: [account('a1', '   ')] };

		renderApp('/acme/devices', '/:tenantSlug/*');
		await clickLogin();

		expect(mockStartMfaSsoLogin).not.toHaveBeenCalled();
		expect(mockInitiateOAuthLogin).toHaveBeenCalledTimes(1);
	});

	it('没有租户（无 URL 段、无最近租户）→ 弹原有租户选择，不换票', async () => {
		storeState = { accounts: [account('a1', 'admin@autional.com')] };

		renderApp('/devices', '/*');
		await clickLogin();

		expect(await screen.findByRole('dialog')).toBeInTheDocument();
		expect(mockStartMfaSsoLogin).not.toHaveBeenCalled();
		expect(mockInitiateOAuthLogin).not.toHaveBeenCalled();
	});

	it('连点两次 → 只换一次票、只跳一次', async () => {
		storeState = { accounts: [account('a1', 'admin@autional.com')] };
		let resolveExchange: (url: string) => void = () => {};
		mockStartMfaSsoLogin.mockReturnValue(
			new Promise<string>((resolve) => {
				resolveExchange = resolve;
			}),
		);

		renderApp('/acme/devices', '/:tenantSlug/*');
		const button = screen.getByRole('button', { name: 'login' });
		await userEvent.click(button);
		await userEvent.click(button);

		expect(mockStartMfaSsoLogin).toHaveBeenCalledTimes(1);

		resolveExchange('https://auth.test/login#mfa_ticket=t1');
		await waitFor(() => expect(mockNavigateToLoginPage).toHaveBeenCalledTimes(1));
	});
});
