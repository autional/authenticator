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
	PIN_KDF_ITERATIONS,
	LEGACY_PBKDF2_ITERATIONS,
	PIN_PATTERN,
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
	/** PIN 包裹用的 PBKDF2 迭代次数；缺省 = 旧版 100k（存量库） */
	pinKdfIterations?: number;
	/** PIN 位数。新建/修改恒为 6 位；存量库可能是 4-8 位，解锁成功后按输入值补写（静默迁移）。 */
	pinLength?: number;
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
 * 用 PIN 派生钥包裹 deviceKey 原始字节，并记录本次使用的迭代次数。
 * PIN 包裹一旦存在，明文 deviceKey 必须置 null（锁与钥匙不得同处）。
 */
async function wrapDeviceKeyWithPin(
	payload: StoragePayload,
	exportedB64: string,
	pin: string,
): Promise<void> {
	const salt = base64ToArrayBuffer(payload.salt);
	const pinKey = await derivePinKey(pin, salt, PIN_KDF_ITERATIONS);
	const { ciphertext, iv } = await encryptWithKey(exportedB64, pinKey);
	payload.deviceKey = null;
	payload.deviceKeyWrap = {
		iv: arrayBufferToBase64(iv),
		ciphertext: arrayBufferToBase64(ciphertext),
	};
	payload.pinKdfIterations = PIN_KDF_ITERATIONS;
	payload.pinLength = pin.length;
	writePayload(payload);
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
	const iterations = payload.pinKdfIterations ?? LEGACY_PBKDF2_ITERATIONS;
	const pinKey = await derivePinKey(pin, salt, iterations);

	const wrapIv = base64ToArrayBuffer(payload.deviceKeyWrap.iv);
	const wrapCipher = base64ToArrayBuffer(payload.deviceKeyWrap.ciphertext);

	// Decrypt deviceKey raw bytes (base64 string) using pinKey
	const deviceKeyRawB64 = await decryptWithKey(wrapCipher, wrapIv, pinKey);
	const deviceKey = await importDeviceKey(base64ToArrayBuffer(deviceKeyRawB64));
	cachedDeviceKey = deviceKey;

	// 静默升级：旧库（100k 或无 pinLength）解锁成功后立刻按现行标准重包，下次解锁即用新元数据。
	// 升级失败不影响本次解锁（下次解锁会再试）。
	const needsUpgrade = iterations < PIN_KDF_ITERATIONS || payload.pinLength === undefined;
	if (needsUpgrade) {
		try {
			await wrapDeviceKeyWithPin(payload, deviceKeyRawB64, pin);
		} catch {
			/* 静默降级：本次解锁已成功，重包失败留待下次 */
		}
	}

	return decryptAccounts(payload.data, deviceKey);
}

/**
 * 校验当前 PIN 是否正确（只解 PIN 包裹，不写缓存、不返回账户、不影响解锁状态）。
 * 供「修改 PIN 前先验证旧 PIN」使用。
 *
 * 与解锁路径共用同一套尝试计数：连续错 MAX_PIN_ATTEMPTS 次进入冷却，
 * 冷却期内一律返回 false（连正确 PIN 也不放行），且不再消耗一次 KDF。
 */
export async function verifyPin(pin: string): Promise<boolean> {
	const cooldown = checkPinCooldown();
	if (cooldown.isLocked) return false;
	const payload = readPayload();
	if (!payload?.deviceKeyWrap) return false;
	try {
		const salt = base64ToArrayBuffer(payload.salt);
		const iterations = payload.pinKdfIterations ?? LEGACY_PBKDF2_ITERATIONS;
		const pinKey = await derivePinKey(pin, salt, iterations);
		await decryptWithKey(
			base64ToArrayBuffer(payload.deviceKeyWrap.ciphertext),
			base64ToArrayBuffer(payload.deviceKeyWrap.iv),
			pinKey,
		);
		resetFailedPinAttempts();
		return true;
	} catch {
		recordFailedPinAttempt();
		return false;
	}
}

/**
 * 当前库的 PIN 位数（解锁键盘据此决定位数上限与是否自动提交）。
 * 返回 null = 旧库未记录长度：按 4-8 位的宽松区间解锁并显示确认键；
 * 解锁成功后 unlockWithPin 会补写 pinLength（静默迁移）。
 */
export function getPinLength(): number | null {
	const payload = readPayload();
	return payload?.pinLength ?? null;
}

/**
 * 清空本机保险库（忘记 PIN 时的逃生口）：删除密文、PIN 尝试计数与内存密钥。
 * 不触碰云备份（在服务端）与其它 localStorage 键。
 */
export function resetLocalVault(): void {
	cachedDeviceKey = null;
	localStorage.removeItem(STORAGE_KEY);
	localStorage.removeItem(PIN_ATTEMPTS_KEY);
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

	// 生物识别是叠加在 PIN 之上的加速入口：无 PIN 时 deviceKey 是明文，
	// 再包一层 PRF 不会提升任何安全性（钥匙仍在同一 blob 里），因此直接拒绝。
	if (payload.deviceKey) {
		throw new Error('PIN_REQUIRED_FOR_BIOMETRIC');
	}

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
	if (pin && !PIN_PATTERN.test(pin)) {
		throw new Error('WEAK_PIN');
	}

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
		delete payload.pinKdfIterations;
		delete payload.pinLength;
		writePayload(payload);
		return;
	}

	// Add PIN protection
	await wrapDeviceKeyWithPin(payload, exportedB64, pin);
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
