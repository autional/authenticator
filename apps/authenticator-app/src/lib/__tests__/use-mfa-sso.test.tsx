import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { resetMfaSsoGuard, useMfaSsoAutoSignIn } from '../use-mfa-sso';
import { MFA_SSO_EVENT } from '../mfa-sso-report';
import { hasMfaSsoFlag } from '../mfa-sso';

/**
 * 回跳后静默续跑的两道闸：
 *   ① 标记先摘再发起（回跳目标不带 `mfa_sso=1` → 失败也不会重放）；
 *   ② 模块级 guard + 每次挂载的 fired ref（同一页面只跑一次）。
 *
 * 关键回归：**没有**跨整页重载的永久 guard。首次续跑失败后，再次回到带标记的
 * 页面（= 一次新的整页加载，模块 guard 归零）必须**重新发起** OAuth，
 * 否则该标签页会永久停在登录按钮（P0）。
 */

const ATTEMPT_KEY = 'mfa_sso_auto_attempted';

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

	afterEach(() => {
		vi.restoreAllMocks();
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

	it('不再写 sessionStorage 一次性标记（不产生跨重载的永久 guard）', () => {
		const signIn = vi.fn();
		renderHook(() => useMfaSsoAutoSignIn(signIn, false), {
			wrapper: wrapperFor('/devices?mfa_sso=1'),
		});
		expect(signIn).toHaveBeenCalledTimes(1);
		expect(window.sessionStorage.getItem(ATTEMPT_KEY)).toBeNull();
	});

	it('首次续跑失败后：再次回到带标记的页面（整页重载）仍会发起 OAuth', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const first = vi.fn(() => {
			throw new Error('oauth blocked');
		});
		const before = renderHook(() => useMfaSsoAutoSignIn(first, false), {
			wrapper: wrapperFor('/devices?mfa_sso=1'),
		});
		expect(first).toHaveBeenCalledTimes(1);
		// 失败要留痕（否则线上无从排查）
		expect(warn).toHaveBeenCalled();
		before.unmount();

		// 模拟整页重新加载：模块级 guard 归零，用户再次从 auth 回跳（地址带标记）
		window.history.replaceState({}, '', '/devices?mfa_sso=1');
		resetMfaSsoGuard();

		const second = vi.fn();
		renderHook(() => useMfaSsoAutoSignIn(second, false), {
			wrapper: wrapperFor('/devices?mfa_sso=1'),
		});
		// 关键断言：不再被「曾经失败过」永久污染
		expect(second).toHaveBeenCalledTimes(1);
		expect(hasMfaSsoFlag(window.location.search)).toBe(false);
	});

	it('续跑抛错 / reject → console.warn + autional:mfa-sso 事件（不含敏感值）', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const events: Array<{ phase?: string; reason?: string }> = [];
		const listener = (event: Event) => {
			events.push((event as CustomEvent<{ phase?: string; reason?: string }>).detail);
		};
		window.addEventListener(MFA_SSO_EVENT, listener);

		const signIn = vi.fn(() => Promise.reject(new Error('ticket=tid.secret denied')));
		renderHook(() => useMfaSsoAutoSignIn(signIn, false), {
			wrapper: wrapperFor('/settings?mfa_sso=1'),
		});

		await vi.waitFor(() => expect(events).toHaveLength(1));
		expect(events[0]).toMatchObject({ phase: 'auto-continue' });
		expect(events[0].reason).not.toContain('tid.secret');
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0][0])).toBe('[mfa-sso] auto continue failed');

		window.removeEventListener(MFA_SSO_EVENT, listener);
	});

	it('已登录 → 不触发，只摘掉残留标记', () => {
		const signIn = vi.fn();
		renderHook(() => useMfaSsoAutoSignIn(signIn, true), {
			wrapper: wrapperFor('/devices?mfa_sso=1'),
		});
		expect(signIn).not.toHaveBeenCalled();
		// OAuth 回调完成后地址栏不应再留着标记（分享/收藏/刷新都不该带）
		expect(hasMfaSsoFlag(window.location.search)).toBe(false);
	});

	it('没有标记 → 不触发', () => {
		const signIn = vi.fn();
		renderHook(() => useMfaSsoAutoSignIn(signIn, false), {
			wrapper: wrapperFor('/devices?tab=all'),
		});
		expect(signIn).not.toHaveBeenCalled();
	});

	it('未登录且没有标记时不消耗 guard（后续真回跳仍能续跑）', () => {
		const signIn = vi.fn();
		renderHook(() => useMfaSsoAutoSignIn(signIn, false), {
			wrapper: wrapperFor('/devices'),
		});
		expect(signIn).not.toHaveBeenCalled();

		// guard 未被消耗：同一页面内真回跳（带标记）仍会续跑一次
		renderHook(() => useMfaSsoAutoSignIn(signIn, false), {
			wrapper: wrapperFor('/devices?mfa_sso=1'),
		});
		expect(signIn).toHaveBeenCalledTimes(1);
	});
});
