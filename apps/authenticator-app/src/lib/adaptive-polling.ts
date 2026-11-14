/**
 * SSE 优先的自适应轮询（App 侧）。
 *
 * 口径（2026-11-13 产品决定：SSE 优先、推送为可选后台补充）：
 *   - 通知流 `open` → 推送即时到达，轮询降级为 **60s 兜底**（防漏帧/重连窗口）；
 *   - 流非 `open`（`error`/`closed`/`auth-required`/尚未建连）→ **15s**，与旧行为一致，不让体验变差；
 *     `auth-required`（票据 403，令牌缺 write scope）同样落到 15s：SSE 修不好之前
 *     轮询是**唯一**的数据来源，此时反而更不能降频；
 *   - 「非 open → open」或「页面由不可见变可见」→ **立即补拉一次**（这段空窗可能漏掉推送）；
 *   - 页面不可见时暂停（不空烧请求，也不因后台标签页放大服务端压力）。
 *
 * 为什么要统一在这里：
 *   底栏角标与 `/approvals` 页此前各自写死 15s + 各自的 visibility 监听，SSE 接通后
 *   仍在 15s 空跑；两条路径规则一旦分叉就会一边 60s 一边 15s。收敛成一条规则后，
 *   只有「流状态」这一个输入决定粒度。
 *
 * 状态来源：`notifications-stream.ts` 在 onopen/onerror/close 广播 `autional:stream-status`
 *   （全站唯一连接由 App.tsx 持有，页面只订阅广播，不再自开 EventSource）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { STREAM_STATUS_EVENT, getStreamStatus, type StreamStatus } from './notifications-stream';

/** 流已连通：只做兜底。 */
export const STREAM_POLL_INTERVAL_MS = 60_000;
/** 流不可用：保持旧的 15s 及时性。 */
export const FALLBACK_POLL_INTERVAL_MS = 15_000;

export type RefreshMode = 'sse' | 'polling';

/** 轮询粒度只由流状态决定（纯函数，便于测试与排障）。 */
export function pollIntervalFor(status: StreamStatus): number {
	return status === 'open' ? STREAM_POLL_INTERVAL_MS : FALLBACK_POLL_INTERVAL_MS;
}

export function refreshModeFor(status: StreamStatus): RefreshMode {
	return status === 'open' ? 'sse' : 'polling';
}

function normalizeStatus(value: unknown): StreamStatus | null {
	return value === 'open' || value === 'error' || value === 'closed' || value === 'auth-required'
		? value
		: null;
}

/** 订阅流状态：初值取模块内当前状态（后挂载的页面不会错过已发生的 open）。 */
export function useStreamStatus(): StreamStatus {
	const [status, setStatus] = useState<StreamStatus>(() => getStreamStatus());

	useEffect(() => {
		const onStatusChange = (event: Event) => {
			const next = normalizeStatus((event as CustomEvent<unknown>).detail);
			if (next) setStatus(next);
		};
		window.addEventListener(STREAM_STATUS_EVENT, onStatusChange);
		// 挂载与订阅之间可能刚好发生一次状态切换 → 订阅后立刻对齐一次
		setStatus(getStreamStatus());
		return () => window.removeEventListener(STREAM_STATUS_EVENT, onStatusChange);
	}, []);

	return status;
}

function pageVisible(): boolean {
	return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * 自适应刷新：`run` 由调用方提供（通常是「静默拉一次」，失败自行吞掉）。
 * - `tag` 只用于 console.debug 排障标签，不含任何用户标识。
 * - `enabled=false`（未登录）时完全不挂定时器/监听。
 */
export function useAdaptivePolling(options: {
	enabled: boolean;
	tag: string;
	run: () => void;
}): { mode: RefreshMode; intervalMs: number } {
	const { enabled, tag, run } = options;
	const status = useStreamStatus();
	const mode = refreshModeFor(status);
	const intervalMs = pollIntervalFor(status);

	// 最新回调放 ref：调用方每次渲染新建闭包也不重建定时器
	const runRef = useRef(run);
	runRef.current = run;

	const refreshIfVisible = useCallback(() => {
		if (!pageVisible()) return;
		runRef.current();
	}, []);

	// 周期兜底：粒度随流状态切换（15s ↔ 60s）
	useEffect(() => {
		if (!enabled) return;
		const timer = setInterval(refreshIfVisible, intervalMs);
		return () => clearInterval(timer);
	}, [enabled, intervalMs, refreshIfVisible]);

	// 流刚连通（此前非 open）→ 立即补一次：断线期间到达的推送不会重放
	const previousStatus = useRef<StreamStatus | null>(null);
	useEffect(() => {
		if (!enabled) {
			previousStatus.current = null;
			return;
		}
		const previous = previousStatus.current;
		previousStatus.current = status;
		if (previous != null && previous !== 'open' && status === 'open') refreshIfVisible();
	}, [enabled, status, refreshIfVisible]);

	// 回到前台 → 立即补一次（后台期间的周期被跳过）
	useEffect(() => {
		if (!enabled) return;
		const onVisibilityChange = () => refreshIfVisible();
		document.addEventListener('visibilitychange', onVisibilityChange);
		return () => document.removeEventListener('visibilitychange', onVisibilityChange);
	}, [enabled, refreshIfVisible]);

	// 模式切换打一次 debug（生产保留，排障用；不含用户标识）
	const loggedMode = useRef('');
	useEffect(() => {
		if (!enabled) {
			loggedMode.current = '';
			return;
		}
		const key = `${tag}|${mode}|${intervalMs}`;
		if (loggedMode.current === key) return;
		loggedMode.current = key;
		console.debug(
			`[authenticator] ${tag} refresh mode=${mode} poll=${Math.round(intervalMs / 1000)}s`,
		);
	}, [enabled, tag, mode, intervalMs]);

	return { mode, intervalMs };
}
