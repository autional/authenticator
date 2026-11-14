/**
 * App 运行时配置的**唯一**读取点（OAuth client 身份）。
 *
 * 为什么是运行时 `window.__APP_CONFIG__` 而不是 `import.meta.env`：
 * 1. `public/env.js` 由 `scripts/gen-env.mjs` 生成，形状 = `@autional/shared` 的
 *    `getEnv` 读取形状 —— **就是 OAuth 登录会话用的那份配置**。票据里的
 *    `client_id` 必须与登录会话的 client 同源，否则票绑的是一个 client、
 *    登录走的是另一个，兑换端永远按「无票」回落（功能等于没上）。
 * 2. 换区/换域部署不需要重新构建 bundle（env.js 是独立注入的）。
 * 3. 单一读点 ⇒ 源码里 client_id 字面量恒为 0，可被机械校验。
 *
 * **不设任何字面量兜底**：拿不到就返回空串，由调用方 fail-closed
 * （不发起换票，直接回落手动登录）。兜底常量会造出「代码常量 / 配置 /
 * 源码字面量」三个真源 —— 改了常量忘改源码就是静默错绑。
 *
 * 禁止在本文件之外散落 client_id 字面量或自建第二个读取点。
 */

/** `public/env.js` 注入的运行时配置（只声明本模块用到的键，其余忽略）。 */
interface AppRuntimeConfig {
	readonly VITE_OAUTH_CLIENT_ID?: unknown;
}

/** 取运行时配置对象；非浏览器环境 / 未注入 env.js / 取值抛错 → undefined。 */
function readAppConfig(): AppRuntimeConfig | undefined {
	try {
		const host = globalThis as { window?: { __APP_CONFIG__?: AppRuntimeConfig } };
		const config = host.window?.__APP_CONFIG__;
		return config && typeof config === 'object' ? config : undefined;
	} catch {
		return undefined;
	}
}

/**
 * 本 App 的 OAuth client_id（公开标识，非密钥）。
 *
 * @returns 已 `trim()` 的 client_id；`env.js` 未注入 / 键缺失 / 非字符串 / 空串 → `''`（调用方据此 fail-closed）。
 */
export function getAppClientId(): string {
	const raw = readAppConfig()?.VITE_OAUTH_CLIENT_ID;
	if (typeof raw !== 'string') return '';
	return raw.trim();
}
