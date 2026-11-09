/**
 * 扫码登录审批的待处理票据（sessionStorage）。
 *
 * 场景：未登录用户扫到登录码 → 需要先登录；OAuth 是整页跳转，React 状态会丢。
 * 这份票据让用户登录回跳后能自动续上 /login-approve，避免「扫了没反应」。
 *
 * 约束：
 * - 只放 sessionStorage（同标签页、关页即失效），不做跨设备同步；
 * - 取出即删（一次性）；
 * - 5 分钟过期，与服务端 QR 会话 300s 有效期对齐。
 */

const KEY = 'authenticator.pending-approval.v1';
const TTL_MS = 5 * 60 * 1000;

export interface PendingApprovalChallenge {
	token: string;
	numberMatching?: string;
}

interface StoredPendingApproval extends PendingApprovalChallenge {
	at: number;
}

function storage(): Storage | null {
	try {
		return typeof window !== 'undefined' ? window.sessionStorage : null;
	} catch {
		return null;
	}
}

export function savePendingApproval(challenge: PendingApprovalChallenge): void {
	const store = storage();
	if (!store) return;
	try {
		const payload: StoredPendingApproval = { ...challenge, at: Date.now() };
		store.setItem(KEY, JSON.stringify(payload));
	} catch {
		// 隐私模式 / 配额满：静默降级（用户仍可在登录后重新扫码）
	}
}

/** 读取并清除（一次性）。过期、损坏、无 token 一律返回 null。 */
export function takePendingApproval(): PendingApprovalChallenge | null {
	const store = storage();
	if (!store) return null;
	try {
		const raw = store.getItem(KEY);
		if (!raw) return null;
		store.removeItem(KEY);
		const parsed = JSON.parse(raw) as StoredPendingApproval;
		if (!parsed?.token || typeof parsed.at !== 'number') return null;
		if (Date.now() - parsed.at > TTL_MS) return null;
		return { token: parsed.token, numberMatching: parsed.numberMatching };
	} catch {
		return null;
	}
}

export function clearPendingApproval(): void {
	const store = storage();
	if (!store) return;
	try {
		store.removeItem(KEY);
	} catch {
		// ignore
	}
}
