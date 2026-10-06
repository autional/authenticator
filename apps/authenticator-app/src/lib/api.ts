/**
 * Autional Authenticator App — API wrappers
 *
 * Uses @autional/shared GeneratedApi for backend communication.
 */

import { apiClient, GeneratedApi, GeneratedTypes } from '@autional/shared';
import { extractList } from '@autional/shared';

export async function getCurrentUser(): Promise<GeneratedTypes.UserWithIdentitiesResponse> {
	return await GeneratedApi.authMe();
}

export async function getMfaStatus(userId: string): Promise<GeneratedTypes.MFAStatusResponse> {
	return await GeneratedApi.mfaStatusByStatus(userId);
}

export async function enableTotp(): Promise<GeneratedTypes.TOTPEnableResponse> {
	return await GeneratedApi.mfaTotpEnablePost({});
}

export async function verifyTotpSetup(code: string, userId: string) {
	return await GeneratedApi.mfaTotpVerifyPost({ code, user_id: userId });
}

export async function disableTotp(code: string) {
	return await GeneratedApi.mfaTotpDisablePost({ code });
}

export async function validateTotpCode(code: string, userId: string): Promise<boolean> {
	try {
		const res: GeneratedTypes.ValidResponse = await GeneratedApi.mfaTotpValidatePost({
			code,
			user_id: userId,
		});
		return res?.valid === true;
	} catch {
		return false;
	}
}

export async function generateBackupCodes(): Promise<GeneratedTypes.BackupCodesResponse> {
	return await GeneratedApi.mfaBackupCodesGeneratePost({});
}

export async function getBackupCodesCount(): Promise<{ count: number }> {
	return await GeneratedApi.mfaBackupCodesCount();
}

export async function getPushHistory(
	params?: Record<string, unknown>,
): Promise<GeneratedTypes.PushHistoryListResponse> {
	return await GeneratedApi.mfaPushHistory(params);
}

export async function getAuthenticatorDevices(): Promise<GeneratedTypes.AuthenticatorDeviceItem[]> {
	const res = await GeneratedApi.authMeAuthenticatorDevices();
	return extractList<GeneratedTypes.AuthenticatorDeviceItem>(res);
}

export async function getCloudBackups() {
	return await GeneratedApi.authMeAuthenticatorBackup();
}

export async function uploadCloudBackup(data: Record<string, unknown>) {
	return await GeneratedApi.authMeAuthenticatorBackupPost(data);
}

export async function deleteCloudBackup(id: string): Promise<void> {
	return await GeneratedApi.authMeAuthenticatorBackupByBackupDelete(id);
}

export async function getDeviceSyncList(): Promise<GeneratedTypes.DeviceSyncListResponse> {
	const res = await GeneratedApi.mfaDevicesSync();
	return res;
}

export async function syncDevice(
	data: GeneratedTypes.DeviceSyncRequest,
): Promise<GeneratedTypes.DeviceSyncResponse> {
	return await GeneratedApi.mfaDevicesSyncPost(data);
}

/**
 * DELETE 解绑同步设备（AU-21 W2）。
 * rc.21 生成物无 mfaDevicesSync DELETE，走 apiClient（同拦截器/信封语义），
 * URL 字面量与生成物同构（generated/api.ts mfaDevicesSync*）。
 */
export async function deleteSyncDevice(syncId: string): Promise<void> {
	await apiClient.delete(`/mfa/api/v1/mfa/devices/sync/${syncId}`);
}
