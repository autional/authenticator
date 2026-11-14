import { useState } from 'react';
import { useParams } from 'react-router';
import { buildLoginUrl, initiateOAuthLogin, isOAuthEnabled } from '@autional/shared';
import { readLastTenantSlug, rememberTenantSlug } from './slug';
import { APP_LOGIN_SCOPES } from './login-scope';
import TenantPickerDialog from '../components/TenantPickerDialog';

/**
 * 统一登录入口（app 内）：
 * - URL 带租户段（`/<slug>/...`）→ 直接 OAuth，回跳地址保留租户段；
 * - 无租户段 → 弹「选择组织」，选定后再 OAuth（避免被固定送到平台租户登录）。
 * 平台管理员可在弹窗里选「平台管理」（platform）。
 */
/**
 * 登录回跳地址：保留当前 path + query + hash。
 * 只带 pathname 会丢上下文 —— 典型死点：
 * `/login-approve?token=…` 登录后回跳丢 token →「缺少验证参数」；
 * `/add?tab=qr` 登录后回跳丢页签 → 落到手动输入。
 */
export function buildSignInTarget(slug: string): string {
	const { origin, pathname, search, hash } = window.location;
	const suffix = pathname === '/' && !search && !hash ? '/' : `${pathname}${search}${hash}`;
	return `${origin}/${slug}${suffix}`;
}

export function useSignIn() {
	const { tenantSlug } = useParams<{ tenantSlug?: string }>();
	const [open, setOpen] = useState(false);
	const recent = readLastTenantSlug();

	const doSignIn = (slug: string) => {
		const normalized = slug.trim().toLowerCase();
		if (!normalized) return;
		rememberTenantSlug(normalized);
		const target = buildSignInTarget(normalized);
		if (isOAuthEnabled()) {
			void initiateOAuthLogin(undefined, target, { scope: APP_LOGIN_SCOPES });
			return;
		}
		window.location.href = buildLoginUrl(target);
	};

	const signIn = () => {
		if (tenantSlug) {
			doSignIn(tenantSlug);
			return;
		}
		setOpen(true);
	};

	const dialog = (
		<TenantPickerDialog
			open={open}
			recent={recent}
			onPick={doSignIn}
			onCancel={() => setOpen(false)}
		/>
	);

	return { signIn, dialog };
}
