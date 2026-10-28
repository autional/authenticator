/**
 * Web Crypto API wrappers for Autional Authenticator
 * - PBKDF2 key derivation (PIN → AES key)
 * - AES-GCM encryption/decryption for account data
 */

const PBKDF2_ITERATIONS = 100_000;
/** 备份信封专用的 KDF 下限（OWASP 对 PBKDF2-HMAC-SHA256 的现行建议）。 */
export const BACKUP_KDF_ITERATIONS = 600_000;

export function arrayBufferToBase64(buffer: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < buffer.byteLength; i++) {
		binary += String.fromCharCode(buffer[i]);
	}
	return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export async function generateDeviceKey(): Promise<CryptoKey> {
	return crypto.subtle.generateKey(
		{ name: 'AES-GCM', length: 256 },
		true, // extractable so we can wrap it with PIN
		['encrypt', 'decrypt'],
	);
}

export async function exportDeviceKey(key: CryptoKey): Promise<Uint8Array> {
	const buf = await crypto.subtle.exportKey('raw', key);
	return new Uint8Array(buf);
}

export async function importDeviceKey(raw: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		raw as BufferSource,
		'AES-GCM',
		true, // must be extractable: setPinProtection() calls exportDeviceKey() to re-wrap with PIN key
		['encrypt', 'decrypt'],
	);
}

export async function derivePinKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
	const pinData = new TextEncoder().encode(pin);
	const baseKey = await crypto.subtle.importKey('raw', pinData as BufferSource, 'PBKDF2', false, [
		'deriveKey',
	]);
	const algo: Pbkdf2Params = {
		name: 'PBKDF2',
		salt: salt as BufferSource,
		iterations: PBKDF2_ITERATIONS,
		hash: 'SHA-256',
	};
	return crypto.subtle.deriveKey(algo, baseKey, { name: 'AES-GCM', length: 256 }, true, [
		'encrypt',
		'decrypt',
	]);
}

export async function deriveKeyFromBytes(
	keyBytes: Uint8Array,
	salt: Uint8Array,
): Promise<CryptoKey> {
	const baseKey = await crypto.subtle.importKey('raw', keyBytes as BufferSource, 'PBKDF2', false, [
		'deriveKey',
	]);
	const algo: Pbkdf2Params = {
		name: 'PBKDF2',
		salt: salt as BufferSource,
		iterations: 1,
		hash: 'SHA-256',
	};
	return crypto.subtle.deriveKey(algo, baseKey, { name: 'AES-GCM', length: 256 }, true, [
		'encrypt',
		'decrypt',
	]);
}

/**
 * 由用户口令派生 AES-GCM 密钥（备份信封用）。
 * iterations 由调用方传入并随信封保存，便于以后升级而不破坏旧备份。
 */
export async function deriveKeyFromPassphrase(
	secret: string,
	salt: Uint8Array,
	iterations: number,
): Promise<CryptoKey> {
	const data = new TextEncoder().encode(secret);
	const baseKey = await crypto.subtle.importKey('raw', data as BufferSource, 'PBKDF2', false, [
		'deriveKey',
	]);
	const algo: Pbkdf2Params = {
		name: 'PBKDF2',
		salt: salt as BufferSource,
		iterations,
		hash: 'SHA-256',
	};
	return crypto.subtle.deriveKey(algo, baseKey, { name: 'AES-GCM', length: 256 }, true, [
		'encrypt',
		'decrypt',
	]);
}

export async function encryptWithKey(
	plaintext: string,
	key: CryptoKey,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(plaintext);
	const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
	return { ciphertext: new Uint8Array(cipherBuf), iv };
}

export async function decryptWithKey(
	ciphertext: Uint8Array,
	iv: Uint8Array,
	key: CryptoKey,
): Promise<string> {
	const decrypted = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource },
		key,
		ciphertext as BufferSource,
	);
	return new TextDecoder().decode(decrypted);
}

/** AES-GCM，带 additionalData（备份信封的数据/包裹都用它绑定上下文）。 */
export async function encryptWithAad(
	plaintext: string,
	key: CryptoKey,
	aad: Uint8Array,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(plaintext);
	const cipherBuf = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: aad as BufferSource },
		key,
		encoded,
	);
	return { ciphertext: new Uint8Array(cipherBuf), iv };
}

export async function decryptWithAad(
	ciphertext: Uint8Array,
	iv: Uint8Array,
	key: CryptoKey,
	aad: Uint8Array,
): Promise<string> {
	const decrypted = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource },
		key,
		ciphertext as BufferSource,
	);
	return new TextDecoder().decode(decrypted);
}

/** HMAC-SHA256（用于备份信封的整体完整性）。 */
export async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		'raw',
		keyBytes as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify'],
	);
	const sig = await crypto.subtle.sign('HMAC', key, data as BufferSource);
	return new Uint8Array(sig);
}

export async function hmacSha256Verify(
	keyBytes: Uint8Array,
	data: Uint8Array,
	signature: Uint8Array,
): Promise<boolean> {
	const key = await crypto.subtle.importKey(
		'raw',
		keyBytes as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify'],
	);
	return crypto.subtle.verify('HMAC', key, signature as BufferSource, data as BufferSource);
}

export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
	const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
	return new Uint8Array(digest);
}
