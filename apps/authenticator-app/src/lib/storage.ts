/**
 * Encrypted localStorage for Autional Authenticator
 *
 * Storage layout (v2):
 * {
 *   version: 2,
 *   salt: string,           // base64, used for PBKDF2
 *   deviceKey: string|null, // base64 raw deviceKey bytes. null when PIN-protected.
 *   deviceKeyWrap: {        // present only when PIN-protected
 *     iv: string,
 *     ciphertext: string
 *   } | null,
 *   data: {
 *     iv: string,
 *     ciphertext: string    // accounts JSON encrypted by deviceKey
 *   }
 * }
 */

import {
	generateDeviceKey,
	exportDeviceKey,
	importDeviceKey,
	derivePinKey,
	deriveKeyFromBytes,
	encryptWithKey,
	decryptWithKey,
	arrayBufferToBase64,
	base64ToArrayBuffer,
} from './crypto';
import type { TotpAccount } from './store';

const STORAGE_KEY = 'autional-authenticator-v2';
const PIN_ATTEMPTS_KEY = 'autional-authenticator-pin-attempts';
const MAX_PIN_ATTEMPTS = 5;
const PIN_COOLDOWN_MS = 30_000;

interface DeviceKeyWrap {
	iv: string;
	ciphertext: string;
}

interface StoragePayload {
	version: 2;
	salt: string;
	deviceKey: string | null;
	deviceKeyWrap: DeviceKeyWrap | null;
	/** 生物识别解锁：deviceKey 用 PRF 派生密钥再包一层（与 PIN 包裹并存，互不影响） */
	deviceKeyWrapBio?: DeviceKeyWrap | null;
	data: {
		iv: string;
		ciphertext: string;
	};
}

export function getDeviceKey(): CryptoKey | null {
	return cachedDeviceKey;
}

export async function getOrCreateDeviceKey(): Promise<CryptoKey> {
	if (cachedDeviceKey) return cachedDeviceKey;
	const payload = readPayload();
	if (!payload) throw new Error('NOT_INITIALIZED');
	if (!payload.deviceKey && payload.deviceKeyWrap) {
		throw new Error('PIN_REQUIRED');
	}
	if (!payload.deviceKey) throw new Error('CORRUPTED');
	cachedDeviceKey = await importDeviceKey(base64ToArrayBuffer(payload.deviceKey));
	return cachedDeviceKey;
}

export async function ensureDeviceKey(): Promise<CryptoKey> {
	return getOrCreateDeviceKey();
}

// Module-level cache for device encryption key.
// This is intentionally module-scoped rather than class-based
// because the key is a singleton used across the app lifecycle.
// Refactor to StorageManager class in next major iteration (FE-049).
let cachedDeviceKey: CryptoKey | null = null;

/** 清内存中的设备密钥（锁屏/登出/页面卸载）。不删除 localStorage 中的密文。 */
export function clearDeviceKeyCache(): void {
	cachedDeviceKey = null;
}

function readPayload(): StoragePayload | null {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as StoragePayload;
	} catch {
		return null;
	}
}

function writePayload(payload: StoragePayload): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

async function decryptAccounts(
	data: StoragePayload['data'],
	deviceKey: CryptoKey,
): Promise<TotpAccount[]> {
	const iv = base64ToArrayBuffer(data.iv);
	const cipher = base64ToArrayBuffer(data.ciphertext);
	const json = await decryptWithKey(cipher, iv, deviceKey);
	return JSON.parse(json) as TotpAccount[];
}

async function encryptAccounts(
	accounts: TotpAccount[],
	deviceKey: CryptoKey,
): Promise<StoragePayload['data']> {
	const json = JSON.stringify(accounts);
	const { ciphertext, iv } = await encryptWithKey(json, deviceKey);
	return {
		iv: arrayBufferToBase64(iv),
		ciphertext: arrayBufferToBase64(ciphertext),
	};
}

/**
 * Initialize storage on first run.
 */
export async function initializeStorage(): Promise<void> {
	if (readPayload()) return;

	const deviceKey = await generateDeviceKey();
	cachedDeviceKey = deviceKey;
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const exported = await exportDeviceKey(deviceKey);
	const data = await encryptAccounts([], deviceKey);

	const payload: StoragePayload = {
		version: 2,
		salt: arrayBufferToBase64(salt),
		deviceKey: arrayBufferToBase64(exported),
		deviceKeyWrap: null,
		data,
	};
	writePayload(payload);
}

/**
 * Returns true if storage is protected by PIN.
 */
export function hasPinProtection(): boolean {
	const p = readPayload();
	if (!p) return false;
	return p.deviceKeyWrap != null;
}

