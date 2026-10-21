/**
 * Web Push 载荷 → 通知规格（纯函数，SW 与单测共用）。
 *
 * 服务端载荷：{ title, body, data }（communication webpush provider）。
 * MFA 推送的 data 含 challenge_id / number_matching / login_context / expires_at；
 * login_context 属登录上下文，不上锁屏——MFA 类型一律改用固定文案。
 */

export interface PushMessage {
	title: string;
	body: string;
	data: Record<string, unknown>;
}

export interface PushNotificationSpec {
	title: string;
	body: string;
	tag?: string;
	url: string;
}

const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 200;
const MFA_PUSH_TYPE = 'mfa_push';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 服务端 number_matching 为 varchar(4) 的 2 位数字。 */
const NUMBER_MATCHING_PATTERN = /^\d{1,6}$/;

const COPY = {
	zh: {
		mfaTitle: '登录审批请求',
		mfaBody: (number: string) => `匹配数字 ${number}，点击查看详情`,
		mfaBodyNoNumber: '点击查看并处理新的登录请求',
		genericTitle: '登录审批请求',
		genericBody: '点击查看详情',
	},
	en: {
		mfaTitle: 'Login approval request',
		mfaBody: (number: string) => `Match number ${number} — tap to review`,
		mfaBodyNoNumber: 'Tap to review a new sign-in request',
		genericTitle: 'Login approval request',
		genericBody: 'Tap to review',
	},
};

function copyFor(language: string) {
	return language.toLowerCase().startsWith('zh') ? COPY.zh : COPY.en;
}

function clip(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function readString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/** 解析失败返回 null：调用方仍会展示通用通知，避免推送静默丢失。 */
export function parsePushMessage(raw: string | null | undefined): PushMessage | null {
	if (!raw) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
	const record = parsed as Record<string, unknown>;
	const data =
		typeof record.data === 'object' && record.data !== null && !Array.isArray(record.data)
			? (record.data as Record<string, unknown>)
			: {};
	return {
		title: clip(readString(record.title), MAX_TITLE_LENGTH),
		body: clip(readString(record.body), MAX_BODY_LENGTH),
		data,
	};
}

function readNumberMatching(value: unknown): string {
	const text = typeof value === 'number' ? String(value) : readString(value);
	return NUMBER_MATCHING_PATTERN.test(text) ? text : '';
}

/** 深链只接受站内相对路径；挑战 ID 必须是 UUID，其余一律回落首页。 */
function buildMfaUrl(data: Record<string, unknown>): string {
	const challengeId = readString(data.challenge_id);
	if (!UUID_PATTERN.test(challengeId)) return '/';
	const params = new URLSearchParams({ challengeId });
	const numberMatching = readNumberMatching(data.number_matching);
	if (numberMatching) params.set('numberMatching', numberMatching);
	return `/push-approve?${params.toString()}`;
}

export function buildPushNotification(
	message: PushMessage | null,
	language: string,
): PushNotificationSpec {
	const copy = copyFor(language);
	if (!message) {
		return { title: copy.genericTitle, body: copy.genericBody, url: '/' };
	}
	const data = message.data;
	if (data.type === MFA_PUSH_TYPE) {
		const numberMatching = readNumberMatching(data.number_matching);
		const challengeId = readString(data.challenge_id);
		return {
			title: copy.mfaTitle,
			body: numberMatching ? copy.mfaBody(numberMatching) : copy.mfaBodyNoNumber,
			tag: UUID_PATTERN.test(challengeId) ? `mfa-push:${challengeId}` : undefined,
			url: buildMfaUrl(data),
		};
	}
	return {
		title: message.title || copy.genericTitle,
		body: message.body || copy.genericBody,
		url: '/',
	};
}

/** notification.data 由本 SW 写入；仍做一次站内校验，拒绝 //host 与外部协议。 */
export function resolveClickUrl(data: unknown): string {
	if (typeof data !== 'object' || data === null) return '/';
	const url = (data as Record<string, unknown>).url;
	if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) return url;
	return '/';
}
