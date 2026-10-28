/**
 * 云备份信封 v2：口令 + 恢复码双包裹，DEK 恒定。
 *
 * 设计：
 *   - DEK 为随机 AES-256-GCM 密钥，跨上传保持不变；
 *   - DEK 被两个 KEK 分别包裹：口令派生 / 恢复码派生；
 *   - 数据只加密一次（用 DEK）；换口令/换恢复码只重包 DEK，不重加密数据；
 *   - 信封 MAC 覆盖 header + data 摘要，防 header 篡改与服务端替换 data。
 *
 * 服务端只存密文与 KDF 参数，零知识。
 */

import {
	BACKUP_KDF_ITERATIONS,
	arrayBufferToBase64,
	base64ToArrayBuffer,
	decryptWithAad,
	deriveKeyFromPassphrase,
	encryptWithAad,
	exportDeviceKey,
	generateDeviceKey,
	hmacSha256,
	hmacSha256Verify,
	importDeviceKey,
	sha256Bytes,
} from './crypto';

export const BACKUP_ENVELOPE_VERSION = 2;
export const BACKUP_KIND = 'mfa-backup';
export const BACKUP_ALG = 'AES-256-GCM';
export const BACKUP_KDF_NAME = 'PBKDF2-HMAC-SHA256';
export const BACKUP_KDF_POLICY = BACKUP_KDF_ITERATIONS;
export const RECOVERY_CODE_LENGTH = 32;

export type BackupWrapType = 'passphrase' | 'recovery';

export interface BackupKdf {
	name: string;
	iterations: number;
	salt: string;
}

export interface BackupWrap {
	type: BackupWrapType;
	kdf: BackupKdf;
	iv: string;
	ct: string;
}

export interface BackupData {
	iv: string;
	ct: string;
}

export interface BackupEnvelopeV2 {
	v: 2;
	kind: 'mfa-backup';
	alg: 'AES-256-GCM';
	kdf_policy: number;
	wraps: BackupWrap[];
	data: BackupData;
	createdAt: number;
	mac: string;
}

export interface CreatedEnvelope {
	envelope: BackupEnvelopeV2;
	recoveryCode: string;
	dek: CryptoKey;
}

export interface UnlockedEnvelope {
	dek: CryptoKey;
	/** 信封的 KDF 迭代数低于当前策略；下次上传应重包。 */
	needsRewrap: boolean;
}

export class BackupEnvelopeError extends Error {
	constructor(
		public readonly code:
			| 'INVALID_FORMAT'
			| 'INVALID_SECRET'
			| 'INVALID_ENVELOPE'
			| 'WRAP_NOT_FOUND'
			| 'NEEDS_RESTORE'
			| 'WEAK_PASSPHRASE',
	) {
		super(code);
		this.name = 'BackupEnvelopeError';
	}
}

const DATA_AAD = new TextEncoder().encode('mfa-backup:v2:data');

function encode(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function wrapAad(wrap: BackupWrap): Uint8Array {
	return encode(
		`mfa-backup:v2:wrap:${wrap.type}|${wrap.kdf.name}|${wrap.kdf.iterations}|${wrap.kdf.salt}`,
	);
}

function toBase64(bytes: Uint8Array): string {
	return arrayBufferToBase64(bytes);
}

function fromBase64(value: string): Uint8Array {
	return base64ToArrayBuffer(value);
}

function hex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function randomBytes(length: number): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(length));
}

/** v2 信封判别：JSON 对象；v1 是 base64(iv):base64(ct)。 */
export function isEnvelopeV2(raw: string): boolean {
	return raw.trimStart().startsWith('{');
}

export function parseEnvelope(raw: string): BackupEnvelopeV2 {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new BackupEnvelopeError('INVALID_FORMAT');
	}
	if (!parsed || typeof parsed !== 'object') throw new BackupEnvelopeError('INVALID_FORMAT');
	const env = parsed as Partial<BackupEnvelopeV2>;
	if (
		env.v !== BACKUP_ENVELOPE_VERSION ||
		env.kind !== BACKUP_KIND ||
		env.alg !== BACKUP_ALG ||
		!Array.isArray(env.wraps) ||
		!env.data ||
		typeof env.data.iv !== 'string' ||
		typeof env.data.ct !== 'string' ||
		typeof env.mac !== 'string'
	) {
		throw new BackupEnvelopeError('INVALID_FORMAT');
	}
	return env as BackupEnvelopeV2;
}

export function serializeEnvelope(envelope: BackupEnvelopeV2): string {
	return JSON.stringify(envelope);
}

/** 服务端 backup_type 字段；当前只有 TOTP 一类。 */
export function backupTypeOf(_envelope: BackupEnvelopeV2): string {
	return 'totp';
}

