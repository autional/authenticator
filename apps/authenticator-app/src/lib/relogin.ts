/**
 * 全局「需要重新登录」信号（前端）。
 *
 * 起因：`write` scope 只在**登录时**申请。老会话拿到的令牌没有 write，
 *   刷新令牌继承签发时的 scope ⇒ 任何写接口（`stream-ticket` / `push/subscriptions`）
 *   都会 403，**重试同一个令牌永远 403**，只有重新登录能修。
 *
 * 因此把「令牌能力不足」收敛成一条全局信号：
 *   - 产生方（`notifications-stream.ts` 的票据 403、推送开关的登记 403）各自判定；
 *   - 消费方（`ReloginNotice` banner）只订阅事件，不关心具体接口；
 *   - UI **不暴露** 403 / scope 之类的技术细节，只说「需要重新登录」。
 *
 * 语义约束：
 *   - 事件 detail 只带 `reason`（排障用），不含任何用户标识与令牌；
 *   - 模块内记一个「待处理」标记，让后挂载的 banner 不会错过已发生的信号；
 *   - `dismiss()` 只清本次会话的提示（用户点过「关闭」），不改变服务端状态。
 */
import { useCallback, useEffect, useState } from 'react';

/** 广播事件名（detail = NeedsReloginDetail）。 */
export const NEEDS_RELOGIN_EVENT = 'autional:needs-relogin';

/** 触发原因（仅排障与测试用，不渲染到界面）。 */
export type NeedsReloginReason = 'stream-ticket-403';

export interface NeedsReloginDetail {
	reason: NeedsReloginReason;
}

/** 待处理标记：banner 后挂载时用它做初值。 */
let pendingReason: NeedsReloginReason | null = null;

/** 用户在本会话里点过「关闭」：不再弹（页面刷新/重新登录后自然复位）。 */
let dismissed = false;

/** 广播「需要重新登录」（幂等：重复广播只更新标记，banner 不会重复出现）。 */
export function notifyNeedsRelogin(reason: NeedsReloginReason): void {
	// 用户已经明确关掉提示：本次会话不再打扰（信号本身仍可从设置页/推送开关处看到）
	if (dismissed) return;
	pendingReason = reason;
	if (typeof window === 'undefined') return;
	try {
		window.dispatchEvent(
			new CustomEvent<NeedsReloginDetail>(NEEDS_RELOGIN_EVENT, { detail: { reason } }),
		);
	} catch {
		/* 广播失败不影响业务请求本身 */
	}
}

/** 当前是否有未处理的「需要重新登录」信号。 */
export function getNeedsReloginReason(): NeedsReloginReason | null {
	return pendingReason;
}

/** 清除信号（用户点了「关闭」）：本次会话内后续同类信号不再弹。 */
export function clearNeedsRelogin(): void {
	dismissed = true;
	pendingReason = null;
}

/**
 * 订阅「需要重新登录」信号。
 * 初值取模块内标记：banner 挂载晚于事件（例如令牌在启动时就被拒）也不会漏。
 */
export function useNeedsRelogin(): { active: boolean; dismiss: () => void } {
	const [active, setActive] = useState(() => pendingReason !== null);

	useEffect(() => {
		const onSignal = () => setActive(true);
		window.addEventListener(NEEDS_RELOGIN_EVENT, onSignal);
		// 订阅与首帧之间可能刚好发生一次信号 → 订阅后立刻对齐
		setActive(pendingReason !== null);
		return () => window.removeEventListener(NEEDS_RELOGIN_EVENT, onSignal);
	}, []);

	const dismiss = useCallback(() => {
		clearNeedsRelogin();
		setActive(false);
	}, []);

	return { active, dismiss };
}
