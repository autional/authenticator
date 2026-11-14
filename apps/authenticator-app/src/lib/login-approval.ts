/**
 * 登录审批（Login Approval）— App 侧读写。
 *
 * 契约尚未进 `@autional/shared` 生成包，因此走统一 `apiClient`（同拦截器/信封语义：
 * 自动带 Bearer + X-Tenant-ID，自动解包 {code,message,data|items} 并 camelCase 化）。
 * 端点：
 *   GET  /identity/api/v1/auth/login-approval/pending
 *        → items[]: { code, request_id, origin_ip, origin_ua, expires_in, created_at,
 *                     known_device, familiar_network, geo_city }
 *   POST /identity/api/v1/auth/login-approval/by-code/:code/approve   （无请求体）
 *   POST /identity/api/v1/auth/login-approval/by-code/:code/deny      （无请求体）
 *
 * 安全取向：审批码只是「指出是哪一条待审批请求」，判定权在服务端（按当前登录身份
 * 找自己名下的请求）。前端不缓存、不落盘、不跨账号共享。
 */

import { apiClient, extractList } from '@autional/shared';
import { semanticsOfError } from '@/lib/error-semantics';

const PENDING_PATH = '/identity/api/v1/auth/login-approval/pending';

function byCodePath(code: string, action: 'approve' | 'deny'): string {
	return `/identity/api/v1/auth/login-approval/by-code/${encodeURIComponent(code)}/${action}`;
}

export interface PendingApproval {
	/** 6 位审批码（服务端生成，前端只展示/回传） */
	code: string;
	requestId: string;
	originIp?: string;
	originUa?: string;
	/** 剩余有效秒数（服务端按签发时刻算好，前端据此本地倒计时） */
	expiresIn: number;
	createdAt?: string;
	/**
	 * 该设备此前是否登录过：`true` 常用设备 / `false` 首次见到 / `null` 服务端无法判断。
	 * 响应经拦截器 camelCase 化（`known_device` → `knownDevice`）。
	 */
	knownDevice?: boolean | null;
	/**
	 * 是否与该用户近期登录网络同段：`true` 常用网络 / `false` 新网络 / `null` 无法判断。
	 * 响应经拦截器 camelCase 化（`familiar_network` → `familiarNetwork`）。
	 */
	familiarNetwork?: boolean | null;
	/**
	 * 发起 IP 的**离线**城市解析（服务端 ip2region，如「广东 深圳」），只用于展示。
	 * 响应经拦截器 camelCase 化（`geo_city` → `geoCity`）；空串/缺失 = 无法解析（私网 IP、
	 * 数据文件缺失或能力关闭）→ 前端不渲染该行，不显示「未知」也不占位。
	 */
	geoCity?: string;
}

export async function listPendingApprovals(): Promise<PendingApproval[]> {
	const res = await apiClient.get(PENDING_PATH);
	const items = extractList<PendingApproval>(res);
	return items.filter((item) => Boolean(item?.code));
}

/** 批准（无请求体：审批码即是目标，服务端以自身记录为准）。 */
export async function approveByCode(code: string): Promise<void> {
	await apiClient.post(byCodePath(code, 'approve'));
}

/** 拒绝（同上）。 */
export async function denyByCode(code: string): Promise<void> {
	await apiClient.post(byCodePath(code, 'deny'));
}

/**
 * 审批动作失败的**语义归类**（409 / 404 与其它错误必须分开处理）。
 *
 * 用词无关码字面量：判定走 error-semantics 契约（`uiObservation`），
 * 只在契约未收录该码（旧后端 / 新码先发前端）时按 HTTP 状态兜底：
 *   - 409 conflict   → `61000903`「该请求已被处理或替代」（并发败者 / 已被别处处理 / 被新请求替代）
 *   - 404 not_found  → `61000901`「已失效或不属于当前账号」
 *   - other          → 走既有 extractApiError 文案，行为不变
 */
export type ApprovalFailure = 'conflict' | 'not_found' | 'other';

export function classifyApprovalFailure(err: unknown): ApprovalFailure {
	const http = (err as { response?: { status?: number } } | null | undefined)?.response?.status;
	const observation = semanticsOfError(err)?.uiObservation;
	if (observation === 'conflict') return 'conflict';
	if (observation === 'not_found_page') {
		// 契约把 404（不存在）与 410（已过期）同归 not_found_page。
		// 这里只把 404 归为 not_found：410 保持既有「按接口原文提示 + 卡片留存」的表现，不改过期分支。
		return http === 410 ? 'other' : 'not_found';
	}
	// 兜底：契约未命中时只认 HTTP 状态（与页面既有 429 判定同口径，不猜业务码）
	if (http === 409) return 'conflict';
	if (http === 404) return 'not_found';
	return 'other';
}

/**
 * IP 打码：IPv4 保留前 3 段（203.0.113.45 → 203.0.113.*）；
 * IPv6 保留前 3 组。无法识别形状时只保留首段，宁可少露。
 */
export function maskIp(ip?: string): string {
	const value = (ip || '').trim();
	if (!value) return '';
	if (value.includes(':')) {
		const groups = value.split(':').filter(Boolean);
		return groups.length > 3 ? `${groups.slice(0, 3).join(':')}:*` : `${groups[0] || ''}:*`;
	}
	const octets = value.split('.');
	if (octets.length === 4) return `${octets.slice(0, 3).join('.')}.*`;
	return `${value.split('.')[0]}.*`;
}

/** UA 截断：只保留可识别的前缀，避免长 UA 撑破卡片。 */
export function truncateUa(ua?: string, max = 48): string {
	const value = (ua || '').trim();
	if (!value) return '';
	if (value.length <= max) return value;
	return `${value.slice(0, max)}…`;
}

/** 剩余时间展示：mm:ss（超过 1 小时回落 hh:mm:ss）。 */
export function formatRemaining(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const pad = (n: number) => String(n).padStart(2, '0');
	return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
