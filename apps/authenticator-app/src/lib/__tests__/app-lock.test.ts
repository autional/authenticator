import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TotpAccount } from '../store';

/**
 * 应用锁回归锁：
 * ① 切后台 ≥30s 回来必须重新验证（isUnlocked=false + accounts=[] + clearSessionKeys）；
 * ② 切后台 <30s 不打断（看码 → 切走粘贴的主路径）；
 * ③ 生物识别 ceremony 期间不判定（系统弹窗的 visibility 抖动会自锁循环）；
 * ④ 连续解锁 ≥12h 一次判定即锁（绝对上限）。
 */

vi.mock('../session-keys', () => ({ clearSessionKeys: vi.fn() }));
// store 的自动落盘订阅会异步 import('./storage')：mock 掉，避免测试里真跑 IndexedDB/localStorage 加密。
vi.mock('../storage', () => ({
	clearDeviceKeyCache: vi.fn(),
	saveAccounts: vi.fn().mockResolvedValue(undefined),
	getDeviceKey: vi.fn(() => ({}) as CryptoKey),
}));

const AUTO_LOCK_AFTER_MS = 30_000;
const ABSOLUTE_UNLOCK_MAX_MS = 12 * 60 * 60 * 1000;

const account = (id: string) =>
	({
		id,
		name: id,
		username: 'user',
		secret: 'JBSWY3DPEHPK3PXP',
		type: 'totp',
		algorithm: 'SHA1',
		digits: 6,
		period: 30,
		createdAt: 0,
	}) as TotpAccount;

let now = 1_700_000_000_000;
let store: typeof import('../store').useAuthenticatorStore;
let appLock: typeof import('../app-lock');
let clearSessionKeys: ReturnType<typeof vi.fn>;
let getDeviceKey: ReturnType<typeof vi.fn>;
let cleanup: (() => void) | null = null;

function setVisibility(state: 'visible' | 'hidden') {
	Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
	document.dispatchEvent(new Event('visibilitychange'));
}

/** 模拟 bfcache 恢复（pageshow + persisted=true）。 */
function dispatchPageShow(persisted: boolean) {
	const event = new Event('pageshow');
	Object.defineProperty(event, 'persisted', { configurable: true, value: persisted });
	window.dispatchEvent(event);
}

beforeEach(async () => {
	// app-lock 的 initialized 是模块级标志：每个用例重置模块图，重新 import
	vi.resetModules();
	now = 1_700_000_000_000;
	vi.spyOn(Date, 'now').mockImplementation(() => now);

	appLock = await import('../app-lock');
	store = (await import('../store')).useAuthenticatorStore;
	clearSessionKeys = vi.mocked((await import('../session-keys')).clearSessionKeys);
	getDeviceKey = vi.mocked((await import('../storage')).getDeviceKey);
	getDeviceKey.mockReturnValue({} as CryptoKey);

	store.setState({ isUnlocked: false, accounts: [], isLoading: false });
	cleanup = appLock.initAppLock();
});

afterEach(() => {
	cleanup?.();
	cleanup = null;
	vi.restoreAllMocks();
});

describe('应用锁：自动重新验证', () => {
	it('切后台 31s 回来 → 锁定并清空账户、清会话密钥', () => {
		store.setState({ isUnlocked: true, accounts: [account('acc_1')] });

		now += 1_000;
		setVisibility('hidden');
		now += AUTO_LOCK_AFTER_MS + 1_000;
		setVisibility('visible');

		const state = store.getState();
		expect(state.isUnlocked).toBe(false);
		expect(state.accounts).toEqual([]);
		expect(clearSessionKeys).toHaveBeenCalledTimes(1);
	});

	it('切后台 5s 回来 → 保持解锁（不打断看码→粘贴）', () => {
		store.setState({ isUnlocked: true, accounts: [account('acc_1')] });

		now += 1_000;
		setVisibility('hidden');
		now += 5_000;
		setVisibility('visible');

		const state = store.getState();
		expect(state.isUnlocked).toBe(true);
		expect(state.accounts).toHaveLength(1);
		expect(clearSessionKeys).not.toHaveBeenCalled();
	});

	it('生物识别 ceremony 期间切后台 60s 不锁；ceremony 结束后再超时才锁', () => {
		store.setState({ isUnlocked: true, accounts: [account('acc_1')] });

		appLock.setCeremonyActive(true);
		setVisibility('hidden');
		now += AUTO_LOCK_AFTER_MS * 2;
		setVisibility('visible');
		expect(store.getState().isUnlocked).toBe(true);
		expect(clearSessionKeys).not.toHaveBeenCalled();

		appLock.setCeremonyActive(false);

		setVisibility('hidden');
		now += AUTO_LOCK_AFTER_MS + 1_000;
		setVisibility('visible');
		expect(store.getState().isUnlocked).toBe(false);
		expect(clearSessionKeys).toHaveBeenCalledTimes(1);
	});

	it('连续解锁 ≥12h → 一次 visibility 变化即锁（绝对上限）', () => {
		store.setState({ isUnlocked: true, accounts: [account('acc_1')] });

		now += ABSOLUTE_UNLOCK_MAX_MS + 1_000;
		setVisibility('hidden');
		setVisibility('visible');

		const state = store.getState();
		expect(state.isUnlocked).toBe(false);
		expect(state.accounts).toEqual([]);
		expect(clearSessionKeys).toHaveBeenCalledTimes(1);
	});

	it('bfcache 恢复：已解锁但内存密钥已不存在 → 立即锁定', () => {
		store.setState({ isUnlocked: true, accounts: [account('acc_1')] });
		// 历史 pagehide 行为等路径可能已清掉内存密钥，但 store 仍是「已解锁」
		getDeviceKey.mockReturnValue(null);

		dispatchPageShow(true);

		const state = store.getState();
		expect(state.isUnlocked).toBe(false);
		expect(state.accounts).toEqual([]);
		expect(clearSessionKeys).toHaveBeenCalledTimes(1);
	});

	it('bfcache 恢复：内存密钥仍在且在宽限期内 → 保持解锁', () => {
		store.setState({ isUnlocked: true, accounts: [account('acc_1')] });

		dispatchPageShow(true);

		expect(store.getState().isUnlocked).toBe(true);
		expect(clearSessionKeys).not.toHaveBeenCalled();
	});
});
