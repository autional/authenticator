/**
 * 「用本机验证器登录」回到 App 后的续跑。
 *
 * 跳转链：App（任意页面）→ auth 登录页（带 #mfa_ticket，只需输密码）→ 回跳 App
 * 的同一个页面（回跳地址带 `?mfa_sso=1`）。此时 auth 域已有会话，但 App 还没有令牌，
 * 所以这里静默再走一次登录（OAuth：auth 域有会话 → 直接回跳带 code → 完成登录），
 * 用户不会再看到第二个登录界面。
 *
 * 一次性（三道闸，缺一不可）：
 * 1. 标记先被从地址栏摘掉，再发起登录；「回跳目标」读的就是当前地址，
 *    所以不会把 `mfa_sso=1` 带进下一次回跳（登录失败也不会无限重放）；
 * 2. 模块级 guard 兜住同一页面内的重复挂载（StrictMode 双挂载、路由反复挂/卸）；
 * 3. sessionStorage 一次性标记兜住「整页重载 / 回退到同一地址」——同一次会话里
 *    只自动续跑一次，避免 dev 下热重载或被反复弹出的登录页卡成循环。
 *
 * 已登录时：顺手把地址栏上的标记摘掉（它已完成使命），并清掉一次性标记。
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { hasMfaSsoFlag, stripMfaSsoFlag } from './mfa-sso';

/** 一次性标记：本次会话是否已经发起过「回跳后自动续跑」。 */
export const MFA_SSO_ATTEMPT_KEY = 'mfa_sso_auto_attempted';

let mfaSsoHandled = false;

/** 仅供测试：重置模块级一次性 guard（**不动**会话级标记，便于模拟整页重载）。 */
export function resetMfaSsoGuard(): void {
	mfaSsoHandled = false;
}

/** 清掉会话级一次性标记（登录成功后 / 测试重置时调用）。 */
export function clearMfaSsoAttempted(): void {
	try {
		window.sessionStorage.removeItem(MFA_SSO_ATTEMPT_KEY);
	} catch {
		/* 隐私模式/配额：忽略 —— 还有模块级 guard 兜底 */
	}
}

function hasAttempted(): boolean {
	try {
		return window.sessionStorage.getItem(MFA_SSO_ATTEMPT_KEY) === '1';
	} catch {
		return false;
	}
}

function markAttempted(): void {
	try {
		window.sessionStorage.setItem(MFA_SSO_ATTEMPT_KEY, '1');
	} catch {
		/* 同上 */
	}
}

/** 从地址栏摘掉标记（不改 path / 其它参数 / hash）。 */
function stripFlagFromAddress(pathname: string, search: string, hash: string): void {
	if (!hasMfaSsoFlag(search)) return;
	try {
		const next = `${pathname}${stripMfaSsoFlag(search)}${hash}`;
		window.history.replaceState(window.history.state, '', next);
	} catch {
		/* 地址栏不可写（极端沙箱）：仍有 guard 兜底，不会重复触发 */
	}
}

export function useMfaSsoAutoSignIn(signIn: () => void, isAuthenticated: boolean): void {
	const { pathname, search, hash } = useLocation();
	const fired = useRef(false);

	useEffect(() => {
		// 已登录：本次回跳已经完成使命 —— 摘掉标记、清掉一次性标记，不再发起登录。
		if (isAuthenticated) {
			clearMfaSsoAttempted();
			stripFlagFromAddress(pathname, search, hash);
			return;
		}
		if (fired.current || mfaSsoHandled) return;
		if (!hasMfaSsoFlag(search)) return;

		// 本次会话已经自动续跑过 → 只摘标记，不再发起（防止反复跳登录页成环）。
		if (hasAttempted()) {
			fired.current = true;
			mfaSsoHandled = true;
			stripFlagFromAddress(pathname, search, hash);
			return;
		}

		fired.current = true;
		mfaSsoHandled = true;
		markAttempted();
		stripFlagFromAddress(pathname, search, hash);
		signIn();
	}, [isAuthenticated, pathname, search, hash, signIn]);
}
