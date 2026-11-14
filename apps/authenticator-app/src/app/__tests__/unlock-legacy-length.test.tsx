import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * 存量库（非 6 位 PIN）必须能解锁：键盘按库里记录的长度放开，冷启动不再出现「重置页」。
 * 只有真的忘记 PIN 才走手动逃生口：「忘记 PIN？」→ 弹层 → 二次确认 → 清空本机保险库。
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

const getPinLengthMock = vi.hoisted(() => vi.fn<() => number | null>(() => 8));

vi.mock('@/lib/storage', () => ({
	unlockWithPin: vi.fn().mockResolvedValue([]),
	hasPinProtection: vi.fn(() => true),
	loadWithoutPin: vi.fn().mockResolvedValue([]),
	unlockWithBiometric: vi.fn().mockResolvedValue([]),
	hasBiometricProtection: vi.fn(() => false),
	getPinLength: () => getPinLengthMock(),
	resetLocalVault: vi.fn(),
	checkPinCooldown: vi.fn(() => ({ isLocked: false, remainingSeconds: 0 })),
	recordFailedPinAttempt: vi.fn(() => ({ attempts: 1, lockedUntil: null })),
	resetFailedPinAttempts: vi.fn(),
	setPinProtection: vi.fn().mockResolvedValue(undefined),
	setBiometricProtection: vi.fn().mockResolvedValue(undefined),
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
	getPinLengthMock.mockReturnValue(8);
	storeState.isLoading = false;
	storeState.isUnlocked = false;
	storeState.hasPin = true;
});

describe('UnlockGate：存量库长度兼容', () => {
	it('pinLength = 8 → 键盘可用 8 位解锁，不出现重置页', async () => {
		renderGate();

		await waitFor(() => expect(screen.getByRole('group', { name: '数字键盘' })).toBeInTheDocument());
		// 没有任何重置/清空入口抢占锁屏
		expect(screen.queryByRole('button', { name: '清空并重设' })).toBeNull();
		expect(screen.queryByText(/本地保险库需要重置/)).toBeNull();

		// 8 位才自动提交（不是 6 位）
		press('1234567');
		expect(screen.getByText('已输入 7 位')).toBeInTheDocument();
		expect(storage.unlockWithPin).not.toHaveBeenCalled();

		press('8');
		await waitFor(() => expect(storage.unlockWithPin).toHaveBeenCalledWith('12345678'));
	});

	it('pinLength = null（旧库未记录长度）→ 出现确认键，可在 4-8 位区间手动提交', async () => {
		getPinLengthMock.mockReturnValue(null);
		renderGate();

		await waitFor(() => expect(screen.getByRole('group', { name: '数字键盘' })).toBeInTheDocument());
		expect(screen.queryByText(/本地保险库需要重置/)).toBeNull();

		// 长度未知 → 不自动提交，必须给确认键
		const confirm = screen.getByRole('button', { name: '确认' });
		expect(confirm).toBeInTheDocument();

		press('1234');
		expect(storage.unlockWithPin).not.toHaveBeenCalled();

		fireEvent.click(confirm);
		await waitFor(() => expect(storage.unlockWithPin).toHaveBeenCalledWith('1234'));
	});

	it('「忘记 PIN？」→ 弹层 → 第一次点击只进入待确认，第二次才清空', async () => {
		renderGate();

		await waitFor(() => expect(screen.getByRole('group', { name: '数字键盘' })).toBeInTheDocument());
		expect(screen.queryByRole('dialog')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: '忘记 PIN？' }));

		const dialog = screen.getByRole('dialog');
		expect(dialog).toHaveAttribute('aria-modal', 'true');
		expect(screen.getByText('本地保险库需要重置')).toBeInTheDocument();

		// 第一次点击：只把按钮换成「再点一次确认」，不动数据
		fireEvent.click(screen.getByRole('button', { name: '清空并重设' }));
		expect(storage.resetLocalVault).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: '再点一次确认' })).toBeInTheDocument();

		// 第二次点击：真正执行
		fireEvent.click(screen.getByRole('button', { name: '再点一次确认' }));
		expect(storage.resetLocalVault).toHaveBeenCalledTimes(1);
	});

	it('弹层「取消」→ 关闭且不清空', async () => {
		renderGate();

		await waitFor(() => expect(screen.getByRole('group', { name: '数字键盘' })).toBeInTheDocument());
		fireEvent.click(screen.getByRole('button', { name: '忘记 PIN？' }));
		fireEvent.click(screen.getByRole('button', { name: '清空并重设' }));

		fireEvent.click(screen.getByRole('button', { name: '取消' }));

		expect(screen.queryByRole('dialog')).toBeNull();
		expect(storage.resetLocalVault).not.toHaveBeenCalled();
	});
});
