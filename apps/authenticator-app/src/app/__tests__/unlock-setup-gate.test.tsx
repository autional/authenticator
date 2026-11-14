import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

/**
 * 硬强制设锁：无 PIN 的库冷启动必须先设置 PIN（无跳过入口），
 * 设锁前不得渲染 children（否则等于「没提示就进去了」）。
 */

const storeState = vi.hoisted(() => ({
	isLoading: false,
	isUnlocked: false,
	hasPin: false,
	loadAccounts: vi.fn(),
	setHasPin: vi.fn(),
	setLoading: vi.fn(),
}));

vi.mock('@/lib/store', () => ({
	useAuthenticatorStore: (selector?: (s: typeof storeState) => unknown) =>
		typeof selector === 'function' ? selector(storeState) : storeState,
}));

vi.mock('@/lib/storage', () => ({
	unlockWithPin: vi.fn().mockResolvedValue([]),
	hasPinProtection: vi.fn(() => false),
	loadWithoutPin: vi.fn().mockResolvedValue([]),
	unlockWithBiometric: vi.fn().mockResolvedValue([]),
	hasBiometricProtection: vi.fn(() => false),
	getPinLength: vi.fn(() => null),
	setPinProtection: vi.fn().mockResolvedValue(undefined),
	setBiometricProtection: vi.fn().mockResolvedValue(undefined),
	checkPinCooldown: vi.fn(() => ({ isLocked: false, remainingSeconds: 0 })),
	recordFailedPinAttempt: vi.fn(() => ({ attempts: 1, lockedUntil: null })),
	resetFailedPinAttempts: vi.fn(),
}));

vi.mock('@/lib/webauthn', () => ({
	hasBiometricRegistered: vi.fn(() => false),
	isBiometricAvailable: vi.fn().mockResolvedValue(false),
	verifyBiometric: vi.fn(),
	hasPRFEnabled: vi.fn(() => false),
	isPRFSupported: vi.fn(() => false),
	registerBiometric: vi.fn().mockResolvedValue(false),
}));

import * as storage from '@/lib/storage';
import UnlockGate from '@/components/UnlockScreen';

beforeEach(() => {
	vi.clearAllMocks();
	storeState.isLoading = false;
	storeState.isUnlocked = false;
	storeState.hasPin = false;
});

describe('UnlockGate：强制设锁', () => {
	it('无 PIN 的库冷启动 → 先渲染设置 PIN 屏，不渲染 children', async () => {
		render(
			<UnlockGate>
				<div data-testid="app-content" />
			</UnlockGate>,
		);

		await waitFor(() => expect(screen.getByText('先给应用加把锁')).toBeInTheDocument());

		expect(storage.loadWithoutPin).toHaveBeenCalled();
		expect(storeState.loadAccounts).toHaveBeenCalledWith([]);
		expect(screen.queryByTestId('app-content')).toBeNull();
		// 硬强制：没有跳过按钮
		expect(screen.queryByRole('button', { name: /跳过|skip/i })).toBeNull();
		// 设锁输入面是自绘数字键盘（无输入框 → 不会弹系统键盘/保存密码）
		expect(screen.getByRole('group', { name: '数字键盘' })).toBeInTheDocument();
		expect(screen.getByText('输入 6 位数字')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: '设置并进入' })).toBeNull();
		// 6 位自动提交：不再渲染确认键
		expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
	});

	it('设锁两阶段（自动提交）：输满 6 位即推进；不一致 → 提示 + 回 enter；一致 → 写入 PIN 后进入', async () => {
		render(
			<UnlockGate>
				<div data-testid="app-content" />
			</UnlockGate>,
		);
		await waitFor(() => expect(screen.getByText('先给应用加把锁')).toBeInTheDocument());

		const press = (digits: string) =>
			digits.split('').forEach((d) => fireEvent.click(screen.getByRole('button', { name: d })));

		// 第一阶段：输满 6 位自动进 confirm（无需点确认键）
		press('123456');
		await waitFor(() => expect(screen.getByText('再输入一次确认')).toBeInTheDocument());

		// 首遍输错也有出口：重设 → 回到 enter 并清空
		fireEvent.click(screen.getByRole('button', { name: '重设 PIN' }));
		await waitFor(() => expect(screen.getByText('输入 6 位数字')).toBeInTheDocument());
		expect(screen.getByText('已输入 0 位')).toBeInTheDocument();

		press('123456');
		await waitFor(() => expect(screen.getByText('再输入一次确认')).toBeInTheDocument());

		// 第二阶段：不一致 → 报错 + 回到 enter 并清空两值
		press('654321');
		await waitFor(() => expect(screen.getByText('两次输入不一致')).toBeInTheDocument());
		expect(screen.getByText('输入 6 位数字')).toBeInTheDocument();
		expect(screen.getByText('已输入 0 位')).toBeInTheDocument();
		expect(storage.setPinProtection).not.toHaveBeenCalled();

		// 两遍一致 → 落库并进入应用
		press('123456');
		await waitFor(() => expect(screen.getByText('再输入一次确认')).toBeInTheDocument());
		press('123456');
		await waitFor(() => expect(storage.setPinProtection).toHaveBeenCalledWith('123456'));
		expect(storeState.setHasPin).toHaveBeenCalledWith(true);
		await waitFor(() => expect(screen.getByTestId('app-content')).toBeInTheDocument());
	});
});
