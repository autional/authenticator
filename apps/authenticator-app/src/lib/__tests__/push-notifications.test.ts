import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 后台审批通知（Web Push）状态机回归锁：
 *   ① 三种禁用态：unsupported（无 API）/ ios-not-installed（iOS 非主屏幕）/ denied（权限被拒）；
 *   ② 开启调用顺序固定：requestPermission → getVapidPublicKey → subscribeBrowserPush → registerPushSubscription；
 *   ③ 关闭：浏览器退订 + 服务端解绑 + 清本地记录；
 *   ④ 失败抛带 code 的错误且**不写/不清本地记录**（不假装成功）。
 */

const {
	mockGetVapidPublicKey,
	mockSubscribe,
	mockUnsubscribe,
	mockRegister,
	mockUnregister,
	mockList,
	order,
} = vi.hoisted(() => ({
	mockGetVapidPublicKey: vi.fn(),
	mockSubscribe: vi.fn(),
	mockUnsubscribe: vi.fn(),
	mockRegister: vi.fn(),
	mockUnregister: vi.fn(),
	mockList: vi.fn(),
	order: [] as string[],
}));

vi.mock('../push', () => ({
	getVapidPublicKey: (...args: unknown[]) => {
		order.push('vapid');
		return mockGetVapidPublicKey(...args);
	},
	subscribeBrowserPush: (...args: unknown[]) => {
		order.push('subscribe');
		return mockSubscribe(...args);
	},
	unsubscribeBrowserPush: (...args: unknown[]) => {
		order.push('unsubscribe');
		return mockUnsubscribe(...args);
	},
	registerPushSubscription: (...args: unknown[]) => {
		order.push('register');
		return mockRegister(...args);
	},
	unregisterPushSubscription: (...args: unknown[]) => {
		order.push('unregister');
		return mockUnregister(...args);
	},
	getPushSubscriptions: (...args: unknown[]) => mockList(...args),
}));

import {
	PUSH_ENDPOINT_STORAGE_KEY,
	PushNotificationError,
	disablePush,
	enablePush,
	getPushState,
	isIosWithoutStandalone,
	pushDeviceLabel,
	pushDeviceType,
} from '../push-notifications';

const ENDPOINT = 'https://push.example.test/ep-1';

const notificationStub = {
	permission: 'default' as NotificationPermission,
	requestPermission: vi.fn(async () => 'granted' as NotificationPermission),
};

const subscription = {
	endpoint: ENDPOINT,
	toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } }),
};

function stubPushApis() {
	vi.stubGlobal('Notification', notificationStub);
	vi.stubGlobal('PushManager', class PushManager {});
	Object.defineProperty(navigator, 'serviceWorker', {
		configurable: true,
		value: { getRegistration: async () => undefined },
	});
}

function setUserAgent(ua: string) {
	Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua });
}

const IOS_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

beforeEach(() => {
	vi.clearAllMocks();
	order.length = 0;
	window.localStorage.clear();
	notificationStub.permission = 'default';
	notificationStub.requestPermission.mockImplementation(async () => 'granted');
	mockGetVapidPublicKey.mockResolvedValue('vapid-public-key');
	mockSubscribe.mockResolvedValue(subscription);
	mockRegister.mockResolvedValue(undefined);
	mockUnregister.mockResolvedValue(undefined);
	mockUnsubscribe.mockResolvedValue(true);
	mockList.mockResolvedValue([]);
	stubPushApis();
	setUserAgent(DESKTOP_UA);
});

afterEach(() => {
	vi.unstubAllGlobals();
	delete (navigator as unknown as Record<string, unknown>).userAgent;
	delete (navigator as unknown as Record<string, unknown>).serviceWorker;
});

describe('getPushState · 三种禁用态', () => {
	it('缺少 PushManager/Notification → unsupported', async () => {
		vi.unstubAllGlobals();
		Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} });
		expect(await getPushState()).toBe('unsupported');
	});

	it('iOS 且非 standalone → ios-not-installed', async () => {
		setUserAgent(IOS_UA);
		expect(isIosWithoutStandalone()).toBe(true);
		expect(await getPushState()).toBe('ios-not-installed');
	});

	it('iOS 从主屏幕启动（standalone）→ 不再是 ios-not-installed', async () => {
		setUserAgent(IOS_UA);
		Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
		try {
			expect(isIosWithoutStandalone()).toBe(false);
			expect(await getPushState()).toBe('unsubscribed');
		} finally {
			delete (navigator as unknown as Record<string, unknown>).standalone;
		}
	});

	it('权限被拒 → denied（即使本机有记录）', async () => {
		notificationStub.permission = 'denied';
		window.localStorage.setItem(PUSH_ENDPOINT_STORAGE_KEY, ENDPOINT);
		expect(await getPushState()).toBe('denied');
	});
});

