import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { extractItem, extractList, extractApiErrorMessage, extractApiError } from '@autional/shared';
import type { TotpAccount } from '@/lib/store';
import { semanticsOfError } from '@/lib/error-semantics';
import {
	getCloudBackups,
	uploadCloudBackup,
	getDeviceSyncList,
	syncDevice,
	deleteSyncDevice,
} from '@/lib/api';
import {
	encryptWithKey,
	decryptWithKey,
	arrayBufferToBase64,
	base64ToArrayBuffer,
} from '@/lib/crypto';

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

export function useCloudBackup() {
	const { t } = useTranslation();
	const [backup, setBackup] = useState<CloudBackup | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchBackup = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await getCloudBackups();
			const data = extractItem(res) as CloudBackup | null;
			setBackup(data ?? null);
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

	return { backup, loading, error, refetch: fetchBackup };
}

export function useUploadCloudBackup() {
	const { t } = useTranslation();
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const upload = useCallback(
		async (accounts: TotpAccount[]) => {
			setUploading(true);
			setError(null);
			try {
				const encryptionKey = await (await getEnsureDeviceKey())();
				const json = JSON.stringify(
					accounts.map((a) => ({
						id: a.id,
						name: a.name,
						username: a.username,
						secret: a.secret,
						algorithm: a.algorithm,
						digits: a.digits,
						period: a.period,
						icon: a.icon,
						group: a.group,
						order: a.order,
						createdAt: a.createdAt,
					})),
				);
				const { ciphertext, iv } = await encryptWithKey(json, encryptionKey);
				const encryptedData = `${arrayBufferToBase64(iv)}:${arrayBufferToBase64(ciphertext)}`;
				const checksum = await computeSHA256(json);

				await uploadCloudBackup({
					encrypted_data: encryptedData,
					backup_type: 'totp',
					device_name: getDeviceName(t('deviceSync.unknownDevice')),
					account_count: accounts.length,
					checksum,
				});
			} catch (err: unknown) {
				setError(extractApiErrorMessage(err, t('cloudBackup.uploadFailed')));
				throw err;
			} finally {
				setUploading(false);
			}
		},
		[t],
	);

	return { upload, uploading, error };
}

export function useDownloadCloudBackup() {
	const { t } = useTranslation();
	const [downloading, setDownloading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const download = useCallback(async (): Promise<TotpAccount[] | null> => {
		setDownloading(true);
		setError(null);
		try {
			const res = await getCloudBackups();
			const data = extractItem(res) as CloudBackup | null;
			// 后端可能返回 snake_case 的 encrypted_data（旧契约），兼容读取
			const encryptedData =
				data?.encryptedData ?? (data as CloudBackup & { encrypted_data?: string })?.encrypted_data;
			if (!encryptedData) {
				// 404 means no backup exists — not an error
				if (!data) return null;
				setError(t('cloudBackup.noBackupData'));
				return null;
			}
			const raw = encryptedData as string;
			const [ivB64, cipherB64] = raw.split(':');
			if (!ivB64 || !cipherB64) {
				setError(t('cloudBackup.invalidFormat'));
				return null;
			}
			const encryptionKey = await (await getEnsureDeviceKey())();
			const iv = base64ToArrayBuffer(ivB64);
			const ciphertext = base64ToArrayBuffer(cipherB64);
			const json = await decryptWithKey(ciphertext, iv, encryptionKey);
			const parsedAccounts = JSON.parse(json) as Partial<TotpAccount>[];
			return parsedAccounts.map((a) => ({ ...a, type: a.type || 'totp' })) as TotpAccount[];
		} catch (err: unknown) {
			if ((err as { response?: { status?: number } })?.response?.status !== 404) {
				setError(extractApiErrorMessage(err, t('cloudBackup.downloadFailed')));
			}
			return null;
		} finally {
			setDownloading(false);
		}
	}, [t]);

	return { download, downloading, error };
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

async function computeSHA256(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
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
