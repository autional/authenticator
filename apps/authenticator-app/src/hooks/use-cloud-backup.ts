import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { extractItem, extractList, extractApiErrorMessage, extractApiError } from '@autional/shared';
import type { TotpAccount } from '@/lib/store';
import { parseAccounts, serializeAccounts } from '@/lib/backup-payload';
import { semanticsOfError } from '@/lib/error-semantics';
import {
	getCloudBackups,
	uploadCloudBackup,
	getDeviceSyncList,
	syncDevice,
	deleteSyncDevice,
	deleteCloudBackup,
	deleteAllCloudBackups,
} from '@/lib/api';
import { base64ToArrayBuffer, decryptWithKey } from '@/lib/crypto';import {
	BackupEnvelopeError,
	backupTypeOf,
	checksumOfData,
	createEnvelope,
	decryptEnvelope,
	hashWraps,
	isEnvelopeV2,
	parseEnvelope,
	reencryptEnvelope,
	rewrapPassphrase,
	rotateRecoveryCode,
	serializeEnvelope,
	unlockEnvelope,
	type BackupEnvelopeV2,
} from '@/lib/backup-envelope';
import {
	getCachedDek,
	readBackupKey,
	setCachedDek,
	writeBackupKey,
} from '@/lib/backup-key';

let _ensureDeviceKey: (() => Promise<CryptoKey>) | null = null;
async function getEnsureDeviceKey(): Promise<() => Promise<CryptoKey>> {
	if (!_ensureDeviceKey) {
		const mod = await import('@/lib/storage');
		_ensureDeviceKey = mod.ensureDeviceKey;
	}
	return _ensureDeviceKey;
}

export interface CloudBackup {
	id: string;
	accountCount: number;
	backupType: string;
	checksum: string;
	encryptedData: string;
	createdAt: string;
	deviceName: string;
	version: number;
}

export interface SyncDevice {
	id: string;
	deviceName: string;
	deviceFingerprint: string;
	lastSyncAt: string;
	accountCount?: number;
	/** metadata_v1=仅登记；e2ee_v1=客户端密文；legacy_v1=历史行（不再回传） */
	scheme?: string;
	/** 历史行（服务端可解密形态）已停止回传，需要重新登记 */
	needsResync?: boolean;
	/** 仅 e2ee_v1 有值（客户端密文，服务端不解析） */
	totpDevices?: string;
}

export type BackupFormat = 'v1' | 'v2';

function normalizeBackup(raw: unknown): CloudBackup | null {
	if (!raw || typeof raw !== 'object') return null;
	const item = raw as CloudBackup & { encrypted_data?: string };
	return {
		...item,
		encryptedData: item.encryptedData ?? item.encrypted_data ?? '',
	};
}

function backupErrorKey(err: unknown): string | null {
	if (err instanceof BackupEnvelopeError) {
		switch (err.code) {
			case 'INVALID_SECRET':
				return 'cloudBackup.passphraseWrong';
			case 'INVALID_ENVELOPE':
			case 'INVALID_FORMAT':
				return 'cloudBackup.invalidFormat';
			case 'WEAK_PASSPHRASE':
				return 'cloudBackup.passphraseTooShort';
			case 'NEEDS_RESTORE':
				return 'cloudBackup.restoreFirst';
			default:
				return 'cloudBackup.downloadFailed';
		}
	}
	return null;
}

