import { describe, it, expect, beforeEach } from 'vitest';
import { buildSignInTarget } from '../use-sign-in';

/**
 * 登录回跳地址必须保留 path + query + hash。
 * 只带 pathname 会造成真实死点：
 * - `/login-approve?token=…` 登录回跳丢 token →「缺少验证参数」
 * - `/add?tab=qr` 登录回跳丢页签 → 落到手动输入
 */
describe('buildSignInTarget（登录回跳上下文）', () => {
	beforeEach(() => {
		window.history.pushState({}, '', '/');
	});

	it('保留 query：/add?tab=qr', () => {
		window.history.pushState({}, '', '/add?tab=qr');
		expect(buildSignInTarget('acme')).toBe(`${window.location.origin}/acme/add?tab=qr`);
	});

	it('保留 query + hash：/login-approve?token=t1&nm=123456#top', () => {
		window.history.pushState({}, '', '/login-approve?token=t1&nm=123456#top');
		expect(buildSignInTarget('acme')).toBe(
			`${window.location.origin}/acme/login-approve?token=t1&nm=123456#top`,
		);
	});

	it('根路径保持尾斜杠', () => {
		expect(buildSignInTarget('acme')).toBe(`${window.location.origin}/acme/`);
	});
});
