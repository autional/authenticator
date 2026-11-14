import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/**
 * 全局「回跳后自动续跑」组件：
 *   ① 未登录 + `?mfa_sso=1` → 发起**一次** OAuth（不是页面里的 signIn，避免再换票成环）；
 *   ② 已登录 + `?mfa_sso=1` → 不发起，且把标记从地址栏摘掉；
 *   ③ 重复渲染 / 重新挂载 → 只发起一次（模块 guard + 会话标记）。
 *
 * 关键回归点：这个组件必须挂在路由之外（App.tsx），所以设置页 / 首页空态回跳也能跑。
 */

const { mockInitiateOAuthLogin, authState } = vi.hoisted(() => ({
	mockInitiateOAuthLogin: vi.fn(),
	authState: { isAuthenticated: false },
}));

vi.mock('@autional/shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared')>()),
	// 只替换「发起 OAuth」这一个副作用；useAuth 用可变状态驱动。
	initiateOAuthLogin: mockInitiateOAuthLogin,
	useAuth: () => authState,
}));

import MfaSsoAutoSignIn from '../MfaSsoAutoSignIn';
import { clearMfaSsoAttempted, MFA_SSO_ATTEMPT_KEY, resetMfaSsoGuard } from '../../lib/use-mfa-sso';
import { hasMfaSsoFlag } from '../../lib/mfa-sso';

function renderGlobal(entry: string) {
	return render(
		<MemoryRouter initialEntries={[entry]}>
			<MfaSsoAutoSignIn />
		</MemoryRouter>,
	);
}

describe('MfaSsoAutoSignIn（全局回跳续跑）', () => {
	beforeEach(() => {
		mockInitiateOAuthLogin.mockReset();
		mockInitiateOAuthLogin.mockResolvedValue(undefined);
		authState.isAuthenticated = false;
		resetMfaSsoGuard();
		clearMfaSsoAttempted();
		window.history.replaceState({}, '', '/');
	});

	afterEach(() => {
		cleanup();
	});

	it('未登录 + ?mfa_sso=1 → 用 OAuth 续跑一次，回跳地址不含标记', () => {
		window.history.replaceState({}, '', '/settings?mfa_sso=1');
		renderGlobal('/settings?mfa_sso=1');

		expect(mockInitiateOAuthLogin).toHaveBeenCalledTimes(1);
		const [clientId, redirectTarget] = mockInitiateOAuthLogin.mock.calls[0] as [
			undefined,
			string,
		];
		expect(clientId).toBeUndefined();
		// 回跳地址就是当前页（标记已被摘掉），不带 `mfa_sso=1`，否则会一次次重放
		expect(redirectTarget).toBe(`${window.location.origin}/settings`);
		expect(hasMfaSsoFlag(new URL(redirectTarget).search)).toBe(false);
		// 申请的 scope 与页面内登录同源（缺 write 会「登录成功但写接口 403」）
		expect(mockInitiateOAuthLogin.mock.calls[0][2]).toEqual({
			scope: expect.stringContaining('write'),
		});
		expect(window.sessionStorage.getItem(MFA_SSO_ATTEMPT_KEY)).toBe('1');
	});

	it('回跳页是首页空态（/）也能续跑 —— 它不在 ServerOnly 里', () => {
		window.history.replaceState({}, '', '/?mfa_sso=1');
		renderGlobal('/?mfa_sso=1');
		expect(mockInitiateOAuthLogin).toHaveBeenCalledTimes(1);
	});

	it('已登录 + ?mfa_sso=1 → 不续跑，且把残留标记摘掉', () => {
		authState.isAuthenticated = true;
		window.history.replaceState({}, '', '/settings?tab=a&mfa_sso=1');
		renderGlobal('/settings?tab=a&mfa_sso=1');

		expect(mockInitiateOAuthLogin).not.toHaveBeenCalled();
		expect(window.location.search).toBe('?tab=a');
		expect(window.sessionStorage.getItem(MFA_SSO_ATTEMPT_KEY)).toBeNull();
	});

	it('重复渲染 / 重新挂载 → 只发起一次', () => {
		window.history.replaceState({}, '', '/settings?mfa_sso=1');
		const view = renderGlobal('/settings?mfa_sso=1');
		expect(mockInitiateOAuthLogin).toHaveBeenCalledTimes(1);

		// 组件自身重渲染（无关状态变化）
		view.rerender(
			<MemoryRouter initialEntries={['/settings?mfa_sso=1']}>
				<MfaSsoAutoSignIn />
			</MemoryRouter>,
		);
		expect(mockInitiateOAuthLogin).toHaveBeenCalledTimes(1);

		// 整棵卸载再挂载（路由切换）→ 模块 guard / 会话标记兜住
		view.unmount();
		renderGlobal('/settings?mfa_sso=1');
		expect(mockInitiateOAuthLogin).toHaveBeenCalledTimes(1);
	});

	it('没有标记 → 什么都不做', () => {
		renderGlobal('/settings');
		expect(mockInitiateOAuthLogin).not.toHaveBeenCalled();
	});
});
