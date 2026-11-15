/**
 * 登录审批（Login Approval）— App 侧读写。
 *
 * 契约尚未进 `@autional/shared` 生成包，因此走统一 `apiClient`（同拦截器/信封语义：
 * 自动带 Bearer + X-Tenant-ID，自动解包 {code,message,data|items} 并 camelCase 化）。
 * 端点：
 *   GET  /identity/api/v1/auth/login-approval/pending
 *        → items[]: { code?, request_id, origin_ip, origin_ua, expires_in, created_at,
 *                     known_device, familiar_network, geo_city, requires_step_up }
 *   POST /identity/api/v1/auth/login-approval/by-code/:code/approve   （body 可选：{confirm_code}）
 *   POST /identity/api/v1/auth/login-approval/by-code/:code/deny      （无请求体）
 *   POST /identity/api/v1/auth/login-approval/:request_id/approve     （body 可选：{confirm_code}）
 *
 * step_up（ADR-025 P1-t1-2，高风险请求的「额外确认」门）：
 *   - pending 列表里 `requires_step_up=true` 的行**不下发 code**（键缺失），因为该行的码
 *     只能从**桌面屏幕**读取 —— 一旦经 API 下发，App 就能把同一个码原样回填，门形同虚设；
 *   - 因此这类行只能用 request_id 定位，批准时必须把用户**手输**的桌面码放进 `confirm_code`；
 *   - 缺码 / 错码都是 403（同一个错误码 61002201，靠 i18n_key / message 区分两种子情形），
 *     且 pending 不被消耗 —— 卡片要保留，让用户改码重试。
 *
 * 安全取向：审批码只是「指出是哪一条待审批请求」，判定权在服务端（按当前登录身份
 * 找自己名下的请求）。前端不缓存、不落盘、不跨账号共享。
 */

import { apiClient, extractApiError, extractList } from '@autional/shared';
import { semanticsOfError } from '@/lib/error-semantics';

const PENDING_PATH = '/identity/api/v1/auth/login-approval/pending';

function byCodePath(code: string, action: 'approve' | 'deny'): string {
	return `/identity/api/v1/auth/login-approval/by-code/${encodeURIComponent(code)}/${action}`;
}

/** step_up 专用入口（普通行同样可用）：按 request_id 定位。 */
function byRequestIdPath(requestId: string): string {
	return `/identity/api/v1/auth/login-approval/${encodeURIComponent(requestId)}/approve`;
}

/** 桌面码形状：服务端 `binding_code` 恒为 6 位数字（短链 /a/:code 同一形状）。 */
export const CONFIRM_CODE_PATTERN = /^\d{6}$/;

export interface PendingApproval {
	/**
	 * 6 位审批码（服务端生成，前端只展示/回传）。
	 *
	 * **仅普通行下发**：`requires_step_up=true` 的行服务端 `omitempty` → 键缺失，
	 * 该行的码只能从桌面屏幕读取（见文件头）。故这里是可选字段。
	 */
	code?: string;
	/**
	 * 审批请求 ID（服务端主键）。新契约下 pending 行恒有；**深链场景（推送 `data.code` 直达）
	 * 可能只有审批码而没有它** —— 此时提交退回 by-code + confirm_code（见 `approvePending`）。
	 */
	requestId?: string;
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
	/**
	 * 本条请求批准时是否要求额外确认（step_up，手输桌面屏幕上的 6 位码）。
	 *
	 * additive 字段（ADR-025 P1-t1-2）：`true` → 卡片改为渲染桌面码输入框（不渲染审批码）；
	 * `false` → 普通行，一键批准；**`undefined` → 老后端根本没有该字段**（能力探测点：
	 * 缺省即老契约，提交仍走 by-code 无 body，行为逐字不变）。
	 */
	requiresStepUp?: boolean;
}

/**
 * 卡片/列表的**稳定身份**：普通行 = 审批码，step_up 行（无码）= request_id。
 *
 * 用途：React key、`data-testid`、父级按条移除。step_up 行没有 code，若继续用 code
 * 当身份会得到 `undefined` 键（多条卡片同键、移除全灭）。
 */
export function approvalIdentity(item: PendingApproval): string {
	return (item.code || '').trim() || (item.requestId || '').trim();
}

/** 该条是否走 step_up（高风险额外确认）分支。 */
export function isStepUpApproval(item: PendingApproval | null | undefined): boolean {
	return item?.requiresStepUp === true;
}

/** 输入是否已满足桌面码形状（6 位数字）；未满足时批准/拒绝都不可点。 */
export function isValidConfirmCode(value: string | null | undefined): boolean {
	return CONFIRM_CODE_PATTERN.test((value || '').trim());
}

export async function listPendingApprovals(): Promise<PendingApproval[]> {
	const res = await apiClient.get(PENDING_PATH);
	const items = extractList<PendingApproval>(res);
	// step_up 行不下发 code（键缺失）。**不能**继续只按 `Boolean(item.code)` 过滤 ——
	// 那会把高风险请求从 App 里彻底抹掉（用户既看不到、也无从拒绝）。
	// 保留条件：有码（普通行）或「有 request_id 且明确要求 step_up」。
	return items.filter(
		(item) => Boolean(item?.code) || (isStepUpApproval(item) && Boolean(item?.requestId)),
	);
}

