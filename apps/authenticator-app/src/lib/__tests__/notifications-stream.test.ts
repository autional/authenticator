import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const post = vi.fn();

vi.mock('@autional/shared', () => ({
	API_BASE_URL: 'https://api.example.test/bff',
	apiClient: { post: (...args: unknown[]) => post(...args) },
}));

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	url: string;
	withCredentials?: boolean;
	onopen?: () => void;
	onmessage?: (ev: { data: string }) => void;
	onerror?: () => void;
	closed = false;
	constructor(url: string, opts?: { withCredentials?: boolean }) {
		this.url = url;
		this.withCredentials = opts?.withCredentials;
		FakeEventSource.instances.push(this);
	}
	close() {
		this.closed = true;
	}
}

describe('openNotificationStream', () => {
	beforeEach(() => {
		post.mockReset();
		FakeEventSource.instances = [];
		(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('申请一次性票据后建流，并把 data 帧回调给调用方', async () => {
		post.mockResolvedValue({ ticket: 'tk-1' });
		const { openNotificationStream } = await import('../notifications-stream');
		const got: Array<{ id?: string; title?: string }> = [];

		const handle = openNotificationStream({ onNotification: (n) => got.push(n) });
		await Promise.resolve();
		await Promise.resolve();

		expect(post).toHaveBeenCalledWith('/notification/api/v1/notifications/stream-ticket', {});
		const es = FakeEventSource.instances[0];
		expect(es).toBeTruthy();
		expect(es.url).toContain('/notification/api/v1/notifications/stream');
		expect(es.url).toContain('ticket=tk-1');

		es.onmessage?.({ data: '{"id":"n1","title":"hi"}' });
		expect(got[0]?.id).toBe('n1');

		// 非 JSON（心跳等）不应影响调用方
		es.onmessage?.({ data: 'heartbeat' });
		expect(got).toHaveLength(1);

		handle.close();
		expect(es.closed).toBe(true);
	});

	it('订阅身份只来自票据：URL 里不得出现 user_id（防横向越权）', async () => {
		post.mockResolvedValue({ ticket: 'tk-2' });
		const { openNotificationStream } = await import('../notifications-stream');
		const handle = openNotificationStream({ onNotification: () => {} });
		await Promise.resolve();
		await Promise.resolve();

		const es = FakeEventSource.instances[0];
		expect(es.url).not.toContain('user_id=');
		expect(es.withCredentials).toBe(true);
		handle.close();
	});
});

/**
 * 老会话没有 write scope（scope 只在登录时申请）→ 票据接口 403。
 * 重试同一个令牌永远 403，所以不许指数退避刷屏：只广播一次「需要重新登录」，
 * 状态置 auth-required，重试粒度降到 5 分钟。
 */
describe('openNotificationStream（票据 403 = 令牌能力不足）', () => {
	let reloginEvents: Array<{ reason?: string }> = [];

	const onRelogin = (event: Event) => {
		reloginEvents.push((event as CustomEvent<{ reason?: string }>).detail ?? {});
	};

	beforeEach(() => {
		post.mockReset();
		FakeEventSource.instances = [];
		(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
		reloginEvents = [];
		window.addEventListener('autional:needs-relogin', onRelogin);
		vi.useFakeTimers();
	});

	afterEach(() => {
		window.removeEventListener('autional:needs-relogin', onRelogin);
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('403 → 广播 needs-relogin、状态 auth-required、且不再高频重试', async () => {
		post.mockRejectedValue({ isAxiosError: true, response: { status: 403 } });
		const { openNotificationStream, getStreamStatus } = await import('../notifications-stream');

		const statuses: string[] = [];
		const handle = openNotificationStream({
			onNotification: () => {},
			onStatus: (s) => statuses.push(s),
		});

		await vi.advanceTimersByTimeAsync(0);

		expect(reloginEvents).toEqual([{ reason: 'stream-ticket-403' }]);
		expect(statuses).toContain('auth-required');
		expect(getStreamStatus()).toBe('auth-required');
		expect(post).toHaveBeenCalledTimes(1);

		// 旧行为：1s 后重试 → 60s 内会打 7 次以上。新行为：一次都不打。
		await vi.advanceTimersByTimeAsync(60_000);
		expect(post).toHaveBeenCalledTimes(1);
		expect(reloginEvents).toHaveLength(1);

		// 低频自愈：5 分钟后一次（换个标签页重新登录后不刷新页面也能恢复）
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(post).toHaveBeenCalledTimes(2);

		handle.close();
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(post).toHaveBeenCalledTimes(2);
	});

	it('非 403 的失败仍走指数退避，且不触发重登提示', async () => {
		post.mockRejectedValue({ isAxiosError: true, response: { status: 500 } });
		const { openNotificationStream } = await import('../notifications-stream');
		const statuses: string[] = [];
		const handle = openNotificationStream({
			onNotification: () => {},
			onStatus: (s) => statuses.push(s),
		});

		await vi.advanceTimersByTimeAsync(0);
		expect(post).toHaveBeenCalledTimes(1);
		expect(reloginEvents).toHaveLength(0);
		expect(statuses).toContain('error');

		await vi.advanceTimersByTimeAsync(1_000);
		expect(post).toHaveBeenCalledTimes(2);

		handle.close();
	});
});
