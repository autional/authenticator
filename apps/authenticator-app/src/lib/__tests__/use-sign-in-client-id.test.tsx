// client-id-literal: test-fixture（ULID 字面量仅作测试夹具；生产路径禁止出现）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { TotpAccount } from '../store';

/**
 * client_id 缺失时的**端到端**登录行为（真 `startMfaSsoLogin`，不 mock 换票模块）：
 *
 * 运行时没有 `__APP_CONFIG__.VITE_OAUTH_CLIENT_ID` ⇒ 一次 begin 都不发，
 * 直接静默回落既有 OAuth / 手动登录。也就是说「env.js 没注入」不会让用户
 * 登不进去 —— 只是失去「只需输密码」这条加速路径。
 */

const { mockPost, mockNavigate, mockInitiateOAuthLogin } = vi.hoisted(() => ({
	mockPost: vi.fn(),
	mockNavigate: vi.fn(),
	mockInitiateOAuthLogin: vi.fn(),
}));

vi.mock('@autional/shared', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@autional/shared')>();
	return {
		...actual,
		apiClient: { post: mockPost },
		isOAuthEnabled: () => true,
		initiateOAuthLogin: mockInitiateOAuthLogin,
	};
});

// 只替换整页跳转（jsdom 的 location.assign 不可打桩）；换票逻辑保持真实。
vi.mock('@/lib/mfa-sso', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/mfa-sso')>();
	return { ...actual, navigateToLoginPage: mockNavigate };
});

let storeState: { accounts: TotpAccount[] } = { accounts: [] };
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

const SECRET = 'JBSWY3DPEHPK3PXP';
const CLIENT_ID = '01AR0000000000000000000005';
const LAST_TENANT_KEY = 'authenticator-last-tenant-slug';

type ConfigHost = { window: { __APP_CONFIG__?: unknown } };

const account: TotpAccount = {
	id: 'a1',
	name: 'admin',
	username: 'admin@autional.com',
	secret: SECRET,
	type: 'totp',
	algorithm: 'SHA1',
	digits: 6,
	period: 30,
	createdAt: 0,
};

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

function renderApp() {
	return render(
		<MemoryRouter initialEntries={['/acme/devices']}>
			<Routes>
				<Route path="/:tenantSlug/*" element={<Harness />} />
			</Routes>
		</MemoryRouter>,
	);
}

async function clickLogin() {
	await userEvent.click(screen.getByRole('button', { name: 'login' }));
}

describe('useSignIn · client_id 缺失时的回落（真换票路径）', () => {
	beforeEach(() => {
		storeState = { accounts: [account] };
		localStorage.clear();
		localStorage.setItem(LAST_TENANT_KEY, 'acme');
		window.history.replaceState({}, '', '/acme/devices');
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		mockPost.mockReset();
		mockNavigate.mockReset();
		mockInitiateOAuthLogin.mockReset();
		delete (globalThis as unknown as ConfigHost).window.__APP_CONFIG__;
	});

	it('没有运行时 client_id → 不发 begin/ticket，直接走既有 OAuth 登录', async () => {
		delete (globalThis as unknown as ConfigHost).window.__APP_CONFIG__;

		renderApp();
		await clickLogin();

		await waitFor(() => expect(mockInitiateOAuthLogin).toHaveBeenCalledTimes(1));
		expect(mockPost).not.toHaveBeenCalled();
		expect(mockNavigate).not.toHaveBeenCalled();
	});

	it('有运行时 client_id → 走换票（证明上一条的回落只由缺 client_id 引起）', async () => {
		(globalThis as unknown as ConfigHost).window.__APP_CONFIG__ = {
			VITE_OAUTH_CLIENT_ID: CLIENT_ID,
		};
		mockPost.mockImplementation((path: string) => {
			if (path.endsWith('/proof/begin')) {
				return Promise.resolve({ data: { challenge: 'ch-1', expiresIn: 120 } });
			}
			return Promise.resolve({ data: { ticket: 'tid.secret', expiresIn: 300 } });
		});

		renderApp();
		await clickLogin();

		await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
		expect(mockPost).toHaveBeenCalledTimes(2);
		expect(mockPost.mock.calls[0][1]).toMatchObject({ clientId: CLIENT_ID });
		expect(String(mockNavigate.mock.calls[0][0])).toContain(
			`client_id=${encodeURIComponent(CLIENT_ID)}`,
		);
		expect(mockInitiateOAuthLogin).not.toHaveBeenCalled();
	});
});