/**
 * Load accounts without PIN (deviceKey is stored plaintext in payload).
 */
export async function loadWithoutPin(): Promise<TotpAccount[]> {
	const payload = readPayload();
	if (!payload) return [];
	if (payload.deviceKeyWrap) {
		throw new Error('PIN required to unlock storage');
	}
	if (!payload.deviceKey) {
		throw new Error('Corrupted storage: missing deviceKey');
	}

	const deviceKey = await importDeviceKey(base64ToArrayBuffer(payload.deviceKey));
	cachedDeviceKey = deviceKey;
	return decryptAccounts(payload.data, deviceKey);
}

/**
 * Unlock storage with PIN.
 */
export async function unlockWithPin(pin: string): Promise<TotpAccount[]> {
	const payload = readPayload();
	if (!payload) return [];
	if (!payload.deviceKeyWrap) {
		throw new Error('Storage is not PIN-protected');
	}

	const salt = base64ToArrayBuffer(payload.salt);
	const pinKey = await derivePinKey(pin, salt);

	const wrapIv = base64ToArrayBuffer(payload.deviceKeyWrap.iv);
	const wrapCipher = base64ToArrayBuffer(payload.deviceKeyWrap.ciphertext);

	// Decrypt deviceKey raw bytes (base64 string) using pinKey
	const deviceKeyRawB64 = await decryptWithKey(wrapCipher, wrapIv, pinKey);
	const deviceKey = await importDeviceKey(base64ToArrayBuffer(deviceKeyRawB64));
	cachedDeviceKey = deviceKey;

	return decryptAccounts(payload.data, deviceKey);
}

/**
 * Unlock storage with biometric-derived PRF key (WebAuthn hmacGetSecret).
 * The prfKey is the 32-byte output from verifyBiometric().
 */
export async function unlockWithBiometric(prfKey: Uint8Array): Promise<TotpAccount[]> {
	if (!prfKey || prfKey.length === 0) {
		throw new Error('Invalid PRF key');
	}

	const payload = readPayload();
	if (!payload) return [];

	// 生物识别包裹是独立的一层：只有「开启生物识别时用 PRF 密钥包裹过 deviceKey」才能解。
	// 不能用 deviceKeyWrap（那是 PIN 包裹，密钥材质与迭代次数都不同）——早期实现就是这里解错了，
	// 导致只要设了 PIN，生物识别解锁必然 AES-GCM 认证失败。
	const wrap = payload.deviceKeyWrapBio;
	if (!wrap) {
		throw new Error('Biometric is not bound to this vault. Re-enable biometric unlock in Settings.');
	}

	const salt = base64ToArrayBuffer(payload.salt);
	const bioKey = await deriveKeyFromBytes(prfKey, salt);

	const wrapIv = base64ToArrayBuffer(wrap.iv);
	const wrapCipher = base64ToArrayBuffer(wrap.ciphertext);

	const deviceKeyRawB64 = await decryptWithKey(wrapCipher, wrapIv, bioKey);
	const deviceKey = await importDeviceKey(base64ToArrayBuffer(deviceKeyRawB64));
	cachedDeviceKey = deviceKey;

	return decryptAccounts(payload.data, deviceKey);
}

/** 是否已把 deviceKey 用 PRF 密钥包裹（决定锁屏是否展示生物识别按钮）。 */
export function hasBiometricProtection(): boolean {
	const payload = readPayload();
	return !!payload?.deviceKeyWrapBio;
}

/**
 * 开启生物识别：用 PRF 派生密钥把当前 deviceKey **再包一层**（不改动 PIN 包裹）。
 * 前置：当前进程已持有可导出的 deviceKey（即保险库已解锁）。
 */
export async function setBiometricProtection(prfKey: Uint8Array): Promise<void> {
	if (!prfKey || prfKey.length === 0) throw new Error('Invalid PRF key');
	const payload = readPayload();
	if (!payload) throw new Error('NOT_INITIALIZED');

	let deviceKey = cachedDeviceKey;
	if (!deviceKey) {
		if (payload.deviceKey) {
			deviceKey = await importDeviceKey(base64ToArrayBuffer(payload.deviceKey));
		} else {
			deviceKey = null;
		}
		if (!deviceKey) throw new Error('UNLOCK_REQUIRED');
		cachedDeviceKey = deviceKey;
	}
	if (!deviceKey.extractable) throw new Error('Device key is not extractable');

	const exportedB64 = arrayBufferToBase64(await exportDeviceKey(deviceKey));
	const salt = base64ToArrayBuffer(payload.salt);
	const bioKey = await deriveKeyFromBytes(prfKey, salt);
	const { ciphertext, iv } = await encryptWithKey(exportedB64, bioKey);

	payload.deviceKeyWrapBio = {
		iv: arrayBufferToBase64(iv),
		ciphertext: arrayBufferToBase64(ciphertext),
	};
	writePayload(payload);
}

