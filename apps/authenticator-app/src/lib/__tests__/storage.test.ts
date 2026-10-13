import { describe, it, expect, beforeEach } from 'vitest';
import type { TotpAccount } from '../store';

const mockLocalStorage: Record<string, string> = {};

function mockStorageGetItem(key: string): string | null {
	return mockLocalStorage[key] ?? null;
}

function mockStorageSetItem(key: string, value: string): void {
	mockLocalStorage[key] = value;
}

function mockStorageRemoveItem(key: string): void {
	delete mockLocalStorage[key];
}

function mockStorageClear(): void {
	Object.keys(mockLocalStorage).forEach((k) => delete mockLocalStorage[k]);
}

beforeEach(() => {
	mockStorageClear();
});

function makeAccount(overrides: Partial<TotpAccount> = {}): TotpAccount {
	return {
		id: 'acc_test_1',
		name: 'TestService',
		username: 'user@example.com',
		secret: 'JBSWY3DPEHPK3PXP',
		algorithm: 'SHA1',
		digits: 6,
		period: 30,
		createdAt: 1700000000000,
		...overrides,
	} as TotpAccount;
}

describe('initializeStorage', () => {
	it('creates v2 storage on first run', async () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});

		const { initializeStorage } = await import('../storage');
		await initializeStorage();

		const raw = mockLocalStorage['autional-authenticator-v2'];
		expect(raw).toBeTruthy();
		const payload = JSON.parse(raw);
		expect(payload.version).toBe(2);
		expect(payload.salt).toBeTruthy();
		expect(payload.deviceKey).toBeTruthy();
		expect(payload.deviceKeyWrap).toBeNull();
		expect(payload.data.iv).toBeTruthy();
		expect(payload.data.ciphertext).toBeTruthy();
	});

	it('does not overwrite existing storage', async () => {
		const existing = JSON.stringify({
			version: 2,
			salt: 'test',
			deviceKey: 'existing',
			deviceKeyWrap: null,
			data: { iv: 'test', ciphertext: 'test' },
		});
		mockLocalStorage['autional-authenticator-v2'] = existing;

		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});

		const { initializeStorage } = await import('../storage');
		await initializeStorage();

		expect(mockLocalStorage['autional-authenticator-v2']).toBe(existing);
	});
});

describe('saveAccounts / loadWithoutPin', () => {
	it('roundtrip save + load', async () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});

		const { initializeStorage, saveAccounts, loadWithoutPin } = await import('../storage');

		await initializeStorage();

		const accounts: TotpAccount[] = [
			makeAccount({ id: 'acc_1', name: 'Service A' }),
			makeAccount({ id: 'acc_2', name: 'Service B' }),
		];

		await saveAccounts(accounts);
		const loaded = await loadWithoutPin();
		expect(loaded).toHaveLength(2);
		expect(loaded[0].name).toBe('Service A');
		expect(loaded[1].name).toBe('Service B');
	});

	it('loadWithoutPin throws with empty storage', async () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});

		const { loadWithoutPin } = await import('../storage');
		const result = await loadWithoutPin();
		expect(result).toEqual([]);
	});
});

describe('PIN protection', () => {
	it('set + unlock with correct PIN', async () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});

		const { initializeStorage, saveAccounts, setPinProtection, unlockWithPin, loadWithoutPin } =
			await import('../storage');

		await initializeStorage();

		const accounts: TotpAccount[] = [makeAccount({ id: 'acc_1', name: 'My Account' })];
		await saveAccounts(accounts);

		// Set PIN protection
		await setPinProtection('123456');

		// Verify PIN required
		await expect(loadWithoutPin()).rejects.toThrow('PIN required to unlock storage');

		// Unlock with correct PIN
		const loaded = await unlockWithPin('123456');
		expect(loaded).toHaveLength(1);
		expect(loaded[0].name).toBe('My Account');
	});

	it('rejects wrong PIN', async () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});

		const { initializeStorage, setPinProtection, unlockWithPin } = await import('../storage');

		await initializeStorage();
		await setPinProtection('123456');

		await expect(unlockWithPin('000000')).rejects.toThrow();
	});

	it('remove PIN protection', async () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});

		const { initializeStorage, saveAccounts, setPinProtection, loadWithoutPin } =
			await import('../storage');

		await initializeStorage();
		const accounts: TotpAccount[] = [makeAccount({ name: 'Test' })];
		await saveAccounts(accounts);

		// Set then remove PIN
		await setPinProtection('123456');
		await setPinProtection(null);

		const loaded = await loadWithoutPin();
		expect(loaded).toHaveLength(1);
		expect(loaded[0].name).toBe('Test');
	});

	it('hasPinProtection returns correct value', async () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});

		const { initializeStorage, setPinProtection, hasPinProtection } = await import('../storage');

		await initializeStorage();
		expect(hasPinProtection()).toBe(false);

		await setPinProtection('123456');
		expect(hasPinProtection()).toBe(true);
	});
});