export function useCloudBackup() {
	const { t } = useTranslation();
	const [backup, setBackup] = useState<CloudBackup | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [needsRestore, setNeedsRestore] = useState<boolean | null>(null);

	const fetchBackup = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await getCloudBackups();
			const data = normalizeBackup(extractItem(res));
			setBackup(data);
		} catch (err: unknown) {
			if ((err as { response?: { status?: number } })?.response?.status !== 404) {
				setError(extractApiErrorMessage(err, t('cloudBackup.loadFailed')));
			}
			setBackup(null);
		} finally {
			setLoading(false);
		}
	}, [t]);

	useEffect(() => {
		fetchBackup();
	}, [fetchBackup]);

	const format: BackupFormat | null = backup?.encryptedData
		? isEnvelopeV2(backup.encryptedData)
			? 'v2'
			: 'v1'
		: null;

	// v2 且本地没有对应 wraps（或 wraps 已被其它设备换过）→ 需要先恢复。
	useEffect(() => {
		let cancelled = false;
		if (format !== 'v2' || !backup?.encryptedData) {
			setNeedsRestore(null);
			return;
		}
		(async () => {
			try {
				const envelope = parseEnvelope(backup.encryptedData);
				const local = readBackupKey();
				if (!local) {
					if (!cancelled) setNeedsRestore(true);
					return;
				}
				const hash = await hashWraps(envelope.wraps);
				if (!cancelled) setNeedsRestore(hash !== local.wrapHash);
			} catch {
				if (!cancelled) setNeedsRestore(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [format, backup?.encryptedData]);

	return { backup, format, needsRestore, loading, error, refetch: fetchBackup };
}

export function useUploadCloudBackup() {
	const { t } = useTranslation();
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const commit = useCallback(
		async (
			envelope: BackupEnvelopeV2,
			dek: CryptoKey,
			accountCount: number,
			expectedLatestHash?: string,
		) => {
			// 并发保护：普通上传要求「云端 wraps = 本次 wraps」；轮换要求「云端 wraps = 解锁时的 wraps」。
			const latestRes = await getCloudBackups();
			const latestBackup = normalizeBackup(extractItem(latestRes));
			if (latestBackup?.encryptedData && isEnvelopeV2(latestBackup.encryptedData)) {
				const latestEnvelope = parseEnvelope(latestBackup.encryptedData);
				const [latestHash, incomingHash] = await Promise.all([
					hashWraps(latestEnvelope.wraps),
					hashWraps(envelope.wraps),
				]);
				const mismatch = expectedLatestHash
					? latestHash !== expectedLatestHash
					: latestHash !== incomingHash;
				if (mismatch) {
					throw new BackupEnvelopeError('NEEDS_RESTORE');
				}
			}
			const checksum = await checksumOfData(envelope.data);
			await uploadCloudBackup({
				encrypted_data: serializeEnvelope(envelope),
				backup_type: backupTypeOf(envelope),
				device_name: getDeviceName(t('deviceSync.unknownDevice')),
				account_count: accountCount,
				checksum,
			});
			writeBackupKey({
				wrapHash: await hashWraps(envelope.wraps),
				wraps: envelope.wraps,
			});
			setCachedDek(dek);
		},
		[t],
	);

	/** 首次上传：创建新 DEK + 口令包 + 恢复码包；返回恢复码给页面展示。 */
	const prepareNew = useCallback(
		async (accounts: TotpAccount[], passphrase: string) => {
			setUploading(true);
			setError(null);
			try {
				return await createEnvelope(serializeAccounts(accounts), passphrase);
			} catch (err: unknown) {
				const key = backupErrorKey(err);
				const message = key
					? t(key)
					: extractApiErrorMessage(err, t('cloudBackup.uploadFailed'));
				setError(message);
				throw new Error(message);
			} finally {
				setUploading(false);
			}
		},
		[t],
	);

	/** 提交已准备好的信封（页面在用户确认恢复码后调用）。 */
	const uploadPrepared = useCallback(
		async (
			envelope: BackupEnvelopeV2,
			dek: CryptoKey,
			accountCount: number,
			expectedLatestHash?: string,
		) => {
			setUploading(true);
			setError(null);
			try {
				await commit(envelope, dek, accountCount, expectedLatestHash);
			} catch (err: unknown) {
				const key = backupErrorKey(err);
				const message = key
					? t(key)
					: extractApiErrorMessage(err, t('cloudBackup.uploadFailed'));
				setError(message);
				throw new Error(message);
			} finally {
				setUploading(false);
			}
		},
		[commit, t],
	);

	/** 已有 v2 备份：用当前口令解锁服务端信封，换数据后上传（wraps 不变）。 */
	const uploadExisting = useCallback(
		async (accounts: TotpAccount[], passphrase: string) => {
			setUploading(true);
			setError(null);
			try {
				const res = await getCloudBackups();
				const backup = normalizeBackup(extractItem(res));
				if (!backup?.encryptedData || !isEnvelopeV2(backup.encryptedData)) {
					throw new BackupEnvelopeError('INVALID_FORMAT');
				}
				const envelope = parseEnvelope(backup.encryptedData);
				const local = readBackupKey();
				const serverHash = await hashWraps(envelope.wraps);
				// 本地 wraps 与服务端不一致（另一设备换过口令/恢复码）→ 必须重新解锁。
				let unlocked = local?.wrapHash === serverHash ? getCachedDek() : null;
				let needsRewrap = false;
				if (!unlocked) {
					const result = await unlockEnvelope(envelope, { passphrase });
					unlocked = result.dek;
					needsRewrap = result.needsRewrap;
				}
				let next = envelope;
				if (needsRewrap) {
					next = await rewrapPassphrase(next, unlocked, passphrase);
				}
				next = await reencryptEnvelope(next, unlocked, serializeAccounts(accounts));
				await commit(next, unlocked, accounts.length);
			} catch (err: unknown) {
				const key = backupErrorKey(err);
				const message = key
					? t(key)
					: extractApiErrorMessage(err, t('cloudBackup.uploadFailed'));
				setError(message);
				throw new Error(message);
			} finally {
				setUploading(false);
			}
		},
		[commit, t],
	);

	/** 更换备份口令：当前口令解锁 → 重包 passphrase wrap → 立即上传。 */
	const rotatePassphrase = useCallback(
		async (currentPassphrase: string, nextPassphrase: string) => {
			setUploading(true);
			setError(null);
			try {
				const res = await getCloudBackups();
				const backup = normalizeBackup(extractItem(res));
				if (!backup?.encryptedData || !isEnvelopeV2(backup.encryptedData)) {
					throw new BackupEnvelopeError('INVALID_FORMAT');
				}
				const envelope = parseEnvelope(backup.encryptedData);
				const expectedLatestHash = await hashWraps(envelope.wraps);
				const { dek } = await unlockEnvelope(envelope, { passphrase: currentPassphrase });
				const rotated = await rewrapPassphrase(envelope, dek, nextPassphrase);
				await commit(rotated, dek, backup.accountCount, expectedLatestHash);
			} catch (err: unknown) {
				const key = backupErrorKey(err);
				const message = key
					? t(key)
					: extractApiErrorMessage(err, t('cloudBackup.uploadFailed'));
				setError(message);
				throw new Error(message);
			} finally {
				setUploading(false);
			}
		},
		[commit, t],
	);

	/** 准备轮换恢复码：解锁 → 生成新码/新 wrap；页面展示新码后再提交。 */
	const prepareRecoveryRotation = useCallback(
		async (passphrase: string) => {
			setUploading(true);
			setError(null);
			try {
				const res = await getCloudBackups();
				const backup = normalizeBackup(extractItem(res));
				if (!backup?.encryptedData || !isEnvelopeV2(backup.encryptedData)) {
					throw new BackupEnvelopeError('INVALID_FORMAT');
				}
				const envelope = parseEnvelope(backup.encryptedData);
				const expectedLatestHash = await hashWraps(envelope.wraps);
				const { dek } = await unlockEnvelope(envelope, { passphrase });
				const { envelope: rotated, recoveryCode } = await rotateRecoveryCode(envelope, dek);
				return {
					envelope: rotated,
					recoveryCode,
					dek,
					accountCount: backup.accountCount,
					expectedLatestHash,
				};
			} catch (err: unknown) {
				const key = backupErrorKey(err);
				const message = key
					? t(key)
					: extractApiErrorMessage(err, t('cloudBackup.uploadFailed'));
				setError(message);
				throw new Error(message);
			} finally {
				setUploading(false);
			}
		},
		[t],
	);

	return {
		uploading,
		error,
		prepareNew,
		uploadPrepared,
		uploadExisting,
		rotatePassphrase,
		prepareRecoveryRotation,
	};
}

export function useDownloadCloudBackup() {
	const { t } = useTranslation();
	const [downloading, setDownloading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	/** 旧格式（v1）：仅创建它的设备可解。 */
	const downloadLegacy = useCallback(async (): Promise<TotpAccount[] | null> => {
		setDownloading(true);
		setError(null);
		try {
			const res = await getCloudBackups();
			const data = normalizeBackup(extractItem(res));
			if (!data?.encryptedData) {
				if (!data) return null;
				setError(t('cloudBackup.noBackupData'));
				return null;
			}
			const [ivB64, cipherB64] = data.encryptedData.split(':');
			if (!ivB64 || !cipherB64) {
				setError(t('cloudBackup.invalidFormat'));
				return null;
			}
			const encryptionKey = await (await getEnsureDeviceKey())();
			const iv = base64ToArrayBuffer(ivB64);
			const ciphertext = base64ToArrayBuffer(cipherB64);
			const json = await decryptWithKey(ciphertext, iv, encryptionKey);
			return parseAccounts(json);
		} catch (err: unknown) {
			if ((err as { response?: { status?: number } })?.response?.status !== 404) {
				setError(extractApiErrorMessage(err, t('cloudBackup.downloadFailed')));
			}
			return null;
		} finally {
			setDownloading(false);
		}
	}, [t]);

	/** v2：口令或恢复码解锁，成功后把 wraps 写回本地。 */
	const downloadV2 = useCallback(
		async (secret: { passphrase?: string; recoveryCode?: string }): Promise<TotpAccount[] | null> => {
			setDownloading(true);
			setError(null);
			try {
				const res = await getCloudBackups();
				const data = normalizeBackup(extractItem(res));
				if (!data?.encryptedData || !isEnvelopeV2(data.encryptedData)) {
					setError(t('cloudBackup.noBackupData'));
					return null;
				}
				const envelope = parseEnvelope(data.encryptedData);
				const { dek, needsRewrap } = await unlockEnvelope(envelope, secret);
				const json = await decryptEnvelope(envelope, dek);
				writeBackupKey({
					wrapHash: await hashWraps(envelope.wraps),
					wraps: envelope.wraps,
				});
				setCachedDek(dek);
				if (needsRewrap) {
					// 低迭代旧信封：提示用户下次上传会自动重包（不阻断恢复）。
					console.warn('backup envelope kdf below policy; will rewrap on next upload');
				}
				return parseAccounts(json);
			} catch (err: unknown) {
				const key = backupErrorKey(err);
				const message = key
					? t(key)
					: extractApiErrorMessage(err, t('cloudBackup.downloadFailed'));
				setError(message);
				throw new Error(message);
			} finally {
				setDownloading(false);
			}
		},
		[t],
	);

	return { downloading, error, downloadLegacy, downloadV2 };
}

export function useDeviceSyncList() {
	const { t } = useTranslation();
	const [devices, setDevices] = useState<SyncDevice[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchDevices = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await getDeviceSyncList();
			const items = extractList(res) as SyncDevice[];
			setDevices(Array.isArray(items) ? items : []);
		} catch (err: unknown) {
			setError(extractApiErrorMessage(err, t('deviceSync.loadFailed')));
		} finally {
			setLoading(false);
		}
	}, [t]);

	useEffect(() => {
		fetchDevices();
	}, [fetchDevices]);

	return { devices, loading, error, refetch: fetchDevices };
}

export function useSyncDevice() {
	const { t } = useTranslation();
	const [syncing, setSyncing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const sync = useCallback(
		async (deviceName: string) => {
			setSyncing(true);
			setError(null);
			try {
				const deviceFingerprint = await computeDeviceFingerprint();
				// 安全口径（2026-10）：设备同步只登记设备，**不上传任何 TOTP 密钥**。
				// 跨设备迁移走「设置 → 数据管理 → 加密导出/导入」（用户口令加密）。
				// totpDevices 置空：后端按 metadata_v1 处理（旧生成物类型仍要求该字段）。
				await syncDevice({ deviceName, deviceFingerprint, totpDevices: '' });
			} catch (err: unknown) {
				// AU-21：上限错误 → 可行动提示（去重/解绑自恢复）。契约驱动：ui_observation='action_required'
				if (semanticsOfError(err)?.uiObservation === 'action_required') {
					setError(t('deviceSync.limitReachedHint'));
				} else {
					setError(extractApiErrorMessage(err, t('deviceSync.syncFailed')));
				}
				throw err;
			} finally {
				setSyncing(false);
			}
		},
		[t],
	);

	return { sync, syncing, error };
}

/** DELETE 解绑同步设备（AU-21：上限后可自恢复的第二出路）。 */
export function useDeleteSyncDevice() {
	const { t } = useTranslation();
	const [removing, setRemoving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const remove = useCallback(
		async (id: string) => {
			setRemoving(true);
			setError(null);
			try {
				await deleteSyncDevice(id);
			} catch (err: unknown) {
				setError(extractApiErrorMessage(err, t('deviceSync.removeFailed')));
				throw err;
			} finally {
				setRemoving(false);
			}
		},
		[t],
	);

	return { remove, removing, error };
}

async function computeDeviceFingerprint(): Promise<string> {
	const data = [
		navigator.userAgent,
		navigator.language,
		screen.width,
		screen.height,
		screen.colorDepth,
		navigator.hardwareConcurrency || '',
		navigator.platform || '',
	].join('|');
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function getDeviceName(unknownLabel = 'Unknown device'): string {
	const ua = navigator.userAgent;
	if (ua.includes('iPhone')) return 'iPhone';
	if (ua.includes('iPad')) return 'iPad';
	if (ua.includes('Android')) return 'Android';
	if (ua.includes('Windows')) return 'Windows PC';
	if (ua.includes('Mac')) return 'Mac';
	if (ua.includes('Linux')) return 'Linux';
	return unknownLabel;
}

/** 删除云端备份（单一入口：identity；storage 侧拒绝跨域删除）。 */
export function useDeleteCloudBackup() {
	const { t } = useTranslation();
	const [deleting, setDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const deleteBackup = useCallback(
		async (id: string) => {
			setDeleting(true);
			setError(null);
			try {
				await deleteCloudBackup(id);
			} catch (err) {
				setError(extractApiErrorMessage(err, t('cloudBackup.deleteFailed')));
				throw err;
			} finally {
				setDeleting(false);
			}
		},
		[t],
	);

	const deleteAllBackups = useCallback(async () => {
		setDeleting(true);
		setError(null);
		try {
			await deleteAllCloudBackups();
		} catch (err) {
			setError(extractApiErrorMessage(err, t('cloudBackup.deleteFailed')));
			throw err;
		} finally {
			setDeleting(false);
		}
	}, [t]);

	return { deleting, error, deleteBackup, deleteAllBackups };
}