describe('getPushState · 已订阅判定', () => {
	it('从未询问权限 → unsubscribed', async () => {
		expect(await getPushState()).toBe('unsubscribed');
	});

	it('权限已授予但本机无 endpoint → unsubscribed', async () => {
		notificationStub.permission = 'granted';
		expect(await getPushState()).toBe('unsubscribed');
		expect(mockList).not.toHaveBeenCalled();
	});

	it('本机 endpoint 在服务端订阅表里 → subscribed（进页面即正确显示）', async () => {
		notificationStub.permission = 'granted';
		window.localStorage.setItem(PUSH_ENDPOINT_STORAGE_KEY, ENDPOINT);
		mockList.mockResolvedValue([{ endpoint: 'other' }, { endpoint: ENDPOINT }]);
		expect(await getPushState()).toBe('subscribed');
	});

	it('本机 endpoint 不在服务端订阅表里（换账号/被清掉）→ unsubscribed', async () => {
		notificationStub.permission = 'granted';
		window.localStorage.setItem(PUSH_ENDPOINT_STORAGE_KEY, ENDPOINT);
		mockList.mockResolvedValue([{ endpoint: 'other' }]);
		expect(await getPushState()).toBe('unsubscribed');
	});

	it('服务端不可达 → 按本地记录显示已订阅（不因网络抖动把用户开关关掉）', async () => {
		notificationStub.permission = 'granted';
		window.localStorage.setItem(PUSH_ENDPOINT_STORAGE_KEY, ENDPOINT);
		mockList.mockRejectedValue(new Error('network down'));
		expect(await getPushState()).toBe('subscribed');
	});
});

describe('enablePush · 调用顺序与失败语义', () => {
	it('顺序固定：permission → vapid → subscribe → register，成功后写本地 endpoint', async () => {
		const endpoint = await enablePush();

		expect(notificationStub.requestPermission).toHaveBeenCalledTimes(1);
		expect(order).toEqual(['vapid', 'subscribe', 'register']);
		expect(mockSubscribe).toHaveBeenCalledWith('vapid-public-key');
		expect(mockRegister).toHaveBeenCalledWith({
			endpoint: ENDPOINT,
			keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
			device_name: 'Windows PC',
			device_type: 'web',
			user_agent: DESKTOP_UA,
		});
		expect(endpoint).toBe(ENDPOINT);
		expect(window.localStorage.getItem(PUSH_ENDPOINT_STORAGE_KEY)).toBe(ENDPOINT);
	});

	it('权限被拒 → 抛 permission-denied，不订阅、不登记、不写本地记录', async () => {
		notificationStub.requestPermission.mockResolvedValue('denied');

		await expect(enablePush()).rejects.toMatchObject({ code: 'permission-denied' });
		expect(order).toEqual([]);
		expect(window.localStorage.getItem(PUSH_ENDPOINT_STORAGE_KEY)).toBeNull();
	});

	it('VAPID 取不到 → vapid-failed（不订阅）', async () => {
		mockGetVapidPublicKey.mockRejectedValue(new Error('500'));

		await expect(enablePush()).rejects.toMatchObject({ code: 'vapid-failed' });
		expect(mockSubscribe).not.toHaveBeenCalled();
	});

	it('浏览器订阅返回 null → subscribe-failed（不登记）', async () => {
		mockSubscribe.mockResolvedValue(null);

		await expect(enablePush()).rejects.toMatchObject({ code: 'subscribe-failed' });
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('服务端登记失败 → register-failed 且不写本地记录（关闭时不会去解绑不存在的 endpoint）', async () => {
		mockRegister.mockRejectedValue(new Error('409'));

		const pending = enablePush();
		await expect(pending).rejects.toBeInstanceOf(PushNotificationError);
		await expect(pending).rejects.toMatchObject({ code: 'register-failed' });
		expect(window.localStorage.getItem(PUSH_ENDPOINT_STORAGE_KEY)).toBeNull();
	});

	// P0-2026-11-14 回归：登记失败必须回滚本次新建的浏览器订阅（不留半订阅态）
	it('登记被 403 拒绝（令牌缺 write scope）→ register-forbidden，并退订本次新建的浏览器订阅', async () => {
		mockRegister.mockRejectedValue(
			Object.assign(new Error('Request failed with status code 403'), {
				isAxiosError: true,
				response: {
					status: 403,
					data: { code: 40300001, required_missing: 'write' },
				},
			}),
		);

		await expect(enablePush()).rejects.toMatchObject({ code: 'register-forbidden' });
		expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
		expect(window.localStorage.getItem(PUSH_ENDPOINT_STORAGE_KEY)).toBeNull();
	});

	it('登记被非 403 的 4xx 拒绝 → register-rejected，并按同样语义回滚', async () => {
		mockRegister.mockRejectedValue(
			Object.assign(new Error('Request failed with status code 400'), {
				isAxiosError: true,
				response: { status: 400, data: { code: 40000001 } },
			}),
		);

		await expect(enablePush()).rejects.toMatchObject({ code: 'register-rejected' });
		expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
		expect(window.localStorage.getItem(PUSH_ENDPOINT_STORAGE_KEY)).toBeNull();
	});

	it('403 与其它 4xx 必须区分：前者只能靠重新登录修（refresh 继承旧 scope）', async () => {
		mockRegister.mockRejectedValueOnce(
			Object.assign(new Error('403'), { isAxiosError: true, response: { status: 403 } }),
		);
		await expect(enablePush()).rejects.toMatchObject({ code: 'register-forbidden' });

		mockRegister.mockRejectedValueOnce(
			Object.assign(new Error('409'), { isAxiosError: true, response: { status: 409 } }),
		);
		await expect(enablePush()).rejects.toMatchObject({ code: 'register-rejected' });
	});

	it('登记请求没到服务端（离线/无 response）→ register-offline，并按同样语义回滚', async () => {
		mockRegister.mockRejectedValue(
			Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' }),
		);

		await expect(enablePush()).rejects.toMatchObject({ code: 'register-offline' });
		expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
	});

	it('服务端 5xx → register-failed（可重试），仍回滚本次新建订阅', async () => {
		mockRegister.mockRejectedValue(
			Object.assign(new Error('internal'), { isAxiosError: true, response: { status: 502 } }),
		);

		await expect(enablePush()).rejects.toMatchObject({ code: 'register-failed' });
		expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
	});

	it('本次之前就存在的浏览器订阅 → 登记失败时**不**退订（可能对应更早的成功登记）', async () => {
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: {
				getRegistration: async () => ({
					pushManager: { getSubscription: async () => subscription },
				}),
			},
		});
		mockRegister.mockRejectedValue(
			Object.assign(new Error('internal'), { isAxiosError: true, response: { status: 500 } }),
		);

		await expect(enablePush()).rejects.toMatchObject({ code: 'register-failed' });
		expect(mockUnsubscribe).not.toHaveBeenCalled();
	});
});