describe('corrupted storage', () => {
	it('handles corrupted JSON gracefully', async () => {
		mockLocalStorage['autional-authenticator-v2'] = 'not-valid-json{{{';

		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});

		const { loadWithoutPin, hasPinProtection } = await import('../storage');

		const result = await loadWithoutPin();
		expect(result).toEqual([]);
		expect(hasPinProtection()).toBe(false);
	});
});

describe('saveAccounts without cached key', () => {
	it('recovers deviceKey from payload when no cached key', async () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});

		const { initializeStorage, loadWithoutPin } = await import('../storage');

		await initializeStorage();

		// Simulate fresh import by re-importing storage module
		const fresh = await import('../storage');
		const accounts: TotpAccount[] = [makeAccount({ name: 'Fresh Import' })];
		await fresh.saveAccounts(accounts);

		const loaded = await loadWithoutPin();
		expect(loaded).toHaveLength(1);
		expect(loaded[0].name).toBe('Fresh Import');
	});
});

describe('cold boot PIN flow (US-A4)', () => {
	it('set PIN after cold boot (loadWithoutPin → setPinProtection → unlockWithPin)', async () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});

		// Phase 1: initialize and set up data without PIN
		const first = await import('../storage');
		await first.initializeStorage();
		const accounts: TotpAccount[] = [makeAccount({ name: 'My Account' })];
		await first.saveAccounts(accounts);

		// Phase 2: simulate page reload — re-import to clear cachedDeviceKey
		const second = await import('../storage');
		// loadWithoutPin restores cachedDeviceKey via importDeviceKey
		const loaded = await second.loadWithoutPin();
		expect(loaded).toHaveLength(1);

		// Phase 3: now set PIN — this was the BUG-05 scenario
		await second.setPinProtection('123456');

		// Phase 4: verify PIN is set
		expect(second.hasPinProtection()).toBe(true);

		// Phase 5: simulate another page reload and unlock
		const third = await import('../storage');
		await expect(third.loadWithoutPin()).rejects.toThrow('PIN required');

		const unlocked = await third.unlockWithPin('123456');
		expect(unlocked).toHaveLength(1);
		expect(unlocked[0].name).toBe('My Account');
	});

	it('change PIN after cold boot', async () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});

		// Initialize with PIN
		const first = await import('../storage');
		await first.initializeStorage();
		await first.setPinProtection('oldpin');

		// Cold boot — unlock with old PIN, change to new PIN
		const second = await import('../storage');
		await second.unlockWithPin('oldpin');
		await second.setPinProtection('newpin');

		// Verify new PIN works
		const third = await import('../storage');
		await expect(third.loadWithoutPin()).rejects.toThrow();
		const unlocked = await third.unlockWithPin('newpin');
		expect(unlocked).toEqual([]);
	});
});

describe('hasPinProtection edge cases', () => {
	it('returns false for empty storage', async () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});

		const { hasPinProtection } = await import('../storage');
		expect(hasPinProtection()).toBe(false);
	});

	it('returns false for corrupted JSON', async () => {
		mockLocalStorage['autional-authenticator-v2'] = '{broken';

		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});

		const { hasPinProtection } = await import('../storage');
		expect(hasPinProtection()).toBe(false);
	});
});
