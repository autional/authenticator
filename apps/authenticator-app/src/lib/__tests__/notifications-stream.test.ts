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
