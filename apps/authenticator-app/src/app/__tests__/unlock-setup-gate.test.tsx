import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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
		expect(screen.getByRole('button', { name: '设置并进入' })).toBeInTheDocument();
	});
});
