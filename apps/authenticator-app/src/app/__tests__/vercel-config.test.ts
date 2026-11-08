import { describe, it, expect, beforeAll } from 'vitest';

/**
 * 部署配置守卫：安全响应头必须存在且口径正确（2026-11-08 QA，authenticator-portal F1）。
 *
 * 背景：`vercel.ts` 的 `headers` 此前只配了缓存头，线上实测缺 4 个基础安全头；
 * auth 站同轮已补（auth@7ac4a10）。单测/构建都不会产出真实 HTTP 响应，
 * 所以在配置层做静态锁，避免「删了也没人发现」。
 *
 * 特别注意：`Permissions-Policy` 必须是 `camera=(self)`。
 * 本应用要扫码绑定；照抄 auth 的 `camera=()` 会让摄像头被权限策略禁用。
 */
beforeAll(() => {
	// vercel.ts 在模块加载期 fail-closed：缺 API_ORIGIN 直接抛错。
	process.env.API_ORIGIN ??= 'https://api.example.test';
});

type Header = { key: string; value: string };
type HeaderRule = { source: string; headers: Header[] };

describe('vercel.ts 安全响应头', () => {
	let config: { headers?: HeaderRule[] };

	beforeAll(async () => {
		({ config } = await import('../../../../../vercel'));
	});

	const headerMap = (): Record<string, string> => {
		const out: Record<string, string> = {};
		for (const rule of config.headers ?? []) {
			for (const h of rule.headers) out[h.key.toLowerCase()] = h.value;
		}
		return out;
	};

	it('H1 全局规则覆盖 4 个基础安全头', () => {
		const map = headerMap();
		expect(map['x-content-type-options']).toBe('nosniff');
		expect(map['x-frame-options']).toBe('DENY');
		expect(map['referrer-policy']).toBe('strict-origin-when-cross-origin');
		expect(map['permissions-policy']).toBeTruthy();
	});

	it('H2 Permissions-Policy 允许本站摄像头（扫码依赖）', () => {
		const policy = headerMap()['permissions-policy'] || '';
		expect(policy).toContain('camera=(self)');
		expect(policy).not.toContain('camera=()');
		expect(policy).toContain('geolocation=()');
		expect(policy).toContain('microphone=()');
	});

	it('H3 全局安全头规则在 headers 列表里（不能只写常量不挂载）', () => {
		const sources = (config.headers ?? []).map((h) => h.source);
		expect(sources).toContain('/(.*)');
		const globalRule = (config.headers ?? []).find((h) => h.source === '/(.*)');
		const keys = (globalRule?.headers || []).map((h) => h.key.toLowerCase());
		expect(keys).toEqual(
			expect.arrayContaining([
				'x-content-type-options',
				'x-frame-options',
				'referrer-policy',
				'permissions-policy',
			]),
		);
	});

	it('H4 缓存头仍然保留（安全头不能挤掉缓存口径）', () => {
		const rules = (config.headers ?? []).map((h) => h.source);
		expect(rules).toContain('/assets/(.*)');
		expect(rules).toContain('/sw.js');
		expect(rules).toContain('/env.js');
	});
});
