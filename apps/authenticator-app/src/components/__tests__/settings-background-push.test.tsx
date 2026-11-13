import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

/**
 * 设置页「后台审批通知」开关回归锁：
 *   ① unsupported / ios-not-installed / denied → 开关置灰 + 各自解释文案（点了也不发请求）；
 *   ② 开启成功 → enablePush 被调用一次，开关变 checked；
 *   ③ 关闭 → disablePush 被调用一次，开关回 false；
 *   ④ 失败 → 只报可读错误，开关状态**不变**（不假装成功）；
 *   ⑤ 处理中禁用（防重复点击 → 防重复登记）。
 */

const { mockGetState, mockEnable, mockDisable } = vi.hoisted(() => ({
	mockGetState: vi.fn(),
	mockEnable: vi.fn(),
	mockDisable: vi.fn(),
}));

vi.mock('@/lib/push-notifications', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/lib/push-notifications')>()),
	getPushState: (...args: unknown[]) => mockGetState(...args),
	enablePush: (...args: unknown[]) => mockEnable(...args),
	disablePush: (...args: unknown[]) => mockDisable(...args),
}));

import SettingsBackgroundPush from '../settings/SettingsBackgroundPush';
import { PushNotificationError } from '@/lib/push-notifications';

function renderRow() {
	return render(<SettingsBackgroundPush />);
}

async function flushInitialState() {
	await act(async () => {
		await Promise.resolve();
	});
}

function toggle(): HTMLElement {
	return screen.getByRole('switch', { name: '后台审批通知' });
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetState.mockResolvedValue('unsubscribed');
	mockEnable.mockResolvedValue('https://push.example.test/ep-1');
	mockDisable.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('SettingsBackgroundPush · 禁用态', () => {
	it('unsupported → 置灰并提示「当前浏览器不支持」', async () => {
		mockGetState.mockResolvedValue('unsupported');
		renderRow();
		await flushInitialState();

		expect(toggle()).toBeDisabled();
		expect(screen.getByText('当前浏览器不支持')).toBeInTheDocument();

		fireEvent.click(toggle());
		expect(mockEnable).not.toHaveBeenCalled();
	});

	it('ios-not-installed → 置灰并提示「添加到主屏幕」', async () => {
		mockGetState.mockResolvedValue('ios-not-installed');
		renderRow();
		await flushInitialState();

		expect(toggle()).toBeDisabled();
		expect(screen.getByText(/添加到主屏幕/)).toBeInTheDocument();
		expect(mockEnable).not.toHaveBeenCalled();
	});

	it('denied → 置灰并提示去系统设置允许', async () => {
		mockGetState.mockResolvedValue('denied');
		renderRow();
		await flushInitialState();

		expect(toggle()).toBeDisabled();
		expect(screen.getByText(/通知权限已被拒绝/)).toBeInTheDocument();
	});
});

describe('SettingsBackgroundPush · 开关行为', () => {
	it('默认关闭：标题与「SSE 已默认开启」说明同时展示', async () => {
		renderRow();
		await flushInitialState();

		expect(screen.getByText('后台审批通知')).toBeInTheDocument();
		expect(screen.getByText(/SSE/)).toBeInTheDocument();
		expect(toggle()).not.toBeDisabled();
		expect(toggle().getAttribute('aria-checked')).toBe('false');
	});

	it('开启成功 → enablePush 一次、开关变 checked', async () => {
		renderRow();
		await flushInitialState();

		await act(async () => {
			fireEvent.click(toggle());
		});

		expect(mockEnable).toHaveBeenCalledTimes(1);
		expect(toggle().getAttribute('aria-checked')).toBe('true');
	});

	it('关闭成功 → disablePush 一次、开关回 false', async () => {
		mockGetState.mockResolvedValue('subscribed');
		renderRow();
		await flushInitialState();
		expect(toggle().getAttribute('aria-checked')).toBe('true');

		await act(async () => {
			fireEvent.click(toggle());
		});

		expect(mockDisable).toHaveBeenCalledTimes(1);
		expect(toggle().getAttribute('aria-checked')).toBe('false');
	});

	it('开启失败 → 报可读错误且开关不变（不假装成功）', async () => {
		mockEnable.mockRejectedValue(new PushNotificationError('register-failed'));
		renderRow();
		await flushInitialState();

		await act(async () => {
			fireEvent.click(toggle());
		});

		expect(toggle().getAttribute('aria-checked')).toBe('false');
		expect(screen.getByRole('alert')).toHaveTextContent('设备登记失败');
	});

	it('关闭失败 → 保留已开启状态并提示解绑失败', async () => {
		mockGetState.mockResolvedValue('subscribed');
		mockDisable.mockRejectedValue(new PushNotificationError('unbind-failed'));
		renderRow();
		await flushInitialState();

		await act(async () => {
			fireEvent.click(toggle());
		});

		expect(toggle().getAttribute('aria-checked')).toBe('true');
		expect(screen.getByRole('alert')).toHaveTextContent('解绑失败');
	});

	it('处理中禁用，重复点击不会再发请求', async () => {
		let resolveEnable: (value: string) => void = () => {};
		mockEnable.mockImplementation(
			() => new Promise<string>((resolve) => { resolveEnable = resolve; }),
		);
		renderRow();
		await flushInitialState();

		await act(async () => {
			fireEvent.click(toggle());
		});
		expect(toggle()).toBeDisabled();
		expect(toggle().getAttribute('aria-busy')).toBe('true');

		fireEvent.click(toggle());
		expect(mockEnable).toHaveBeenCalledTimes(1);

		await act(async () => {
			resolveEnable('https://push.example.test/ep-1');
			await Promise.resolve();
		});
		expect(toggle().getAttribute('aria-checked')).toBe('true');
		expect(toggle()).not.toBeDisabled();
	});
});