// ────────────────────────────── Crockford Base32 ──────────────────────────────

const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function base32Encode(bytes: Uint8Array): string {
	let value = 0;
	let bits = 0;
	let out = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += BASE32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
	return out;
}

export function generateRecoveryCode(): string {
	return formatRecoveryCode(base32Encode(randomBytes(20)));
}

export function normalizeRecoveryCode(input: string): string {
	const cleaned = input
		.toUpperCase()
		.replace(/[^0-9A-Z]/g, '')
		.replace(/[IL]/g, '1')
		.replace(/O/g, '0');
	if (cleaned.length !== RECOVERY_CODE_LENGTH || /[^0-9A-HJKMNP-TV-Z]/.test(cleaned)) {
		throw new BackupEnvelopeError('INVALID_SECRET');
	}
	return cleaned;
}

export function formatRecoveryCode(code: string): string {
	return code.replace(/(.{4})/g, '$1-').replace(/-$/, '');
}

// ────────────────────────────── key wrapping ──────────────────────────────

async function deriveKek(secret: string, kdf: BackupKdf): Promise<CryptoKey> {
	return deriveKeyFromPassphrase(secret, fromBase64(kdf.salt), kdf.iterations);
}

async function wrapDek(
	dekRawBase64: string,
	secret: string,
	type: BackupWrapType,
): Promise<BackupWrap> {
	const salt = randomBytes(16);
	const kdf: BackupKdf = {
		name: BACKUP_KDF_NAME,
		iterations: BACKUP_KDF_POLICY,
		salt: toBase64(salt),
	};
	const kek = await deriveKeyFromPassphrase(secret, salt, kdf.iterations);
	const partial: BackupWrap = { type, kdf, iv: '', ct: '' };
	const { ciphertext, iv } = await encryptWithAad(dekRawBase64, kek, wrapAad(partial));
	return { type, kdf, iv: toBase64(iv), ct: toBase64(ciphertext) };
}

async function unwrapDek(wrap: BackupWrap, secret: string): Promise<string> {
	const kek = await deriveKek(secret, wrap.kdf);
	try {
		return await decryptWithAad(fromBase64(wrap.ct), fromBase64(wrap.iv), kek, wrapAad(wrap));
	} catch {
		throw new BackupEnvelopeError('INVALID_SECRET');
	}
}

function canonicalHeader(envelope: BackupEnvelopeV2): string {
	return JSON.stringify({
		v: envelope.v,
		kind: envelope.kind,
		alg: envelope.alg,
		kdf_policy: envelope.kdf_policy,
		wraps: envelope.wraps.map((wrap) => ({
			type: wrap.type,
			kdf: {
				name: wrap.kdf.name,
				iterations: wrap.kdf.iterations,
				salt: wrap.kdf.salt,
			},
		})),
		createdAt: envelope.createdAt,
	});
}

async function dataDigest(data: BackupData): Promise<string> {
	return hex(await sha256Bytes(encode(`${data.iv}.${data.ct}`)));
}

async function computeMac(
	dek: CryptoKey,
	envelope: BackupEnvelopeV2,
	digest: string,
): Promise<string> {
	const raw = await exportDeviceKey(dek);
	const signature = await hmacSha256(raw, encode(`${canonicalHeader(envelope)}.${digest}`));
	return toBase64(signature);
}

async function verifyMac(dek: CryptoKey, envelope: BackupEnvelopeV2): Promise<boolean> {
	const raw = await exportDeviceKey(dek);
	const digest = await dataDigest(envelope.data);
	return hmacSha256Verify(
		raw,
		encode(`${canonicalHeader(envelope)}.${digest}`),
		fromBase64(envelope.mac),
	);
}

async function encryptData(accountsJson: string, dek: CryptoKey): Promise<BackupData> {
	const { ciphertext, iv } = await encryptWithAad(accountsJson, dek, DATA_AAD);
	return { iv: toBase64(iv), ct: toBase64(ciphertext) };
}

async function seal(envelope: BackupEnvelopeV2, dek: CryptoKey): Promise<BackupEnvelopeV2> {
	const digest = await dataDigest(envelope.data);
	const mac = await computeMac(dek, envelope, digest);
	return { ...envelope, mac };
}

// ────────────────────────────── public API ──────────────────────────────

