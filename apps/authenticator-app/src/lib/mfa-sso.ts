/**
 * 「用本机验证器登录」（MFA SSO）。
 *
 * 场景：用户已在 auth 站点有会话，但本 App 还没登录。让用户手输密码是最差路径 ——
 * 本机保险库里本来就有 TOTP secret，可以用它证明「这台设备 + 这个账户」。
 *
 * 协议（identity 已上线，契约见后端 auth/mfa proof 与 ticket）：
 *   POST /identity/api/v1/auth/mfa/proof/begin  { identity, tenant }
 *        → { challenge, expires_in }
 *   proof = base64(HMAC-SHA256(key = base32Decode(secret), msg = utf8(challenge)))
 *   POST /identity/api/v1/auth/mfa/ticket       { identity, tenant, challenge, proof }
 *        → { ticket: "<id>.<secret>", expires_in }
 *
 * 安全性取向：
 * - secret / proof / ticket **只在内存里过一遍**：不写日志、不写 localStorage /
 *   sessionStorage、不写 Cookie；ticket 只出现在跳转 URL 的 fragment（不下发到服务端
 *   日志、不进 Referer）。
 * - 任何一步失败都由调用方回落现有手动登录（OAuth），这里只抛错，不吞、不提示细节。
 */

import { apiClient, buildLoginUrl, extractItem } from '@autional/shared';
import type { TotpAccount } from './store';
import { base32Decode } from './totp';
import { arrayBufferToBase64 } from './crypto';
import { buildSignInTarget } from './use-sign-in';

/** 回跳地址上的「本机验证器登录」标记（`?mfa_sso=1`），用于回到 App 后静默续跑登录。 */
export const MFA_SSO_PARAM = 'mfa_sso';

export const PROOF_BEGIN_PATH = '/identity/api/v1/auth/mfa/proof/begin';
export const TICKET_PATH = '/identity/api/v1/auth/mfa/ticket';

export interface MfaProofChallenge {
	challenge: string;
	expiresIn: number;
}

export interface MfaTicketResult {
	ticket: string;
	expiresIn: number;
}

/** 本机可用来换票的账户：有 username（身份）且有 secret（密钥）。 */
export function usableMfaAccounts(accounts: readonly TotpAccount[]): TotpAccount[] {
	return accounts.filter(
		(account) => Boolean(account.username?.trim()) && Boolean(account.secret?.trim()),
	);
}

/**
 * proof = base64(HMAC-SHA256(base32Decode(secret), utf8(challenge)))。
 * 只做「一次签名」：不落密钥对象、不缓存 CryptoKey（换一次票即用完）。
 */
export async function computeMfaProof(secret: string, challenge: string): Promise<string> {
	const keyBytes = base32Decode(secret);
	if (keyBytes.length === 0) throw new Error('mfa_sso_empty_secret');
	const key = await crypto.subtle.importKey(
		'raw',
		keyBytes as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const signature = await crypto.subtle.sign(
		'HMAC',
		key,
		new TextEncoder().encode(challenge) as BufferSource,
	);
	return arrayBufferToBase64(new Uint8Array(signature));
}

/** step 1：向 identity 申请一次挑战（匿名接口，不带任何 token 语义）。 */
export async function beginMfaProof(identity: string, tenant: string): Promise<MfaProofChallenge> {
	const res = await apiClient.post(PROOF_BEGIN_PATH, { identity, tenant });
	const data = extractItem<{ challenge?: unknown; expiresIn?: unknown }>(res);
	const challenge = typeof data?.challenge === 'string' ? data.challenge : '';
	if (!challenge) throw new Error('mfa_sso_begin_invalid_response');
	return { challenge, expiresIn: Number(data?.expiresIn) || 0 };
}

/** step 3：用 proof 换一次性登录票据。 */
export async function exchangeMfaTicket(input: {
	identity: string;
	tenant: string;
	challenge: string;
	proof: string;
}): Promise<MfaTicketResult> {
	const res = await apiClient.post(TICKET_PATH, input);
	const data = extractItem<{ ticket?: unknown; expiresIn?: unknown }>(res);
	const ticket = typeof data?.ticket === 'string' ? data.ticket : '';
	if (!ticket) throw new Error('mfa_sso_ticket_invalid_response');
	return { ticket, expiresIn: Number(data?.expiresIn) || 0 };
}

/**
 * begin → 本机算 proof → 换 ticket。
 * 返回的 ticket 由调用方立刻拼进跳转 URL，不保留引用。
 */
export async function requestMfaTicket(
	account: Pick<TotpAccount, 'username' | 'secret'>,
	tenant: string,
): Promise<MfaTicketResult> {
	const identity = account.username.trim();
	const begin = await beginMfaProof(identity, tenant);
	const proof = await computeMfaProof(account.secret, begin.challenge);
	return exchangeMfaTicket({
		identity,
		tenant,
		challenge: begin.challenge,
		proof,
	});
}

/**
 * 给回跳地址打「本机验证器登录」标记。
 * 用 URL API 拼接（不改 path / 不吃掉既有 query / hash），避免手写字符串拼错 `?`/`&`。
 */
export function withMfaSsoFlag(target: string): string {
	const url = new URL(target, window.location.origin);
	url.searchParams.set(MFA_SSO_PARAM, '1');
	return url.toString();
}

/**
 * auth 登录页 URL：`buildLoginUrl(带标记的回跳地址)` + `#mfa_ticket=…&identity=…`。
 * ticket 只进 fragment —— 不随请求发往服务端，也不会出现在 Referer 里。
 */
export function buildMfaLoginUrl(
	target: string,
	slug: string,
	ticket: string,
	identity: string,
): string {
	const base = buildLoginUrl(withMfaSsoFlag(target), false, slug) || '/';
	const fragment = `mfa_ticket=${encodeURIComponent(ticket)}&identity=${encodeURIComponent(identity)}`;
	return `${base}#${fragment}`;
}

/**
 * 整段流程的 app 侧唯一入口：返回「可以直接 location.assign 的登录页 URL」。
 * 抛错 = 本次「用本机验证器登录」不可用（网络 / 未开启 MFA / 挑战过期 / 密钥损坏），
 * 调用方据此回落现有手动登录。
 */
export async function startMfaSsoLogin(
	account: Pick<TotpAccount, 'username' | 'secret'>,
	tenant: string,
): Promise<string> {
	const normalized = tenant.trim().toLowerCase();
	if (!normalized) throw new Error('mfa_sso_missing_tenant');
	const identity = account.username.trim();
	if (!identity) throw new Error('mfa_sso_missing_identity');
	const { ticket } = await requestMfaTicket({ username: identity, secret: account.secret }, normalized);
	return buildMfaLoginUrl(buildSignInTarget(normalized), normalized, ticket, identity);
}

/**
 * 整页跳转到登录页 —— 本流程唯一的 navigation 副作用。
 * 单点收口：组件只调它，测试可整体替换（jsdom 的 location.assign 不可打桩）。
 */
export function navigateToLoginPage(url: string): void {
	window.location.assign(url);
}

/** 当前 search 是否带「本机验证器登录」标记。 */
export function hasMfaSsoFlag(search: string): boolean {
	try {
		return new URLSearchParams(search).get(MFA_SSO_PARAM) === '1';
	} catch {
		return false;
	}
}

/** 去掉标记后的 search（只剩标记时返回空串，不留裸 `?`）。 */
export function stripMfaSsoFlag(search: string): string {
	const params = new URLSearchParams(search);
	params.delete(MFA_SSO_PARAM);
	const qs = params.toString();
	return qs ? `?${qs}` : '';
}
