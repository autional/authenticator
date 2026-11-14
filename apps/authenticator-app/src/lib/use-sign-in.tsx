import { useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { buildLoginUrl, initiateOAuthLogin, isOAuthEnabled } from '@autional/shared';
import { readLastTenantSlug, rememberTenantSlug } from './slug';
import { APP_LOGIN_SCOPES } from './login-scope';
import { useAuthenticatorStore } from './store';
import { navigateToLoginPage, startMfaSsoLogin, usableMfaAccounts } from './mfa-sso';
import { reportMfaSsoFailure } from './mfa-sso-report';
import TenantPickerDialog from '../components/TenantPickerDialog';

/**
 * 统一登录入口（app 内）：
 * - **默认优先走「本机票据」（MFA SSO）**：保险库里有带用户名的账户 + 已知租户时，
 *   用本机 TOTP secret 向 identity 换一次性票据，直接跳 auth 登录页（只需输密码）；
 * - 换票失败（网络 / 未开启 MFA / 租户不认这个身份 / 密钥损坏）→ **静默回落**原有
 *   OAuth / 租户选择流程，用户不会看到两条路径的区别；
 * - URL 带租户段（`/<slug>/...`）→ 直接用该租户；否则用最近一次登录的租户；
 *   都没有 → 弹「选择组织」（避免被固定送到平台租户登录）。
 *
 * 这条路径是**加速器**，不能成为登录的必经环节：任何异常都必须能回到手动登录。
 */
/**
 * 登录回跳地址：保留当前 path + query + hash。
 * 只带 pathname 会丢上下文 —— 典型死点：
 * `/login-approve?token=…` 登录后回跳丢 token →「缺少验证参数」；
 * `/add?tab=qr` 登录后回跳丢页签 → 落到手动输入。
 *
 * 租户段只在**路径里还没有**时补：老链接 `/acme/settings` 回跳不能变成
 * `/acme/acme/settings`（双 slug → 落到 404，登录完看起来还是没登录）。
 * 根路径 `/` 仍补成 `/<slug>/`（保持与改造前一致的登录上下文）。
 */
export function buildSignInTarget(slug: string): string {
	const { origin, pathname, search, hash } = window.location;
	// slug 来自 URL 段 / localStorage，可能带空白或大小写噪音（`Acme ` ≠ `acme`）。
	const normalized = slug.trim().toLowerCase();
	const isRoot = pathname === '/' && !search && !hash;
	const suffix = isRoot ? '/' : `${pathname}${search}${hash}`;

	// 没有 slug：不再拼出 `//` 这种坏地址，直接用当前地址。
	if (!normalized) return `${origin}${suffix}`;

	// 已带当前租户段（`/<slug>` 或 `/<slug>/…`）→ 原样回跳，不重复拼。
	// 大小写不敏感：slug 规范化为小写，路径可能是历史/手输的大写形态。
	const base = `/${normalized}`;
	const lowerPath = pathname.toLowerCase();
	if (lowerPath === base || lowerPath.startsWith(`${base}/`)) {
		return `${origin}${suffix}`;
	}

	return `${origin}/${normalized}${suffix}`;
}

/**
 * 用指定租户发起登录（OAuth 或跳登录页），保留当前页作为回跳地址。
 *
 * 独立导出：全局 banner（`ReloginNotice`）挂在路由树之外，拿不到 `:tenantSlug`，
 * 但重新登录的语义必须与页面内登录**完全一致**（同一回跳、同一 scope）。
 */
export function startSignIn(slug: string): void {
	const normalized = slug.trim().toLowerCase();
	if (!normalized) return;
	rememberTenantSlug(normalized);
	const target = buildSignInTarget(normalized);
	if (isOAuthEnabled()) {
		void initiateOAuthLogin(undefined, target, { scope: APP_LOGIN_SCOPES });
		return;
	}
	window.location.href = buildLoginUrl(target);
}

/**
 * 本次登录用哪个租户：URL 段优先，其次最近一次登录租户；都没有返回空串。
 * 点击时才求值（不缓存到渲染期）——用户可能在别的标签页登录过别的租户。
 */
export function resolveSignInTenant(routeSlug?: string | null): string {
	const fromRoute = (routeSlug ?? '').trim();
	if (fromRoute) return fromRoute.toLowerCase();
	return readLastTenantSlug().trim().toLowerCase();
}

export function useSignIn() {
	const { tenantSlug } = useParams<{ tenantSlug?: string }>();
	const [open, setOpen] = useState(false);
	const accounts = useAuthenticatorStore((s) => s.accounts);
	// 只有「有身份 + 有密钥」的账户才能换票；没有就整条路径不存在。
	const usable = useMemo(() => usableMfaAccounts(accounts), [accounts]);
	const recent = readLastTenantSlug();
	// 一次登录只换一次票 / 只跳一次：换票是两次网络往返，连点会重复消耗挑战。
	const exchanging = useRef(false);

	/** 原有流程（OAuth / 租户选择），也是换票失败后的回落目标。 */
	const legacySignIn = () => {
		if (tenantSlug) {
			startSignIn(tenantSlug);
			return;
		}
		setOpen(true);
	};

	const signIn = () => {
		if (exchanging.current) return;

		const tenant = resolveSignInTenant(tenantSlug);
		// 多个可用账户时取第一个（登录页会预填该身份；用户改成别的身份则票据失效，
		// 自然回落到手动登录）——不为「选哪个身份」再加一层弹窗。
		const account = usable[0];

		// 没账户或没租户：这条加速路径不存在，直接走原流程（行为与改造前一致）。
		if (!tenant || !account) {
			legacySignIn();
			return;
		}

		exchanging.current = true;
		rememberTenantSlug(tenant);

		void (async () => {
			let loginUrl: string;
			try {
				loginUrl = await startMfaSsoLogin(account, tenant);
			} catch (error) {
				// 只回落、不提示细节：票据拿不到不算错误，用户只是需要多输一次密码。
				// 但**必须**留痕（控制台 + 埋点，已脱敏）：全静默会让「一直登录不进去」
				// 在生产上无从排查；这里也绝不输出 secret / proof / ticket。
				reportMfaSsoFailure('ticket-exchange', error);
				exchanging.current = false;
				legacySignIn();
				return;
			}
			navigateToLoginPage(loginUrl);
		})();
	};

	const dialog = (
		<TenantPickerDialog
			open={open}
			recent={recent}
			onPick={(slug: string) => startSignIn(slug)}
			onCancel={() => setOpen(false)}
		/>
	);

	return { signIn, legacySignIn, dialog };
}
