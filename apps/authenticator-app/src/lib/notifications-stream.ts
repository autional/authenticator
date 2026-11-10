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
 */
import { API_BASE_URL, apiClient } from '@autional/shared';

export interface StreamNotification {
	id?: string;
	type?: string;
	title?: string;
	body?: string;
	read?: boolean;
	[key: string]: unknown;
}

export type StreamStatus = 'open' | 'error' | 'closed';

export interface StreamHandle {
	close(): void;
}

const TICKET_PATH = '/notification/api/v1/notifications/stream-ticket';
const STREAM_PATH = '/notification/api/v1/notifications/stream';

/** 申请一次性流票据（走统一 apiClient，自动带登录态与租户头）。 */
export async function createStreamTicket(): Promise<string> {
	const res = (await apiClient.post(TICKET_PATH, {})) as
		| { ticket?: string; data?: { ticket?: string } }
		| undefined;
	const ticket = res?.ticket ?? res?.data?.ticket ?? '';
	if (!ticket) throw new Error('stream ticket missing');
	return ticket;
}

export function openNotificationStream(opts: {
	onNotification: (n: StreamNotification) => void;
	onStatus?: (s: StreamStatus) => void;
}): StreamHandle {
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
				opts.onStatus?.('open');
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
				opts.onStatus?.('error');
				schedule();
			};
		} catch {
			opts.onStatus?.('error');
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
			opts.onStatus?.('closed');
		},
	};
}
