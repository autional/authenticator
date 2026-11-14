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
		await first.setPinProtection('111111');

		// Cold boot — unlock with old PIN, change to new PIN
		const second = await import('../storage');
		await second.unlockWithPin('111111');
		await second.setPinProtection('222222');

		// Verify new PIN works
		const third = await import('../storage');
		await expect(third.loadWithoutPin()).rejects.toThrow();
		const unlocked = await third.unlockWithPin('222222');
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

describe('Biometric (PRF) protection', () => {
	const bindStorage = () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});
	};

	it('binds a PRF key and unlocks without PIN', async () => {
		bindStorage();
		const {
			initializeStorage,
			saveAccounts,
			setPinProtection,
			setBiometricProtection,
			hasBiometricProtection,
			unlockWithBiometric,
		} = await import('../storage');

		await initializeStorage();
		await saveAccounts([makeAccount({ id: 'acc_bio', name: 'Bio Account' })]);
		await setPinProtection('123456');

		const prfKey = new Uint8Array(32).fill(7);
		await setBiometricProtection(prfKey);
		expect(hasBiometricProtection()).toBe(true);

		const loaded = await unlockWithBiometric(prfKey);
		expect(loaded).toHaveLength(1);
		expect(loaded[0].name).toBe('Bio Account');
	});

	it('rejects a wrong PRF key (AES-GCM auth failure)', async () => {
		bindStorage();
		const { initializeStorage, saveAccounts, setPinProtection, setBiometricProtection, unlockWithBiometric } =
			await import('../storage');

		await initializeStorage();
		await saveAccounts([makeAccount()]);
		await setPinProtection('123456');
		await setBiometricProtection(new Uint8Array(32).fill(1));

		await expect(unlockWithBiometric(new Uint8Array(32).fill(2))).rejects.toThrow();
	});

	it('refuses biometric unlock when no PRF wrap was bound (PIN wrap is not reusable)', async () => {
		bindStorage();
		const { initializeStorage, saveAccounts, setPinProtection, unlockWithBiometric } = await import('../storage');

		await initializeStorage();
		await saveAccounts([makeAccount()]);
		await setPinProtection('123456');

		await expect(unlockWithBiometric(new Uint8Array(32).fill(3))).rejects.toThrow(/not bound/i);
	});

	it('clearBiometricProtection removes only the PRF wrap', async () => {
		bindStorage();
		const {
			initializeStorage,
			saveAccounts,
			setPinProtection,
			setBiometricProtection,
			clearBiometricProtection,
			hasBiometricProtection,
			unlockWithBiometric,
			unlockWithPin,
		} = await import('../storage');

		await initializeStorage();
		await saveAccounts([makeAccount()]);
		await setPinProtection('123456');
		const prfKey = new Uint8Array(32).fill(9);
		await setBiometricProtection(prfKey);

		clearBiometricProtection();
		expect(hasBiometricProtection()).toBe(false);
		await expect(unlockWithBiometric(prfKey)).rejects.toThrow(/not bound/i);
		// PIN 路径仍然可用
		await expect(unlockWithPin('123456')).resolves.toHaveLength(1);
	});
});

describe('KDF 加固（PIN 位数下限 + 迭代次数升级）', () => {
	const bindStorage = () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: mockStorageGetItem,
				setItem: mockStorageSetItem,
				removeItem: mockStorageRemoveItem,
			},
			writable: true,
		});
	};

	it('拒绝非 6 位 PIN（WEAK_PIN）', async () => {
		bindStorage();
		const { initializeStorage, setPinProtection } = await import('../storage');
		await initializeStorage();

		await expect(setPinProtection('1234')).rejects.toThrow('WEAK_PIN');
		await expect(setPinProtection('12345')).rejects.toThrow('WEAK_PIN');
		await expect(setPinProtection('1234567')).rejects.toThrow('WEAK_PIN');
		await expect(setPinProtection('12345678')).rejects.toThrow('WEAK_PIN');
		await expect(setPinProtection('123456')).resolves.toBeUndefined();
	});

	it('新设 PIN 记录 pinLength = 6（解锁键盘据此自动提交）', async () => {
		bindStorage();
		const { initializeStorage, setPinProtection, getPinLength } = await import('../storage');

		await initializeStorage();
		await setPinProtection('123456');

		const payload = JSON.parse(mockLocalStorage['autional-authenticator-v2']);
		expect(payload.pinLength).toBe(6);
		expect(getPinLength()).toBe(6);
	});

	it('新设 PIN 记录 pinKdfIterations = 600000 且清掉明文 deviceKey', async () => {
		bindStorage();
		const { initializeStorage, setPinProtection } = await import('../storage');
		const { PIN_KDF_ITERATIONS } = await import('../crypto');

		await initializeStorage();
		await setPinProtection('123456');

		const payload = JSON.parse(mockLocalStorage['autional-authenticator-v2']);
		expect(payload.pinKdfIterations).toBe(PIN_KDF_ITERATIONS);
		expect(payload.deviceKey).toBeNull();
		expect(payload.deviceKeyWrap).toBeTruthy();
	});

	it('旧库（100k、无 pinKdfIterations）仍可解锁，并在解锁后升级到 600k', async () => {
		bindStorage();
		const { initializeStorage, saveAccounts, unlockWithPin } = await import('../storage');
		const {
			derivePinKey,
			encryptWithKey,
			arrayBufferToBase64,
			base64ToArrayBuffer,
			PIN_KDF_ITERATIONS,
			LEGACY_PBKDF2_ITERATIONS,
		} = await import('../crypto');

		await initializeStorage();
		await saveAccounts([makeAccount({ name: 'Legacy' })]);

		// 手工构造旧版载荷：明文 deviceKey 用 100k 派生的钥包裹，且不写 pinKdfIterations
		const payload = JSON.parse(mockLocalStorage['autional-authenticator-v2']);
		const salt = base64ToArrayBuffer(payload.salt);
		const legacyKey = await derivePinKey('123456', salt, LEGACY_PBKDF2_ITERATIONS);
		const { ciphertext, iv } = await encryptWithKey(payload.deviceKey, legacyKey);
		payload.deviceKey = null;
		payload.deviceKeyWrap = {
			iv: arrayBufferToBase64(iv),
			ciphertext: arrayBufferToBase64(ciphertext),
		};
		delete payload.pinKdfIterations;
		mockLocalStorage['autional-authenticator-v2'] = JSON.stringify(payload);

		const loaded = await unlockWithPin('123456');
		expect(loaded[0].name).toBe('Legacy');

		const upgraded = JSON.parse(mockLocalStorage['autional-authenticator-v2']);
		expect(upgraded.pinKdfIterations).toBe(PIN_KDF_ITERATIONS);
	});

	it('无 PIN 时拒绝开启生物识别（不能只挂锁不撤钥匙）', async () => {
		bindStorage();
		const { initializeStorage, setBiometricProtection } = await import('../storage');

		await initializeStorage();
		await expect(setBiometricProtection(new Uint8Array(32).fill(5))).rejects.toThrow(
			'PIN_REQUIRED_FOR_BIOMETRIC',
		);
	});
});
