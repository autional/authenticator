/**
 * Autional Authenticator App — Push MFA subscription & challenge management
 *
 * Uses Web Push API + notification-service for Push MFA.
 */

import { extractItem, extractList, GeneratedTypes } from '@autional/shared';
export { getVapidPublicKey, subscribeBrowserPush, unsubscribeBrowserPush } from '@autional/shared';
import {
	pushSubscriptionsPost,
	pushSubscriptions,
	pushSubscriptionsDelete,
	mfaPushChallengePost,
	mfaPushChallengeByChallenge,
	mfaPushApprovePost,
	mfaPushDenyPost,
} from '@autional/shared/generated/api';

// ============ Push Subscription ============

export interface PushSubKeys {
	p256dh: string;
	auth: string;
}

export interface PushSubRequest {
	endpoint: string;
	keys: PushSubKeys;
	device_name?: string;
	device_type?: string;
	user_agent?: string;
}

export async function registerPushSubscription(sub: PushSubRequest): Promise<void> {
	// PushSubRequest 使用 snake_case（device_name/device_type/user_agent），
	// 生成 API 期望 camelCase（请求拦截器统一转 snake_case）→ 兼容转换
	await pushSubscriptionsPost(sub as unknown as GeneratedTypes.PushSubscriptionRequest);
}

// 订阅行（GET /push/subscriptions items；响应经拦截器 PascalCase→camelCase；endpoint 为删除标识）
export interface PushSubscriptionItem {
	id?: string;
	endpoint?: string;
	deviceName?: string;
	deviceType?: string;
	createdAt?: string;
}

export async function getPushSubscriptions(): Promise<PushSubscriptionItem[]> {
	const res = await pushSubscriptions();
	return extractList<PushSubscriptionItem>(res);
}

export async function unregisterPushSubscription(endpoint: string): Promise<void> {
	await pushSubscriptionsDelete({ endpoint });
}

// ============ Push Challenge (MFA) ============

// 响应字段一律 camelCase：GeneratedApi 响应经 interceptor 自动 PascalCase→camelCase 转换
export interface PushChallengeResponse {
	challengeId: string;
	userId: string;
	status: string;
	loginContext?: string;
	numberMatching?: string;
	expiresIn: number;
	createdAt: string;
}

export interface PushChallengeStatus {
	challengeId: string;
	status: string;
	loginContext?: string;
	numberMatching?: string;
	resolvedAt?: string;
}

export async function createPushChallenge(
	userId: string,
	loginContext?: string,
): Promise<PushChallengeResponse> {
	const res = await mfaPushChallengePost({
		loginContext: loginContext || 'login request',
	});
	return extractItem(res) as PushChallengeResponse;
}

export async function getPushChallengeStatus(challengeId: string): Promise<PushChallengeStatus> {
	const res = await mfaPushChallengeByChallenge(challengeId);
	return extractItem(res) as PushChallengeStatus;
}

export async function approvePushChallenge(
	challengeId: string,
	numberMatching?: string,
): Promise<boolean> {
	const res = await mfaPushApprovePost({
		challengeId: challengeId,
		numberMatching: numberMatching,
	});
	const item = extractItem(res) as { valid?: boolean } | undefined;
	return item?.valid === true;
}

export async function denyPushChallenge(
	challengeId: string,
	numberMatching?: string,
): Promise<boolean> {
	const res = await mfaPushDenyPost({
		challengeId: challengeId,
		numberMatching: numberMatching,
	});
	const item = extractItem(res) as { valid?: boolean } | undefined;
	return item?.valid === false;
}
