import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import {
	MFA_SSO_ATTEMPT_KEY,
	clearMfaSsoAttempted,
	resetMfaSsoGuard,
	useMfaSsoAutoSignIn,
} from '../use-mfa-sso';
import { hasMfaSsoFlag } from '../mfa-sso';

function wrapperFor(entry: string) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
	};
}

describe('useMfaSsoAutoSignIn（回跳后静默续跑登录）', () => {
	beforeEach(() => {
		resetMfaSsoGuard();
		clearMfaSsoAttempted();
		window.history.replaceState({}, '', '/');
	});

	it('带 mfa_sso=1 且未登录 → 触发一次 signIn，并把标记从地址栏摘掉', () => {
		const signIn = vi.fn();
		const { rerender } = renderHook(
			({ isAuthenticated }: { isAuthenticated: boolean }) =>
				useMfaSsoAutoSignIn(signIn, isAuthenticated),
			{ wrapper: wrapperFor('/devices?mfa_sso=1'), initialProps: { isAuthenticated: false } },
		);

		expect(signIn).toHaveBeenCalledTimes(1);
		expect(window.location.pathname).toBe('/devices');
		expect(hasMfaSsoFlag(window.location.search)).toBe(false);

		// 同一实例重渲染（signIn 引用每次都变）也只能触发一次
		rerender({ isAuthenticated: false });
		rerender({ isAuthenticated: false });
		expect(signIn).toHaveBeenCalledTimes(1);
	});

	it('模块级一次性 guard：同一页面内重新挂载不会二次触发', () => {
		const signIn = vi.fn();
		renderHook(() => useMfaSsoAutoSignIn(signIn, false), {
			wrapper: wrapperFor('/devices?mfa_sso=1'),
		});
		expect(signIn).toHaveBeenCalledTimes(1);

		// 地址栏已摘掉标记；即便路由里仍带着标记（如前进/后退），也不该再触发
		renderHook(() => useMfaSsoAutoSignIn(signIn, false), {
			wrapper: wrapperFor('/devices?mfa_sso=1'),
		});
		expect(signIn).toHaveBeenCalledTimes(1);
	});

	it('会话级一次性标记：整页重载（模块 guard 被重置）后不再自动续跑，只摘标记', () => {
		const signIn = vi.fn();
		renderHook(() => useMfaSsoAutoSignIn(signIn, false), {
			wrapper: wrapperFor('/devices?mfa_sso=1'),
		});
		expect(signIn).toHaveBeenCalledTimes(1);
		expect(window.sessionStorage.getItem(MFA_SSO_ATTEMPT_KEY)).toBe('1');

		// 模拟整页重载：模块内 guard 归零，但 sessionStorage 仍在
		window.history.replaceState({}, '', '/devices?mfa_sso=1');
		resetMfaSsoGuard();
		const again = vi.fn();
		renderHook(() => useMfaSsoAutoSignIn(again, false), {
			wrapper: wrapperFor('/devices?mfa_sso=1'),
		});
		expect(again).not.toHaveBeenCalled();
		// 标记仍然被摘掉，避免地址栏长期带 `?mfa_sso=1`
		expect(hasMfaSsoFlag(window.location.search)).toBe(false);
	});

	it('已登录 → 不触发，并且摘掉残留标记 + 清掉一次性标记', () => {
		window.sessionStorage.setItem(MFA_SSO_ATTEMPT_KEY, '1');
		const signIn = vi.fn();
		renderHook(() => useMfaSsoAutoSignIn(signIn, true), {
			wrapper: wrapperFor('/devices?mfa_sso=1'),
		});
		expect(signIn).not.toHaveBeenCalled();
		// OAuth 回调完成后地址栏不应再留着标记（分享/收藏/刷新都不该带）
		expect(hasMfaSsoFlag(window.location.search)).toBe(false);
		// 登录完成 → 下次登录（登出后）还能再用自动续跑
		expect(window.sessionStorage.getItem(MFA_SSO_ATTEMPT_KEY)).toBeNull();
	});

	it('没有标记 → 不触发', () => {
		const signIn = vi.fn();
		renderHook(() => useMfaSsoAutoSignIn(signIn, false), {
			wrapper: wrapperFor('/devices?tab=all'),
		});
		expect(signIn).not.toHaveBeenCalled();
		expect(window.sessionStorage.getItem(MFA_SSO_ATTEMPT_KEY)).toBeNull();
	});

	it('未登录且没有标记时不消耗一次性标记（后续真回跳仍能续跑）', () => {
		const signIn = vi.fn();
		renderHook(() => useMfaSsoAutoSignIn(signIn, false), {
			wrapper: wrapperFor('/devices'),
		});
		expect(signIn).not.toHaveBeenCalled();
		expect(window.sessionStorage.getItem(MFA_SSO_ATTEMPT_KEY)).toBeNull();
	});
});
