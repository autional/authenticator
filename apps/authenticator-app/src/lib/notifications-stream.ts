/**
 * 通知 SSE 流（前端）
 *
 * 契约（notification-service）：
 *   POST /notification/api/v1/notifications/stream-ticket  → { ticket }  （需登录；一次性、60s 内有效）
 *   GET  /notification/api/v1/notifications/stream?ticket=… （text/event-stream；心跳 + data:<通知JSON>）
 *
 * 安全约束（2026-11-10）：订阅身份**只**来自票据（服务端由票据 claims 解出 tenant/user），
 * 前端**不传** user_id —— 避免"持自己的令牌订阅别人的消息"这类横向风险。
 * 登出/卸载即关闭连接；断线重连会重新申请票据，指数退避上限 30s。
 *
 * 令牌能力不足（票据 403）：`write` scope 只在登录时申请，老令牌**重试永远 403**。
 * 此时不再指数退避（1s→2s→…→30s 只会刷屏日志），而是
 *   ① 广播 `autional:needs-relogin` 全局信号（banner 提示重新登录）；
 *   ② 状态置 `auth-required`；
 *   ③ 降为 5 分钟一次的低频重试（换个标签页重新登录后仍能自愈，不靠刷新页面）。
 */
import { API_BASE_URL, apiClient } from '@autional/shared';
import { notifyNeedsRelogin } from './relogin';

export interface StreamNotification {
	id?: string;
	type?: string;
	title?: string;
	body?: string;
	read?: boolean;
	[key: string]: unknown;
}

export type StreamStatus = 'open' | 'error' | 'closed' | 'auth-required';

export interface StreamHandle {
	close(): void;
}

const TICKET_PATH = '/notification/api/v1/notifications/stream-ticket';
const STREAM_PATH = '/notification/api/v1/notifications/stream';

/**
 * 票据 403 后的重试间隔：5 分钟一次（低频，只为「另一标签页重新登录」后自愈）。
 * 常规断线仍走 1s→2s→…→30s 的指数退避。
 */
const AUTH_REQUIRED_RETRY_MS = 5 * 60_000;

/** 流状态广播事件（detail = StreamStatus）。轮询侧据此决定兜底粒度。 */
export const STREAM_STATUS_EVENT = 'autional:stream-status';

let currentStatus: StreamStatus = 'closed';

/** 当前流状态（后挂载的消费者用它做初值，避免错过已发生的 open 事件）。 */
export function getStreamStatus(): StreamStatus {
	return currentStatus;
}

/** 只在状态**变化**时广播：断线重连期间会反复 error，不该放大成事件风暴。 */
function publishStatus(status: StreamStatus): void {
	if (currentStatus === status) return;
	currentStatus = status;
	try {
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent<StreamStatus>(STREAM_STATUS_EVENT, { detail: status }));
		}
	} catch {
		/* 广播失败不影响连接本身 */
	}
}

/** 申请一次性流票据（走统一 apiClient，自动带登录态与租户头）。 */
export async function createStreamTicket(): Promise<string> {
	const res = (await apiClient.post(TICKET_PATH, {})) as
		| { ticket?: string; data?: { ticket?: string } }
		| undefined;
	const ticket = res?.ticket ?? res?.data?.ticket ?? '';
	if (!ticket) throw new Error('stream ticket missing');
	return ticket;
}

/**
 * 是不是「令牌能力不足」类 403。
 * 结构判定（axios 错误的 `response.status` / 归一错误自带的 `status`），不引入 axios 运行时依赖。
 */
export function isForbiddenError(error: unknown): boolean {
	const err = error as { status?: number; response?: { status?: number } } | null;
	return (err?.response?.status ?? err?.status) === 403;
}

export function openNotificationStream(opts: {
	onNotification: (n: StreamNotification) => void;
	onStatus?: (s: StreamStatus) => void;
}): StreamHandle {
	// 状态既有回调也有广播：回调给持有连接的人（App.tsx），广播给任何页面（自适应轮询）。
	const emitStatus = (status: StreamStatus) => {
		publishStatus(status);
		opts.onStatus?.(status);
	};
	let closed = false;
	let es: EventSource | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let retry = 0;

	const schedule = () => {
		if (closed) return;
		const delay = Math.min(30_000, 1_000 * 2 ** retry);
		retry += 1;
		timer = setTimeout(() => void connect(), delay);
	};

	/** 令牌能力不足：不刷屏重试，只留 5 分钟一次的低频自愈尝试。 */
	const scheduleAuthRequired = () => {
		if (closed) return;
		retry = 0;
		timer = setTimeout(() => void connect(), AUTH_REQUIRED_RETRY_MS);
	};

	const connect = async () => {
		if (closed) return;
		try {
			const ticket = await createStreamTicket();
			if (closed) return;
			es = new EventSource(`${API_BASE_URL}${STREAM_PATH}?ticket=${encodeURIComponent(ticket)}`, {
				withCredentials: true,
			});
			es.onopen = () => {
				retry = 0;
				emitStatus('open');
			};
			es.onmessage = (ev: MessageEvent<string>) => {
				try {
					opts.onNotification(JSON.parse(ev.data) as StreamNotification);
				} catch {
					/* 非 JSON（心跳等）忽略 */
				}
			};
			es.onerror = () => {
				es?.close();
				es = null;
				emitStatus('error');
				schedule();
			};
		} catch (err) {
			// 403 = 令牌缺 write scope：重新登录才能修，重试只会刷屏
			if (isForbiddenError(err)) {
				notifyNeedsRelogin('stream-ticket-403');
				emitStatus('auth-required');
				scheduleAuthRequired();
				return;
			}
			emitStatus('error');
			schedule();
		}
	};

	void connect();

	return {
		close() {
			closed = true;
			if (timer) clearTimeout(timer);
			timer = null;
			es?.close();
			es = null;
			emitStatus('closed');
		},
	};
}
