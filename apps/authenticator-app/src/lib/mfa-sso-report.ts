/**
 * 「本机验证器登录」（MFA SSO）失败的可诊断性。
 *
 * 为什么需要它：整条路径刻意**静默回落**（票据拿不到只是"多输一次密码"，
 * 不该弹错误），但静默到连控制台都不留痕，会让「怎么点都登不进去」在生产上
 * 完全无法排查 —— P0 事故就是这样被藏住的（自动续跑失败后永久停在登录按钮，
 * 没有任何日志能看出来它到底跑没跑）。
 *
 * 两条口径：
 * - `console.warn` 一行摘要（保留已有的 `[mfa-sso]` 前缀便于过滤）；
 * - 派发 `autional:mfa-sso` 自定义事件（detail: `{ phase, reason }`）供埋点，
 *   **不**依赖任何监控 SDK 也能被外部监听。
 *
 * 安全红线：**绝不**输出 secret / proof / ticket —— 也不允许它们"顺手混进"
 * 错误消息里被带出去（`describeMfaFailure` 先脱敏再截断）。
 */

/** 埋点事件名（后端无关，纯前端自定义事件）。 */
export const MFA_SSO_EVENT = 'autional:mfa-sso';

/** 失败发生在哪一段。 */
export type MfaSsoPhase =
	/** 回跳后自动续跑（`initiateOAuthLogin`）发起失败 / 抛错。 */
	| 'auto-continue'
	/** 本机票据换取失败（proof/begin/ticket 任一环节）。 */
	| 'ticket-exchange';

/** 每个 phase 对应的可读摘要（`console.warn('[mfa-sso] …', reason)`）。 */
const PHASE_LABEL: Record<MfaSsoPhase, string> = {
	'auto-continue': 'auto continue failed',
	'ticket-exchange': 'ticket exchange failed',
};

/** 敏感值脱敏：`secret=…` / `proof=…` / `ticket=…` 一律替换为 `<redacted>`。 */
// 注意：字符类里**不能**出现单/双引号 —— 本仓 i18n-guard 的注释剥离器不认正则字面量，
// 一个落单的引号会让其后所有注释被当成字符串、中文注释被误判成文案泄漏。
const SENSITIVE_PAIR = /(secret|proof|ticket)\s*[=:]\s*[^\s,;}]+/gi;

/** 原因摘要长度上限：错误消息可能很长（含整段响应体），这里只要够定位。 */
const REASON_MAX = 200;

/**
 * 把任意抛出物转成可安全输出的短摘要。
 * 非字符串原因（对象/undefined）不会 JSON.stringify（那可能把整段 payload 带出来）。
 */
export function describeMfaFailure(reason: unknown): string {
	let raw: string;
	if (reason instanceof Error) {
		raw = reason.name ? `${reason.name}: ${reason.message}` : reason.message;
	} else if (typeof reason === 'string') {
		raw = reason;
	} else {
		// 不 dump 对象：只留类型，避免把请求/响应体（含 proof/ticket）打进日志。
		raw = Object.prototype.toString.call(reason);
	}
	return raw.replace(SENSITIVE_PAIR, '$1=<redacted>').slice(0, REASON_MAX);
}

/**
 * 记录一次 MFA SSO 失败：控制台一行 + 埋点事件。
 * 永不抛出（日志失败不能影响登录回落）。
 */
export function reportMfaSsoFailure(phase: MfaSsoPhase, reason: unknown): void {
	const detail = describeMfaFailure(reason);
	try {
		console.warn(`[mfa-sso] ${PHASE_LABEL[phase]}`, detail);
	} catch {
		/* 控制台不可用（极少数沙箱）：忽略，不能影响登录流程 */
	}
	try {
		window.dispatchEvent(
			new CustomEvent(MFA_SSO_EVENT, { detail: { phase, reason: detail } }),
		);
	} catch {
		/* 非浏览器环境 / 事件被禁用：同样忽略 */
	}
}
