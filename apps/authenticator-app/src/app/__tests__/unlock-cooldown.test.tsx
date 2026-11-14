import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * 锁屏节流：解锁路径与「设置页改 PIN」共用同一份失败计数（5 次 / 30 秒）。
 * 冷却期内键盘不可用并显示倒计时；生物识别不受影响（指纹/面容不是 PIN 猜测）。
 */

const storeState = vi.hoisted(() => ({
	isLoading: false,
	isUnlocked: false,
	hasPin: true,
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
	hasPinProtection: vi.fn(() => true),
	loadWithoutPin: vi.fn().mockResolvedValue([]),
	unlockWithBiometric: vi.fn().mockResolvedValue([]),
	hasBiometricProtection: vi.fn(() => false),
	setPinProtection: vi.fn().mockResolvedValue(undefined),
	setBiometricProtection: vi.fn().mockResolvedValue(undefined),
	getPinLength: vi.fn(() => 6),
	resetLocalVault: vi.fn(),
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
	clearBiometric: vi.fn(),
}));

import * as storage from '@/lib/storage';
import UnlockGate from '@/components/UnlockScreen';

const renderGate = () =>
	render(
		<UnlockGate>
			<div data-testid="app-content" />
		</UnlockGate>,
	);

const press = (digits: string) =>
	digits.split('').forEach((d) => fireEvent.click(screen.getByRole('button', { name: d })));

beforeEach(() => {
	vi.clearAllMocks();
	// mockClear 不会回滚 mockReturnValue，逐个用例显式复位（否则上一例的「冷却中」会漏到下一例）
	vi.mocked(storage.checkPinCooldown).mockReturnValue({ isLocked: false, remainingSeconds: 0 });
	vi.mocked(storage.recordFailedPinAttempt).mockReturnValue({ attempts: 1, lockedUntil: null });
	storeState.isLoading = false;
	storeState.isUnlocked = false;
	storeState.hasPin = true;
});

describe('锁屏：PIN 失败节流', () => {
	it('冷却中 → 键盘禁用 + 显示剩余秒数提示', async () => {
		vi.mocked(storage.checkPinCooldown).mockReturnValue({ isLocked: true, remainingSeconds: 25 });

		renderGate();

		await waitFor(() => expect(screen.getByRole('group', { name: '数字键盘' })).toBeInTheDocument());
		expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
		expect(screen.getByText(/25 秒后再试/)).toBeInTheDocument();
		// 冷却中不提交：敲不动键盘
		press('123456');
		expect(storage.unlockWithPin).not.toHaveBeenCalled();
	});

	it('解锁失败一次 → 记一次失败并显示 PIN 错误', async () => {
		vi.mocked(storage.unlockWithPin).mockRejectedValueOnce(new Error('bad pin'));

		renderGate();

		await waitFor(() => expect(screen.getByRole('group', { name: '数字键盘' })).toBeInTheDocument());
		press('123456');

		await waitFor(() => expect(storage.recordFailedPinAttempt).toHaveBeenCalledTimes(1));
		expect(await screen.findByText('PIN 错误，请重试')).toBeInTheDocument();
	});

	it('解锁成功 → 清空失败计数', async () => {
		renderGate();

		await waitFor(() => expect(screen.getByRole('group', { name: '数字键盘' })).toBeInTheDocument());
		press('123456');

		await waitFor(() => expect(storage.unlockWithPin).toHaveBeenCalledWith('123456'));
		expect(storage.resetFailedPinAttempts).toHaveBeenCalledTimes(1);
		expect(storeState.loadAccounts).toHaveBeenCalled();
	});
});
