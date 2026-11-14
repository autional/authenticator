// client-id-literal: test-fixture（ULID 字面量仅作测试夹具；生产路径禁止出现）
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getAppClientId } from '../app-config';

/**
 * client_id 的**唯一**来源是运行时 `window.__APP_CONFIG__`（`public/env.js` 注入，
 * 与 OAuth 登录会话同源）。
 *
 * 两条必须钉住的边界：
 * 1. 取值 = 运行时配置，`trim()` 后返回；
 * 2. 取不到就是 `''` —— **不回落** `import.meta.env`，更不回落任何源码字面量
 *    （兜底常量会造出「代码常量 / 配置 / 源码字面量」三个真源）。
 */

const CLIENT_ID = '01AR0000000000000000000005';

type ConfigHost = { window: { __APP_CONFIG__?: unknown } };

function setRuntimeConfig(config: unknown): void {
	(globalThis as unknown as ConfigHost).window.__APP_CONFIG__ = config;
}

function clearRuntimeConfig(): void {
	delete (globalThis as unknown as ConfigHost).window.__APP_CONFIG__;
}

describe('getAppClientId（运行时 __APP_CONFIG__ 单源）', () => {
	afterEach(() => {
		clearRuntimeConfig();
		vi.unstubAllEnvs();
	});

	it('读 __APP_CONFIG__.VITE_OAUTH_CLIENT_ID', () => {
		setRuntimeConfig({ VITE_OAUTH_CLIENT_ID: CLIENT_ID });
		expect(getAppClientId()).toBe(CLIENT_ID);
	});

	it('取值做 trim（生成物可能带空白）', () => {
		setRuntimeConfig({ VITE_OAUTH_CLIENT_ID: `  ${CLIENT_ID}\n` });
		expect(getAppClientId()).toBe(CLIENT_ID);
	});

	it('env.js 未注入 / 键缺失 / 非字符串 / 空串 → 空串（不兜底）', () => {
		clearRuntimeConfig();
		expect(getAppClientId()).toBe('');

		for (const config of [
			{},
			{ VITE_OAUTH_CLIENT_ID: '' },
			{ VITE_OAUTH_CLIENT_ID: '   ' },
			{ VITE_OAUTH_CLIENT_ID: 42 },
			{ VITE_OAUTH_CLIENT_ID: null },
			null,
			undefined,
			'not-an-object',
		]) {
			setRuntimeConfig(config);
			expect(getAppClientId()).toBe('');
		}
	});

	it('不回落 import.meta.env（避免第三真源）', () => {
		// 构建期若有值、运行时没有，仍视为「取不到」——否则换域部署会静默错绑。
		vi.stubEnv('VITE_OAUTH_CLIENT_ID', 'from-import-meta-env');
		clearRuntimeConfig();
		expect(getAppClientId()).toBe('');
	});

	it('运行时有值时不被 import.meta.env 覆盖', () => {
		vi.stubEnv('VITE_OAUTH_CLIENT_ID', 'from-import-meta-env');
		setRuntimeConfig({ VITE_OAUTH_CLIENT_ID: CLIENT_ID });
		expect(getAppClientId()).toBe(CLIENT_ID);
	});
});