/** 首次创建：新 DEK + 口令包裹 + 恢复码包裹。 */
export async function createEnvelope(
	accountsJson: string,
	passphrase: string,
): Promise<CreatedEnvelope> {
	if (passphrase.length < 10) throw new BackupEnvelopeError('WEAK_PASSPHRASE');
	const dek = await generateDeviceKey();
	const dekRaw = toBase64(await exportDeviceKey(dek));
	const recoveryCode = generateRecoveryCode();
	const wraps: BackupWrap[] = [
		await wrapDek(dekRaw, passphrase, 'passphrase'),
		await wrapDek(dekRaw, normalizeRecoveryCode(recoveryCode), 'recovery'),
	];
	const base: BackupEnvelopeV2 = {
		v: BACKUP_ENVELOPE_VERSION,
		kind: BACKUP_KIND,
		alg: BACKUP_ALG,
		kdf_policy: BACKUP_KDF_POLICY,
		wraps,
		data: await encryptData(accountsJson, dek),
		createdAt: Date.now(),
		mac: '',
	};
	return { envelope: await seal(base, dek), recoveryCode, dek };
}

export async function unlockEnvelope(
	envelope: BackupEnvelopeV2,
	secret: { passphrase?: string; recoveryCode?: string },
): Promise<UnlockedEnvelope> {
	const type: BackupWrapType = secret.recoveryCode ? 'recovery' : 'passphrase';
	const wrap = envelope.wraps.find((item) => item.type === type);
	if (!wrap) throw new BackupEnvelopeError('WRAP_NOT_FOUND');
	const normalized =
		type === 'recovery' ? normalizeRecoveryCode(secret.recoveryCode ?? '') : (secret.passphrase ?? '');
	if (!normalized) throw new BackupEnvelopeError('INVALID_SECRET');
	const dekRaw = await unwrapDek(wrap, normalized);
	const dek = await importDeviceKey(fromBase64(dekRaw));
	if (!(await verifyMac(dek, envelope))) {
		throw new BackupEnvelopeError('INVALID_ENVELOPE');
	}
	return { dek, needsRewrap: wrap.kdf.iterations < BACKUP_KDF_POLICY };
}

export async function decryptEnvelope(
	envelope: BackupEnvelopeV2,
	dek: CryptoKey,
): Promise<string> {
	try {
		return await decryptWithAad(
			fromBase64(envelope.data.ct),
			fromBase64(envelope.data.iv),
			dek,
			DATA_AAD,
		);
	} catch {
		throw new BackupEnvelopeError('INVALID_ENVELOPE');
	}
}

/** 只换数据：DEK/wraps 不变。 */
export async function reencryptEnvelope(
	envelope: BackupEnvelopeV2,
	dek: CryptoKey,
	accountsJson: string,
): Promise<BackupEnvelopeV2> {
	const next: BackupEnvelopeV2 = {
		...envelope,
		data: await encryptData(accountsJson, dek),
		createdAt: Date.now(),
	};
	return seal(next, dek);
}

/** 换口令：重包 passphrase wrap，recovery wrap 原样保留。 */
export async function rewrapPassphrase(
	envelope: BackupEnvelopeV2,
	dek: CryptoKey,
	passphrase: string,
): Promise<BackupEnvelopeV2> {
	if (passphrase.length < 10) throw new BackupEnvelopeError('WEAK_PASSPHRASE');
	const dekRaw = toBase64(await exportDeviceKey(dek));
	const wraps = envelope.wraps.filter((wrap) => wrap.type !== 'passphrase');
	wraps.unshift(await wrapDek(dekRaw, passphrase, 'passphrase'));
	return seal({ ...envelope, wraps, createdAt: Date.now() }, dek);
}

/** 换恢复码：返回新码（只展示一次）。 */
export async function rotateRecoveryCode(
	envelope: BackupEnvelopeV2,
	dek: CryptoKey,
): Promise<{ envelope: BackupEnvelopeV2; recoveryCode: string }> {
	const dekRaw = toBase64(await exportDeviceKey(dek));
	const recoveryCode = generateRecoveryCode();
	const wraps = envelope.wraps.filter((wrap) => wrap.type !== 'recovery');
	wraps.push(await wrapDek(dekRaw, normalizeRecoveryCode(recoveryCode), 'recovery'));
	return {
		envelope: await seal({ ...envelope, wraps, createdAt: Date.now() }, dek),
		recoveryCode,
	};
}

/** 重置备份密钥：新 DEK、新口令、新恢复码（旧备份从此不可解）。 */
export async function rotateBackupKey(
	accountsJson: string,
	passphrase: string,
): Promise<CreatedEnvelope> {
	return createEnvelope(accountsJson, passphrase);
}

export async function hashWraps(wraps: BackupWrap[]): Promise<string> {
	return hex(await sha256Bytes(encode(JSON.stringify(wraps))));
}

export async function checksumOfData(data: BackupData): Promise<string> {
	return hex(await sha256Bytes(encode(`${data.iv}.${data.ct}`)));
}
