import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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
	hasBiometricProtection: vi.fn(() => true),
	getPinLength: vi.fn(() => 6),
}));

vi.mock('@/lib/webauthn', () => ({
	hasBiometricRegistered: vi.fn(() => true),
	isBiometricAvailable: vi.fn().mockResolvedValue(true),
	verifyBiometric: vi.fn(),
	hasPRFEnabled: vi.fn(() => true),
	isPRFSupported: vi.fn(() => true),
}));

import * as webauthn from '@/lib/webauthn';
import * as storage from '@/lib/storage';
import UnlockScreen from '@/components/UnlockScreen';

const renderUnlock = () =>
	render(
		<UnlockScreen>
			<div data-testid="app-content" />
		</UnlockScreen>,
	);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('锁屏：生物识别优先', () => {
	it('能力可用时自动尝试一次生物识别并解锁成功', async () => {
		const prfKey = new Uint8Array(32).fill(7);
		vi.mocked(webauthn.verifyBiometric).mockResolvedValue(prfKey);

		renderUnlock();

		await waitFor(() => expect(webauthn.verifyBiometric).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(storage.unlockWithBiometric).toHaveBeenCalledWith(prfKey));
		expect(storeState.loadAccounts).toHaveBeenCalled();
		expect(storeState.setHasPin).toHaveBeenCalledWith(true);
	});

	it('生物识别失败 → 落回 PIN 视图，且不重复弹窗', async () => {
		vi.mocked(webauthn.verifyBiometric).mockResolvedValue(null);

		renderUnlock();

		await waitFor(() => expect(webauthn.verifyBiometric).toHaveBeenCalledTimes(1));
		expect(await screen.findByText('生物识别不可用，请改用 PIN 解锁')).toBeInTheDocument();
		expect(screen.getByLabelText('PIN 码')).toBeInTheDocument();
		expect(storage.unlockWithBiometric).not.toHaveBeenCalled();
		// 只尝试一次（不循环）
		expect(webauthn.verifyBiometric).toHaveBeenCalledTimes(1);
	});
});
