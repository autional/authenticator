import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * 旧库重置闸门（开发期）：PIN 已统一为 6 位，长度不是 6 的存量库不再兼容。
 * 冷启动必须给出一次性重置页 —— 把用户送回键盘等于让他对着永远解不开的库反复试。
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
	hasPinProtection: vi.fn(() => true),
	loadWithoutPin: vi.fn().mockResolvedValue([]),
	unlockWithBiometric: vi.fn().mockResolvedValue([]),
	hasBiometricProtection: vi.fn(() => false),
	getPinLength: vi.fn(() => 8),
	resetLocalVault: vi.fn(),
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

beforeEach(() => {
	vi.clearAllMocks();
	storeState.isLoading = false;
	storeState.isUnlocked = false;
	storeState.hasPin = false;
});

describe('UnlockGate：旧库（非 6 位 PIN）重置', () => {
	it('pinLength ≠ 6 → 渲染重置页，客户端内容与键盘都不出现', async () => {
		renderGate();

		await waitFor(() => expect(screen.getByText('本地保险库需要重置')).toBeInTheDocument());
		expect(screen.getByText(/旧长度的保险库不再兼容/)).toBeInTheDocument();
		expect(screen.queryByTestId('app-content')).toBeNull();
		// 不给键盘：旧 PIN 怎么输都解不开，只会白白消耗尝试次数
		expect(screen.queryByRole('group', { name: '数字键盘' })).toBeNull();
	});

	it('点「清空并重设」→ 清空本机保险库一次', async () => {
		renderGate();
		await waitFor(() => expect(screen.getByText('本地保险库需要重置')).toBeInTheDocument());

		fireEvent.click(screen.getByRole('button', { name: '清空并重设' }));

		expect(storage.resetLocalVault).toHaveBeenCalledTimes(1);
	});
});
