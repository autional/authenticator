import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 登录 scope 回归锁（2026-11-14）
 *
 * 背景：本 App 的推送登记（POST /push/subscriptions）与 SSE 票据
 * （POST /notifications/stream-ticket）在 notification 服务属写方法，强制
 * RequireScopes("write")；带 client_id 的令牌没有首方通配 `*`，不申请就 403
 * （required_missing:"write"）。实测该接口 7 天内 403 了 70 次。
 *
 * 两个入口（use-sign-in / sign-in）都必须把 `write` 带进 authorize URL。
 */

const { mockInitiate, mockTrace } = vi.hoisted(() => ({
	mockInitiate: vi.fn(async () => {}),
	mockTrace: vi.fn(),
}));

vi.mock('@autional/shared', async () => {
	const actual = await vi.importActual<typeof import('@autional/shared')>('@autional/shared');
	return {
		...actual,
		initiateOAuthLogin: mockInitiate,
		// 让 isOAuthEnabled() 为真（走 OAuth 分支）
		isOAuthEnabled: () => true,
		traceRedirect: mockTrace,
	};
});

import { APP_LOGIN_SCOPES } from '../login-scope';
import { signIn } from '../sign-in';

describe('APP_LOGIN_SCOPES', () => {
	it('包含基础项与 write', () => {
		const scopes = APP_LOGIN_SCOPES.split(' ');
		expect(scopes).toContain('read');
		expect(scopes).toContain('write');
		expect(scopes).toContain('offline_access');
	});

	it('不重复', () => {
		const scopes = APP_LOGIN_SCOPES.split(' ').filter(Boolean);
		expect(new Set(scopes).size).toBe(scopes.length);
	});
});

describe('sign-in 入口把 scope 传给 initiateOAuthLogin', () => {
	beforeEach(() => {
		mockInitiate.mockClear();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('传 { scope: APP_LOGIN_SCOPES }，且 write 在内', () => {
		signIn('https://authenticator.example.com/acme/');
		expect(mockInitiate).toHaveBeenCalledTimes(1);
		const [, target, opts] = mockInitiate.mock.calls[0] as unknown as [
			unknown,
			string,
			{ scope?: string },
		];
		expect(target).toBe('https://authenticator.example.com/acme/');
		expect(opts?.scope).toBe(APP_LOGIN_SCOPES);
		expect(opts?.scope?.split(' ')).toContain('write');
	});
});
