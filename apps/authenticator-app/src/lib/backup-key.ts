/**
 * 云备份的本地密钥状态。
 *
 * 只存「被口令/恢复码包裹的 DEK」（wraps）与其 hash；**不存明文 DEK**。
 * 服务端最新信封是 wraps 的真源：上传前比对 wrapHash，不一致则要求重新解锁。
 */

import type { BackupWrap } from './backup-envelope';

const STORAGE_KEY = 'authenticator-backup-key-v1';

export interface BackupKeyState {
	v: 2;
	wrapHash: string;
	wraps: BackupWrap[];
	updatedAt: number;
}

let cachedDek: CryptoKey | null = null;

export function readBackupKey(): BackupKeyState | null {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<BackupKeyState>;
		if (
			parsed.v !== 2 ||
			typeof parsed.wrapHash !== 'string' ||
			!Array.isArray(parsed.wraps) ||
			parsed.wraps.length === 0
		) {
			return null;
		}
		return parsed as BackupKeyState;
	} catch {
		return null;
	}
}

export function writeBackupKey(state: Omit<BackupKeyState, 'v' | 'updatedAt'>): void {
	const payload: BackupKeyState = {
		v: 2,
		wrapHash: state.wrapHash,
		wraps: state.wraps,
		updatedAt: Date.now(),
	};
	localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearBackupKey(): void {
	localStorage.removeItem(STORAGE_KEY);
	cachedDek = null;
}

export function getCachedDek(): CryptoKey | null {
	return cachedDek;
}

export function setCachedDek(dek: CryptoKey | null): void {
	cachedDek = dek;
}

/** 只清内存中的 DEK（锁屏/登出）；保留本地 wraps，避免下次还要重新恢复。 */
export function clearBackupSession(): void {
	cachedDek = null;
}
