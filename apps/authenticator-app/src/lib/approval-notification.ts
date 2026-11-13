/**
 * 通知流 → 「审批类通知」判定与即时刷新（App 侧）。
 *
 * 为什么是订阅广播、不是自己再开一条 SSE：
 *   App.tsx 的 LayoutWrapper 已经持有**全站唯一**的通知流连接（一次性票据 + EventSource），
 *   收到事件后 `window.dispatchEvent(new CustomEvent('autional:notification'))` 广播
 *   （见 App.tsx 注释「收到后广播事件，页面各自决定如何刷新」；notifications 页即此用法）。
 *   若各页面/底栏再各自 useNotificationStream，同一用户会多出 N 条长连接 + N 次票据请求，
 *   断线重连时还会成倍放大 —— 所以这里只订阅广播事件，连接数恒为 1。
 *
 * 判定（后端每次登录审批会建一条站内通知，metadata 含 action_url=/a/<code>、request_id、approval_code）：
 *   - `action_url` 以 `/a/` 开头 → 审批类；
 *   - 或带 `approval_code` / `request_id` → 审批类；
 *   - 或 `type` 含 `approval`（如 login_approval / approval_request）→ 审批类；
 *   - 其余（system / security / email …）一律忽略，不为无关通知刷新。
 *
 * 去重：同一 `approval_code`/`request_id`/`action_url` 在 2s 内重复到达只刷新一次
 *   —— 防止 SSE 重连后的补发、或同一审批的多次状态通知把请求放大。
 */

import { useEffect, useRef } from 'react';
import type { StreamNotification } from './notifications-stream';

/** App.tsx 广播的事件名（全站唯一 SSE 连接 → 广播 → 各页订阅）。 */
export const NOTIFICATION_EVENT = 'autional:notification';

/** 同一审批在窗口内重复通知只刷新一次。 */
export const APPROVAL_REFRESH_DEDUPE_MS = 2000;

const APPROVAL_ACTION_PREFIX = '/a/';

function asText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/** metadata 可能是对象，也可能是 JSON 字符串（服务端两种历史形态都有）；非法即空对象。 */
function metadataOf(notification: StreamNotification): Record<string, unknown> {
	const raw = notification.metadata;
	if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
	const serialized = asText(raw);
	if (!serialized) return {};
	try {
		const parsed: unknown = JSON.parse(serialized);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** 取值层：metadata 优先，顶层字段兜底（snake_case 与 camelCase 都认）。 */
function notificationLayers(notification: StreamNotification): Array<Record<string, unknown>> {
	return [metadataOf(notification), notification as Record<string, unknown>];
}

function firstText(layers: Array<Record<string, unknown>>, keys: string[]): string {
	for (const layer of layers) {
		for (const key of keys) {
			const value = asText(layer[key]);
			if (value) return value;
		}
	}
	return '';
}

/** 审批类通知判定（见文件头判定规则）；无字段/非对象一律 false。 */
export function isApprovalNotification(notification: StreamNotification | null | undefined): boolean {
	if (!notification || typeof notification !== 'object') return false;
	const layers = notificationLayers(notification);

	const actionUrl = firstText(layers, ['action_url', 'actionUrl']);
	if (actionUrl.startsWith(APPROVAL_ACTION_PREFIX)) return true;

	if (firstText(layers, ['approval_code', 'approvalCode'])) return true;

	const type = firstText(layers, ['type', 'notification_type', 'notificationType']).toLowerCase();
	return type.includes('approval');
}

/** 去重键：审批码 > 请求 id > 落地链接 > 通知 id（都没有返回空串 → 退化为「任意审批」键）。 */
export function approvalDedupeKey(notification: StreamNotification | null | undefined): string {
	if (!notification || typeof notification !== 'object') return '';
	const layers = notificationLayers(notification);
	return (
		firstText(layers, ['approval_code', 'approvalCode']) ||
		firstText(layers, ['request_id', 'requestId']) ||
		firstText(layers, ['action_url', 'actionUrl']) ||
		firstText(layers, ['id'])
	);
}

/**
 * 已登录时订阅通知广播，**审批类**通知到达即回调（静默刷新用），其它通知忽略。
 * - `enabled=false` 不挂监听（未登录本就没有流，也不该多发请求）；
 * - 回调放 ref，避免每次渲染重挂监听；
 * - 2s 内同一审批只回调一次（同一实例内计数，两个消费者各自独立去重）。
 */
export function useApprovalNotificationRefresh(enabled: boolean, onApproval: () => void): void {
	const callback = useRef(onApproval);
	callback.current = onApproval;

	useEffect(() => {
		if (!enabled) return;

		const seen = new Map<string, number>();
		const onEvent = (event: Event) => {
			const detail = (event as CustomEvent<StreamNotification | undefined>).detail;
			if (!isApprovalNotification(detail)) return;

			const key = approvalDedupeKey(detail) || '__any_approval__';
			const now = Date.now();
			const last = seen.get(key);
			if (last != null && now - last < APPROVAL_REFRESH_DEDUPE_MS) return;

			seen.set(key, now);
			// 长驻页面不无限增长：顺手清掉窗口外的键
			if (seen.size > 32) {
				for (const [seenKey, at] of seen) {
					if (now - at >= APPROVAL_REFRESH_DEDUPE_MS) seen.delete(seenKey);
				}
			}

			callback.current();
		};

		window.addEventListener(NOTIFICATION_EVENT, onEvent);
		return () => window.removeEventListener(NOTIFICATION_EVENT, onEvent);
	}, [enabled]);
}
