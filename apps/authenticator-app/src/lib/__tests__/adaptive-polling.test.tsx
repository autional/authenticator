import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useCallback } from 'react';

/**
 * SSE 优先自适应轮询回归锁：
 *   ① 流 open → 60s（SSE 即时推送，轮询只兜底）；
 *   ② 流非 open（error/closed/未建连）→ 15s；
 *   ③ 「非 open → open」立即补一次（断线空窗期的推送不会重放）；
 *   ④ 回前台立即补一次；页面不可见时两个粒度都不刷新；
 *   ⑤ enabled=false（未登录）→ 不挂定时器、不刷新。
 */

import {
	FALLBACK_POLL_INTERVAL_MS,
	STREAM_POLL_INTERVAL_MS,
	pollIntervalFor,
	refreshModeFor,
	useAdaptivePolling,
} from '../adaptive-polling';
import { STREAM_STATUS_EVENT, type StreamStatus } from '../notifications-stream';

const calls: number[] = [];

function Harness({ enabled = true }: { enabled?: boolean }) {
	const run = useCallback(() => {
		calls.push(Date.now());
	}, []);
	const { mode, intervalMs } = useAdaptivePolling({ enabled, tag: 'test', run });
	return (
		<div data-testid="status" data-mode={mode} data-interval={intervalMs}>
			{mode}
		</div>
	);
}

function emitStatus(status: StreamStatus) {
	act(() => {
		window.dispatchEvent(new CustomEvent(STREAM_STATUS_EVENT, { detail: status }));
	});
}

function setVisibility(state: 'visible' | 'hidden') {
	Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

function restoreVisibility() {
	delete (document as unknown as Record<string, unknown>).visibilityState;
}

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

beforeEach(() => {
	calls.length = 0;
	setVisibility('visible');
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	restoreVisibility();
});

describe('pollIntervalFor / refreshModeFor', () => {
	it('open → 60s/sse；error 与 closed → 15s/polling', () => {
		expect(pollIntervalFor('open')).toBe(STREAM_POLL_INTERVAL_MS);
		expect(pollIntervalFor('error')).toBe(FALLBACK_POLL_INTERVAL_MS);
		expect(pollIntervalFor('closed')).toBe(FALLBACK_POLL_INTERVAL_MS);
		expect(refreshModeFor('open')).toBe('sse');
		expect(refreshModeFor('closed')).toBe('polling');
	});
});

describe('useAdaptivePolling', () => {
	it('流不可用 → 15s 一次', async () => {
		const { getByTestId } = render(<Harness />);
		emitStatus('error');
		expect(getByTestId('status').dataset.mode).toBe('polling');

		await advance(15000);
		expect(calls).toHaveLength(1);
		await advance(15000);
		expect(calls).toHaveLength(2);
	});

	it('流 open → 放宽到 60s（15s 到点不再请求）', async () => {
		const { getByTestId } = render(<Harness />);
		emitStatus('open');
		expect(getByTestId('status').dataset.mode).toBe('sse');
		expect(getByTestId('status').dataset.interval).toBe(String(STREAM_POLL_INTERVAL_MS));

		// 「非 open → open」的即时补拉 1 次
		expect(calls).toHaveLength(1);

		await advance(15000);
		expect(calls).toHaveLength(1);
		await advance(45000);
		expect(calls).toHaveLength(2);
	});

	it('非 open → open 事件立即补拉一次（不等周期）', async () => {
		render(<Harness />);
		emitStatus('error');
		expect(calls).toHaveLength(0);

		emitStatus('open');
		expect(calls).toHaveLength(1);
	});

	it('页面不可见 → 不刷新（open 补拉与周期都被跳过），回前台立即补一次', async () => {
		setVisibility('hidden');
		render(<Harness />);

		emitStatus('open');
		expect(calls).toHaveLength(0);

		await advance(120000);
		expect(calls).toHaveLength(0);

		setVisibility('visible');
		await act(async () => {
			document.dispatchEvent(new Event('visibilitychange'));
		});
		expect(calls).toHaveLength(1);
	});

	it('enabled=false（未登录）→ 不刷新', async () => {
		render(<Harness enabled={false} />);
		emitStatus('open');
		emitStatus('error');
		await advance(120000);
		expect(calls).toHaveLength(0);
	});

	it('卸载后定时器清理，不再刷新', async () => {
		const { unmount } = render(<Harness />);
		emitStatus('error');
		await advance(15000);
		expect(calls).toHaveLength(1);

		unmount();
		await advance(120000);
		expect(calls).toHaveLength(1);
	});
});