describe('disablePush · 解绑与本地记录', () => {
	it('退订浏览器 + 服务端解绑 + 清本地记录', async () => {
		window.localStorage.setItem(PUSH_ENDPOINT_STORAGE_KEY, ENDPOINT);

		await disablePush();

		expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
		expect(mockUnregister).toHaveBeenCalledWith(ENDPOINT);
		expect(window.localStorage.getItem(PUSH_ENDPOINT_STORAGE_KEY)).toBeNull();
	});

	it('服务端解绑失败 → unbind-failed，且保留本地记录（下次还能定位这条登记）', async () => {
		window.localStorage.setItem(PUSH_ENDPOINT_STORAGE_KEY, ENDPOINT);
		mockUnregister.mockRejectedValue(new Error('timeout'));

		await expect(disablePush()).rejects.toMatchObject({ code: 'unbind-failed' });
		expect(window.localStorage.getItem(PUSH_ENDPOINT_STORAGE_KEY)).toBe(ENDPOINT);
	});

	it('浏览器侧退订失败不阻断服务端解绑', async () => {
		window.localStorage.setItem(PUSH_ENDPOINT_STORAGE_KEY, ENDPOINT);
		mockUnsubscribe.mockRejectedValue(new Error('no sw'));

		await disablePush();

		expect(mockUnregister).toHaveBeenCalledWith(ENDPOINT);
		expect(window.localStorage.getItem(PUSH_ENDPOINT_STORAGE_KEY)).toBeNull();
	});
});

describe('设备信息', () => {
	it('device_name 只取平台族，不含用户标识', () => {
		setUserAgent(IOS_UA);
		expect(pushDeviceLabel()).toBe('iPhone');
		setUserAgent('Mozilla/5.0 (Linux; Android 14)');
		expect(pushDeviceLabel()).toBe('Android');
	});

	it('device_type 非主屏幕恒为 web', () => {
		expect(pushDeviceType()).toBe('web');
	});
});
