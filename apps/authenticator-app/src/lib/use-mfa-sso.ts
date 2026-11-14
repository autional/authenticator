/**
 * 「用本机验证器登录」回到 App 后的续跑。
 *
 * 跳转链：App（保险库页）→ auth 登录页（带 #mfa_ticket，只需输密码）→ 回跳 App
 * 的同一个页面（回跳地址带 `?mfa_sso=1`）。此时 auth 域已有会话，但 App 还没有令牌，
 * 所以这里静默再走一次现有 `signIn()`（OAuth：auth 域有会话 → 直接回跳带 code →
 * 完成登录），用户不会再看到第二个登录界面。
 *
 * 一次性：标记先被从地址栏摘掉，再发起登录；「回跳目标」读的就是当前地址，
 * 所以不会把 `mfa_sso=1` 带进下一次回跳（登录失败也不会无限重放）。
 * 模块级 guard 兜住同一页面内的重复挂载（ServerOnly 会随路由反复挂/卸）。
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { hasMfaSsoFlag, stripMfaSsoFlag } from './mfa-sso';

let mfaSsoHandled = false;

/** 仅供测试：重置模块级一次性 guard。 */
export function resetMfaSsoGuard(): void {
	mfaSsoHandled = false;
}

export function useMfaSsoAutoSignIn(signIn: () => void, isAuthenticated: boolean): void {
	const { pathname, search, hash } = useLocation();
	const fired = useRef(false);

	useEffect(() => {
		if (isAuthenticated || fired.current || mfaSsoHandled) return;
		if (!hasMfaSsoFlag(search)) return;
		fired.current = true;
		mfaSsoHandled = true;
		try {
			const next = `${pathname}${stripMfaSsoFlag(search)}${hash}`;
			window.history.replaceState(window.history.state, '', next);
		} catch {
			/* 地址栏不可写（极端沙箱）：仍有 fired / 模块级 guard 兜底，不会重复触发 */
		}
		signIn();
	}, [isAuthenticated, pathname, search, hash, signIn]);
}
