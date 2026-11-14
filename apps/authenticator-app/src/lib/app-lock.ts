/**
 * 应用锁：切后台超时 / 连续使用超时的自动重新验证。
 *
 * 阈值依据（详见 butler 研究记录）：
 * - NIST SP 800-63B-4 对 AAL2 只有「≤24h 总体 / ≤1h 空闲」的 SHOULD，无消费级 App 量化值；
 * - OWASP MASWE-0024 明确把「从后台恢复而不要求重认证」列为缺陷模式；
 * - 原生 TOTP 同行多为事件驱动（离开即锁/可配），密码管理器侧 1Password 默认 10min、Bitwarden 15min；
 * - 这里取 30s：约一个 TOTP 窗口，不打断「看码 → 切到别处粘贴」的主路径，又能拦住「放下手机走开」。
 */
import { useAuthenticatorStore } from './store';
import { clearSessionKeys } from './session-keys';
import { getDeviceKey } from './storage';

export const AUTO_LOCK_AFTER_MS = 30_000;
/** 连续解锁使用上限（NIST AAL2 ≤24h，这里取 AAL3 的 12h 更保守）。 */
export const ABSOLUTE_UNLOCK_MAX_MS = 12 * 60 * 60 * 1000;

export type LockReason = 'grace' | 'absolute' | 'manual';

let initialized = false;
let hiddenAt: number | null = null;
let unlockedAt: number | null = null;
/** >0 表示生物识别 ceremony 进行中（含系统弹窗），此期间不判定锁定 */
let ceremonyDepth = 0;

/** 生物识别 ceremony 期间抑制自动锁定，避免系统弹窗引发的 visibility 抖动导致自锁。 */
export function setCeremonyActive(active: boolean): void {
	ceremonyDepth = Math.max(0, ceremonyDepth + (active ? 1 : -1));
	if (ceremonyDepth === 0) hiddenAt = null;
}

/** 立即锁定保险库（清内存密钥 + 清账户缓存，密文保留在 localStorage）。 */
export function lockVault(_reason: LockReason = 'manual'): void {
	const state = useAuthenticatorStore.getState();
	if (!state.isUnlocked) return;
	clearSessionKeys();
	useAuthenticatorStore.setState({ isUnlocked: false, accounts: [] });
}

function maybeLock(): void {
	if (ceremonyDepth > 0) return;
	const state = useAuthenticatorStore.getState();
	if (!state.isUnlocked) {
		hiddenAt = null;
		return;
	}
	const now = Date.now();
	if (unlockedAt !== null && now - unlockedAt >= ABSOLUTE_UNLOCK_MAX_MS) {
		hiddenAt = null;
		lockVault('absolute');
		return;
	}
	if (hiddenAt !== null && now - hiddenAt >= AUTO_LOCK_AFTER_MS) {
		hiddenAt = null;
		lockVault('grace');
		return;
	}
	hiddenAt = null;
}

/** 挂载一次即可（重复调用幂等）。返回卸载函数（测试用）。 */
export function initAppLock(): () => void {
	if (initialized) return () => {};
	initialized = true;

	// 解锁时间戳：从 unlocked 的 false→true 边缘记录
	const unsubscribe = useAuthenticatorStore.subscribe((state, prev) => {
		if (state.isUnlocked && !prev.isUnlocked) unlockedAt = Date.now();
		if (!state.isUnlocked) unlockedAt = null;
	});
	if (useAuthenticatorStore.getState().isUnlocked) unlockedAt = Date.now();

	const onVisibility = () => {
		if (document.visibilityState === 'hidden') {
			if (ceremonyDepth === 0) hiddenAt = Date.now();
			return;
		}
		maybeLock();
	};
	// bfcache 恢复：模块状态仍在，必须重新判定（否则恢复后仍是已解锁）
	const onPageShow = (e: PageTransitionEvent) => {
		if (!e.persisted) return;
		// 防御：界面已解锁但内存密钥已被清（历史 pagehide 行为或其它路径）→ 直接锁，
		// 否则会出现「看着能操作、落盘必失败」的矛盾态。
		if (useAuthenticatorStore.getState().isUnlocked && !getDeviceKey()) {
			lockVault('grace');
			return;
		}
		maybeLock();
	};
	const onPageHide = () => {
		if (ceremonyDepth === 0) hiddenAt = Date.now();
	};
	// 兜底：部分环境 visibilitychange 不稳定，focus 时再判一次
	const onFocus = () => {
		if (document.visibilityState === 'visible') maybeLock();
	};

	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('pageshow', onPageShow);
	window.addEventListener('pagehide', onPageHide);
	window.addEventListener('focus', onFocus);

	return () => {
		unsubscribe();
		document.removeEventListener('visibilitychange', onVisibility);
		window.removeEventListener('pageshow', onPageShow);
		window.removeEventListener('pagehide', onPageHide);
		window.removeEventListener('focus', onFocus);
		initialized = false;
	};
}