/** 批准（无请求体：审批码即是目标，服务端以自身记录为准）。老后端/普通行的既有路径。 */
export async function approveByCode(code: string): Promise<void> {
	await apiClient.post(byCodePath(code, 'approve'));
}

/**
 * 批准 + 桌面码回填（step_up 用）。
 *
 * 与 `approveByCode` 分开而不是加可选参数：既有调用点的签名/行为保持逐字不变
 * （约束：不改既有 API 封装签名，只新增函数）。
 */
export async function approveByCodeWithConfirmCode(code: string, confirmCode: string): Promise<void> {
	await apiClient.post(byCodePath(code, 'approve'), { confirm_code: confirmCode });
}

/** 按 request_id 批准（step_up 专用入口；普通行也可用，此时无需 confirm_code）。 */
export async function approveByRequestId(requestId: string, confirmCode?: string): Promise<void> {
	const body = confirmCode ? { confirm_code: confirmCode } : undefined;
	await apiClient.post(byRequestIdPath(requestId), body);
}

/**
 * 批准一条待审批请求 —— **入口选择集中在这里**（页面/卡片不再各自判断）。
 *
 * 规则（顺序即优先级）：
 *   1. `requires_step_up=true`：必须带桌面码走 by-request-id；若该条只有 code（深链场景 /
 *      推送 `data.code` 直达，拿不到 request_id），退回 by-code + confirm_code（老接口仍收该字段）。
 *   2. `requires_step_up=false`（新契约在位）：走 by-request-id，不带 confirm_code（服务端忽略）。
 *   3. `requires_step_up` 缺省（**老后端**，无该字段也没有 :request_id/approve 路由）：
 *      走 by-code 无 body —— 与改造前逐字相同，零回归。
 *   4. 兜底：只有 request_id 时走 by-request-id。
 */
export async function approvePending(item: PendingApproval, confirmCode?: string): Promise<void> {
	const code = (item.code || '').trim();
	const requestId = (item.requestId || '').trim();
	const confirm = (confirmCode || '').trim();
	const stepUp = isStepUpApproval(item);

	if (stepUp) {
		if (requestId) return approveByRequestId(requestId, confirm);
		if (code) return approveByCodeWithConfirmCode(code, confirm);
		throw new Error('login approval target missing');
	}

	if (item.requiresStepUp === false && requestId) {
		return approveByRequestId(requestId);
	}

	if (code) return approveByCode(code);
	if (requestId) return approveByRequestId(requestId, confirm);
	throw new Error('login approval target missing');
}

/** 拒绝（同上）。 */
export async function denyByCode(code: string): Promise<void> {
	await apiClient.post(byCodePath(code, 'deny'));
}

/**
 * 拒绝一条待审批请求。
 *
 * 为什么还需要单独一层：服务端只有 `by-code/:code/deny`（**没有** deny-by-request-id），
 * 而 step_up 行不下发 code —— 直接沿用 `denyByCode(item.code)` 会发出
 * `/by-code/undefined/deny`。step_up 行的卡片因此要求用户先把桌面码输进来，
 * 由用户输入的码充当「定位用的码」（服务端仍按当前登录身份校验归属，拒绝不需要 step_up）。
 */
export async function denyPending(item: PendingApproval, codeFromUser?: string): Promise<void> {
	const code = (item.code || '').trim() || (codeFromUser || '').trim();
	if (!code) throw new Error('login approval code unavailable for deny');
	await denyByCode(code);
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
 * step_up（桌面码确认）失败的**两种子情形**（ADR-025 P1-t1-2）。
 *
 * 服务端两种情况都用同一个错误码 61002201 + HTTP 403，**只能靠 i18n_key / message 区分**：
 *   - required：`error.login_approval_step_up_required`，message
 *     “login approval requires additional confirmation: enter the 6-digit code shown on the device”
 *   - mismatch：`error.login_approval_step_up_mismatch`，message
 *     “approval code mismatch, check the 6-digit code shown on the device”
 *
 * 判定优先级：语言中立的 `i18n_key`（新契约）→ 403 + message 正则（旧网关不转发 i18n_key 时兜底）。
 * 非 403 / 无关错误一律 null（交回 `classifyApprovalFailure` 处理，避免误吞其它失败）。
 */
export type StepUpFailure = 'step_up_required' | 'step_up_mismatch';

const STEP_UP_REQUIRED_KEY = 'error.login_approval_step_up_required';
const STEP_UP_MISMATCH_KEY = 'error.login_approval_step_up_mismatch';

/** 取响应体里的 i18n_key（拦截器深 camel 后为 i18nKey，两种都认）。 */
function i18nKeyOf(err: unknown): string {
	const data = (err as { response?: { data?: Record<string, unknown> } } | null | undefined)?.response
		?.data;
	const key = data?.i18n_key ?? data?.i18nKey;
	return typeof key === 'string' ? key : '';
}

export function classifyStepUpFailure(err: unknown): StepUpFailure | null {
	const key = i18nKeyOf(err);
	if (key === STEP_UP_REQUIRED_KEY) return 'step_up_required';
	if (key === STEP_UP_MISMATCH_KEY) return 'step_up_mismatch';

	const http = (err as { response?: { status?: number } } | null | undefined)?.response?.status;
	if (http !== 403) return null;

	const message = extractApiError(err, '').message || '';
	if (/additional confirmation/i.test(message)) return 'step_up_required';
	if (/mismatch/i.test(message)) return 'step_up_mismatch';
	return null;
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
