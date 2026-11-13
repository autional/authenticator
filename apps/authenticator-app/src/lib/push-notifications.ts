/**
 * 后台审批通知（Web Push）—— 设置页开关的唯一状态机与副作用入口。
 *
 * 产品口径（2026-11-13）：**SSE 优先**。前台提醒默认就有（App.tsx 全站唯一通知流 +
 * `autional:notification` 广播），无需任何设置。Web Push 只是**可选的补充** —— 锁屏或
 * 应用切到后台时 SSE 收不到（浏览器会挂起长连接），此时由推送叫醒设备。
 * 因此开关**默认关闭**，且只在用户点击时请求权限（绝不自动弹权限框）。
 *
 * 状态机（getPushState）：
 *   unsupported     无 PushManager / Notification / ServiceWorker（老浏览器、非安全上下文）
 *   ios-not-installed  iOS Safari 且非「添加到主屏幕」的独立窗口 —— iOS 只允许 standalone 收推送
 *   denied          Notification.permission === 'denied'（只能在系统设置里改）
 *   subscribed      权限已授予，且本机 endpoint 在服务端订阅表里
 *   unsubscribed    其余情况（含从未开启）
 *
 * 「本机 endpoint」来源有两处，按可靠性取并集：
 *   ① localStorage：上次 enablePush 成功后写入（仅在服务端登记成功后写，用于关闭时精确解绑）；
 *   ② 浏览器 PushManager 的当前订阅（换标签页/清过 localStorage 但仍订阅着的场景）。
 *
 * 失败语义：enable/disable 失败一律抛 PushNotificationError（带 code），调用方据此给出
 * 可读错误并**保持开关状态不变** —— 不假装成功，也不擅自清本地记录。
 */

import {
	getPushSubscriptions,
	getVapidPublicKey,
	registerPushSubscription,
	subscribeBrowserPush,
	unregisterPushSubscription,
	unsubscribeBrowserPush,
} from './push';

export type PushNotificationState =
	| 'unsupported'
	| 'ios-not-installed'
	| 'denied'
	| 'subscribed'
	| 'unsubscribed';

export type PushNotificationErrorCode =
	| 'unsupported'
	| 'ios-not-installed'
	| 'permission-denied'
	| 'vapid-failed'
	| 'subscribe-failed'
	| 'register-failed'
	| 'unbind-failed';

/** 失败分类（code 稳定，文案交给 i18n）。 */
export class PushNotificationError extends Error {
	readonly code: PushNotificationErrorCode;

	constructor(code: PushNotificationErrorCode, message?: string) {
		super(message ?? code);
		this.name = 'PushNotificationError';
		this.code = code;
	}
}

/** 本机 endpoint（仅本机可见，用于关闭时精确解绑；不含任何用户标识）。 */
export const PUSH_ENDPOINT_STORAGE_KEY = 'authenticator-app:push-endpoint';

/** 可用的三种禁用态：开关置灰 + 各自的解释文案。 */
export const BLOCKED_PUSH_STATES: readonly PushNotificationState[] = [
	'unsupported',
	'ios-not-installed',
	'denied',
];

export function isPushBlocked(state: PushNotificationState): boolean {
	return BLOCKED_PUSH_STATES.includes(state);
}

export function isPushSupported(): boolean {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
	return (
		typeof Notification !== 'undefined' &&
		'serviceWorker' in navigator &&
		'PushManager' in window
	);
}

/**
 * iOS 上只有「添加到主屏幕」后的 standalone 窗口能收 Web Push（iOS 16.4+）。
 * 在 Safari 标签页里订阅只会永远静默失败 —— 所以这一态必须前置拦住并解释清楚。
 */
export function isIosWithoutStandalone(): boolean {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent || '';
	const iPadAsMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
	if (!/iPad|iPhone|iPod/.test(ua) && !iPadAsMac) return false;

	if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
		try {
			if (window.matchMedia('(display-mode: standalone)').matches) return false;
		} catch {
			/* matchMedia 不可用 → 继续看 navigator.standalone */
		}
	}
	// iOS Safari 的非标准字段：standalone === true 表示从主屏幕启动
	const legacyStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
	return legacyStandalone !== true;
}

export function readStoredPushEndpoint(): string {
	try {
		return window.localStorage.getItem(PUSH_ENDPOINT_STORAGE_KEY) ?? '';
	} catch {
		return '';
	}
}

function writeStoredPushEndpoint(endpoint: string): void {
	try {
		window.localStorage.setItem(PUSH_ENDPOINT_STORAGE_KEY, endpoint);
	} catch {
		/* 隐私模式/配额满：功能仍可用，只是关闭时少一条精确解绑线索 */
	}
}

function clearStoredPushEndpoint(): void {
	try {
		window.localStorage.removeItem(PUSH_ENDPOINT_STORAGE_KEY);
	} catch {
		/* 同上 */
	}
}

