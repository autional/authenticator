/**
 * 「用本机验证器登录」回到 App 后的续跑。
 *
 * 跳转链：App（任意页面）→ auth 登录页（带 #mfa_ticket，只需输密码）→ 回跳 App
 * 的同一个页面（回跳地址带 `?mfa_sso=1`）。此时 auth 域已有会话，但 App 还没有令牌，
 * 所以这里静默再走一次登录（OAuth：auth 域有会话 → 直接回跳带 code → 完成登录），
 * 用户不会再看到第二个登录界面。
 *
 * 一次性（两道闸，缺一不可）：
 * 1. 标记**先**被从地址栏摘掉，**再**发起登录；「回跳目标」读的就是当前地址，
 *    所以不会把 `mfa_sso=1` 带进下一次回跳 —— 失败回跳不会重放；
 * 2. 模块级 guard + 每次挂载的 `fired` ref 兜住同一页面内的重复挂载（StrictMode
 *    双挂载、路由反复挂/卸、父组件重渲染）。
 *
 * 为什么**不再**需要「跨整页重载」的一次性标记（曾经用 sessionStorage）：
 * - 续跑的地址栏标记在发起前就摘掉了，所以「失败回跳」本身不会再带标记；
 * - 下一次自动续跑只可能来自一次**新的整页导航**（用户重新点登录 → auth → 回跳），
 *   而整页加载会把模块级 guard 重置 —— 幂等性由第 1 道闸保证，不需要跨重载状态；
 * - 反过来，sessionStorage 版本是 fail-closed 的：首次自动 OAuth 只要失败一次
 *   （consent 页没点、网络抖动、任何异常），同一标签页内之后每次登录都会看到
 *   「已经尝试过」而**不再发起 OAuth**，永久停在登录按钮 —— 只有新标签页或清
 *   sessionStorage 才能恢复。用户没有任何可自愈的路径，属于必须移除的故障注入点。
 *
 * 已登录时：顺手把地址栏上的标记摘掉（它已完成使命），不发起登录。
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { hasMfaSsoFlag, stripMfaSsoFlag } from './mfa-sso';
import { reportMfaSsoFailure } from './mfa-sso-report';

let mfaSsoHandled = false;

/**
 * 仅供测试：重置模块级一次性 guard。
 * 真实场景不会调用它 —— 模拟「整页重新加载」（模块状态随之清零）。
 */
export function resetMfaSsoGuard(): void {
	mfaSsoHandled = false;
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

/** 续跑函数可能是 async（OAuth 发起），也可能同步抛错 —— 两种都要记一笔。 */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}

export function useMfaSsoAutoSignIn(
	signIn: () => void | PromiseLike<unknown>,
	isAuthenticated: boolean,
): void {
	const { pathname, search, hash } = useLocation();
	const fired = useRef(false);

	useEffect(() => {
		// 已登录：本次回跳已经完成使命 —— 只摘标记，不再发起登录。
		if (isAuthenticated) {
			stripFlagFromAddress(pathname, search, hash);
			return;
		}
		if (fired.current || mfaSsoHandled) return;
		if (!hasMfaSsoFlag(search)) return;

		// 两道闸都先落位，再走副作用：无论成功失败，本次挂载/本次页面都不再重复发起。
		fired.current = true;
		mfaSsoHandled = true;
		stripFlagFromAddress(pathname, search, hash);

		try {
			const result = signIn();
			if (isPromiseLike(result)) {
				// 失败只记录、不重试：用户可以再点登录（新的一次整页导航）。
				void Promise.resolve(result).catch((error: unknown) => {
					reportMfaSsoFailure('auto-continue', error);
				});
			}
		} catch (error) {
			reportMfaSsoFailure('auto-continue', error);
		}
	}, [isAuthenticated, pathname, search, hash, signIn]);
}
