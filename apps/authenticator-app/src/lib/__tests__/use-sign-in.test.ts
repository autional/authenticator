import { describe, it, expect, beforeEach } from 'vitest';
import { buildSignInTarget } from '../use-sign-in';

/**
 * 登录回跳地址必须保留 path + query + hash。
 * 只带 pathname 会造成真实死点：
 * - `/login-approve?token=…` 登录回跳丢 token →「缺少验证参数」
 * - `/add?tab=qr` 登录回跳丢页签 → 落到手动输入
 *
 * 且租户段**不能重复拼**：`/acme/settings` 回跳成 `/acme/acme/settings` 会落到 404，
 * 用户回到 App 看到白屏/404 —— 表现得就像「登录没成功」。
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

	it('路径已带当前租户段 → 不重复拼（/acme/settings 不再变 /acme/acme/settings）', () => {
		window.history.pushState({}, '', '/acme/settings?tab=security#top');
		expect(buildSignInTarget('acme')).toBe(
			`${window.location.origin}/acme/settings?tab=security#top`,
		);
	});

	it('路径恰好是 /<slug> → 原样返回', () => {
		window.history.pushState({}, '', '/acme');
		expect(buildSignInTarget('acme')).toBe(`${window.location.origin}/acme`);
	});

	it('路径是 /<slug>/ → 原样返回（含尾斜杠）', () => {
		window.history.pushState({}, '', '/acme/');
		expect(buildSignInTarget('acme')).toBe(`${window.location.origin}/acme/`);
	});

	it('slug 前缀相同但不是同一段（/acme2/settings）→ 仍按原逻辑补当前 slug', () => {
		window.history.pushState({}, '', '/acme2/settings');
		expect(buildSignInTarget('acme')).toBe(`${window.location.origin}/acme/acme2/settings`);
	});

	it('别的租户段（/other/settings）→ 按原逻辑补当前 slug（已知取舍：首段被当作子路径）', () => {
		// 不改行为：登录用的是「本次要登录的租户」，URL 里别的租户段视为普通路径段。
		// 真到这一步说明用户在 A 租户链接上登 B 租户，回跳落到 A 的页面是正确的。
		window.history.pushState({}, '', '/other/settings');
		expect(buildSignInTarget('acme')).toBe(`${window.location.origin}/acme/other/settings`);
	});

	it('规范化 slug：前后空白 + 大小写（` Acme ` → acme）', () => {
		window.history.pushState({}, '', '/settings');
		expect(buildSignInTarget('  Acme  ')).toBe(`${window.location.origin}/acme/settings`);
		// 大小写不同的同一 slug 也要认出来（不重复拼）
		window.history.pushState({}, '', '/ACME/settings');
		expect(buildSignInTarget(' acme ')).toBe(`${window.location.origin}/ACME/settings`);
	});

	it('slug 为空 → 不拼出 `//`，直接用当前地址', () => {
		window.history.pushState({}, '', '/settings?tab=a');
		expect(buildSignInTarget('   ')).toBe(`${window.location.origin}/settings?tab=a`);
	});
});
