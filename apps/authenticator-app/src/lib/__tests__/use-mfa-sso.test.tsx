import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { resetMfaSsoGuard, useMfaSsoAutoSignIn } from '../use-mfa-sso';
import { hasMfaSsoFlag } from '../mfa-sso';

function wrapperFor(entry: string) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
	};
}

describe('useMfaSsoAutoSignIn（回跳后静默续跑登录）', () => {
	beforeEach(() => {
		resetMfaSsoGuard();
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

	it('已登录 → 不触发（令牌已在，标记留待下次导航忽略）', () => {
		const signIn = vi.fn();
		renderHook(() => useMfaSsoAutoSignIn(signIn, true), {
			wrapper: wrapperFor('/devices?mfa_sso=1'),
		});
		expect(signIn).not.toHaveBeenCalled();
	});

	it('没有标记 → 不触发', () => {
		const signIn = vi.fn();
		renderHook(() => useMfaSsoAutoSignIn(signIn, false), {
			wrapper: wrapperFor('/devices?tab=all'),
		});
		expect(signIn).not.toHaveBeenCalled();
	});
});