/** 关闭生物识别：只移除 PRF 包裹，PIN 包裹保持不变。 */
export function clearBiometricProtection(): void {
	const payload = readPayload();
	if (!payload || !payload.deviceKeyWrapBio) return;
	payload.deviceKeyWrapBio = null;
	writePayload(payload);
}

/**
 * Persist accounts to encrypted storage.
 */
export async function saveAccounts(accounts: TotpAccount[]): Promise<void> {
	const payload = readPayload();
	if (!payload) throw new Error('Storage not initialized');

	let deviceKey = cachedDeviceKey;
	if (!deviceKey) {
		// Try to recover deviceKey from payload (no PIN case)
		if (payload.deviceKey) {
			deviceKey = await importDeviceKey(base64ToArrayBuffer(payload.deviceKey));
			cachedDeviceKey = deviceKey;
		} else {
			throw new Error('DeviceKey not available. Storage may require PIN unlock.');
		}
	}

	payload.data = await encryptAccounts(accounts, deviceKey);
	writePayload(payload);
}

/**
 * Set or change PIN protection.
 * If pin is null/empty, removes PIN protection.
 * If pin is provided, wraps deviceKey with PIN-derived key.
 */
export async function setPinProtection(pin: string | null): Promise<void> {
	const payload = readPayload();
	if (!payload) throw new Error('Storage not initialized');

	let deviceKey = cachedDeviceKey;
	if (!deviceKey) {
		if (payload.deviceKey) {
			deviceKey = await importDeviceKey(base64ToArrayBuffer(payload.deviceKey));
		} else if (payload.deviceKeyWrap) {
			throw new Error('Cannot change PIN while locked. Unlock first.');
		} else {
			throw new Error('Corrupted storage');
		}
		cachedDeviceKey = deviceKey;
	}

	if (!deviceKey.extractable) {
		throw new Error('Device key is not extractable — cannot wrap with PIN');
	}

	const exported = await exportDeviceKey(deviceKey);
	const exportedB64 = arrayBufferToBase64(exported);

	if (!pin || pin.length === 0) {
		// Remove PIN protection
		payload.deviceKey = exportedB64;
		payload.deviceKeyWrap = null;
	} else {
		// Add PIN protection
		const salt = base64ToArrayBuffer(payload.salt);
		const pinKey = await derivePinKey(pin, salt);
		const { ciphertext, iv } = await encryptWithKey(exportedB64, pinKey);
		payload.deviceKey = null;
		payload.deviceKeyWrap = {
			iv: arrayBufferToBase64(iv),
			ciphertext: arrayBufferToBase64(ciphertext),
		};
	}

	writePayload(payload);
}

interface PinAttemptState {
	attempts: number;
	lockedUntil: number | null;
}

function readPinAttempts(): PinAttemptState {
	const raw = localStorage.getItem(PIN_ATTEMPTS_KEY);
	if (!raw) return { attempts: 0, lockedUntil: null };
	try {
		return JSON.parse(raw) as PinAttemptState;
	} catch {
		return { attempts: 0, lockedUntil: null };
	}
}

function writePinAttempts(state: PinAttemptState): void {
	localStorage.setItem(PIN_ATTEMPTS_KEY, JSON.stringify(state));
}

export function recordFailedPinAttempt(): { attempts: number; lockedUntil: number | null } {
	const now = Date.now();
	const state = readPinAttempts();

	if (state.lockedUntil !== null && state.lockedUntil > now) {
		return { attempts: state.attempts, lockedUntil: state.lockedUntil };
	}

	const attempts = state.lockedUntil !== null ? 1 : state.attempts + 1;
	const lockedUntil = attempts >= MAX_PIN_ATTEMPTS ? now + PIN_COOLDOWN_MS : null;
	const next: PinAttemptState = { attempts, lockedUntil };
	writePinAttempts(next);
	return { attempts: next.attempts, lockedUntil: next.lockedUntil };
}

export function resetFailedPinAttempts(): void {
	localStorage.removeItem(PIN_ATTEMPTS_KEY);
}

export function checkPinCooldown(): { isLocked: boolean; remainingSeconds: number } {
	const state = readPinAttempts();
	if (state.lockedUntil === null) return { isLocked: false, remainingSeconds: 0 };

	const now = Date.now();
	if (state.lockedUntil <= now) return { isLocked: false, remainingSeconds: 0 };

	return {
		isLocked: true,
		remainingSeconds: Math.ceil((state.lockedUntil - now) / 1000),
	};
}