/** 浏览器当前订阅的 endpoint（无 SW 注册或无订阅 → 空串，绝不抛）。 */
async function currentBrowserEndpoint(): Promise<string> {
	try {
		if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return '';
		const registration = await navigator.serviceWorker.getRegistration();
		const subscription = await registration?.pushManager?.getSubscription();
		return subscription?.endpoint ?? '';
	} catch {
		return '';
	}
}

/** 设备展示名：只来自 UA 的平台族，不含任何用户标识。 */
export function pushDeviceLabel(): string {
	const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
	if (ua.includes('iPhone')) return 'iPhone';
	if (ua.includes('iPad')) return 'iPad';
	if (ua.includes('Android')) return 'Android';
	if (ua.includes('Windows')) return 'Windows PC';
	if (ua.includes('Mac')) return 'Mac';
	if (ua.includes('Linux')) return 'Linux';
	return 'Unknown device';
}

/** 设备类型：从主屏幕启动 = pwa，其余 = web（与服务端 devices 口径一致）。 */
export function pushDeviceType(): string {
	try {
		if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
			return window.matchMedia('(display-mode: standalone)').matches ? 'pwa' : 'web';
		}
	} catch {
		/* 忽略 */
	}
	return 'web';
}

/** 当前状态（进页面即调用，用于正确显示开关）。 */
export async function getPushState(): Promise<PushNotificationState> {
	if (!isPushSupported()) return 'unsupported';
	if (isIosWithoutStandalone()) return 'ios-not-installed';
	if (Notification.permission === 'denied') return 'denied';
	// default（从未询问）与 granted 分支都还谈不上「已订阅」
	if (Notification.permission !== 'granted') return 'unsubscribed';

	const endpoint = readStoredPushEndpoint() || (await currentBrowserEndpoint());
	if (!endpoint) return 'unsubscribed';

	try {
		const list = await getPushSubscriptions();
		return list.some((item) => item.endpoint === endpoint) ? 'subscribed' : 'unsubscribed';
	} catch {
		// 服务端不可达：本地记录只在登记成功后写入，此时按「已订阅」显示，
		// 避免一次网络抖动把用户已开启的开关擅自关掉（关闭动作仍可正常发起）。
		return 'subscribed';
	}
}

function subscriptionKeys(subscription: PushSubscription | null): {
	endpoint: string;
	p256dh: string;
	auth: string;
} {
	if (!subscription) return { endpoint: '', p256dh: '', auth: '' };
	let json: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } = {};
	try {
		json = (subscription.toJSON?.() ?? {}) as typeof json;
	} catch {
		json = {};
	}
	return {
		endpoint: subscription.endpoint || json.endpoint || '',
		p256dh: json.keys?.p256dh ?? '',
		auth: json.keys?.auth ?? '',
	};
}

/**
 * 开启：请求权限 → 取 VAPID 公钥 → 浏览器订阅 → 服务端登记 → 写本地记录。
 * 顺序不可换：权限没拿到就不要去订阅（iOS 上会留下永远沉默的订阅），
 * 服务端没登记成功就不要写本地记录（否则关闭时会去解绑一个不存在的 endpoint）。
 */
export async function enablePush(): Promise<string> {
	if (!isPushSupported()) throw new PushNotificationError('unsupported');
	if (isIosWithoutStandalone()) throw new PushNotificationError('ios-not-installed');

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') throw new PushNotificationError('permission-denied');

	let vapidPublicKey: string;
	try {
		vapidPublicKey = await getVapidPublicKey();
	} catch {
		throw new PushNotificationError('vapid-failed');
	}
	if (!vapidPublicKey) throw new PushNotificationError('vapid-failed');

	const subscription = await subscribeBrowserPush(vapidPublicKey);
	const { endpoint, p256dh, auth } = subscriptionKeys(subscription);
	if (!endpoint || !p256dh || !auth) throw new PushNotificationError('subscribe-failed');

	try {
		await registerPushSubscription({
			endpoint,
			keys: { p256dh, auth },
			device_name: pushDeviceLabel(),
			device_type: pushDeviceType(),
			user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
		});
	} catch {
		throw new PushNotificationError('register-failed');
	}

	writeStoredPushEndpoint(endpoint);
	return endpoint;
}

/**
 * 关闭：浏览器退订 + 服务端删除登记 + 清本地记录。
 * 服务端删除失败 → 抛 unbind-failed 且**保留**本地记录（否则再也定位不到这条登记）。
 */
export async function disablePush(): Promise<void> {
	const endpoint = readStoredPushEndpoint() || (await currentBrowserEndpoint());

	try {
		await unsubscribeBrowserPush();
	} catch {
		/* 浏览器侧退订失败不阻断服务端清理：两处是独立真源，服务端删掉才是「不再推送」 */
	}

	if (endpoint) {
		try {
			await unregisterPushSubscription(endpoint);
		} catch {
			throw new PushNotificationError('unbind-failed');
		}
	}

	clearStoredPushEndpoint();
}
