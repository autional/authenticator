import { useMemo } from 'react';
import { useParams } from 'react-router';
import { decodeJwtPayload, useAuthStore, usePublicTenantSlugs } from '@autional/shared';

/** 旧链接兼容段：/local/** 客户端重定向到根；不再作为租户。 */
export const LOCAL_MODE_SLUG = 'local';

const LAST_TENANT_KEY = 'authenticator-last-tenant-slug';

export function readLastTenantSlug(): string {
	try {
		return localStorage.getItem(LAST_TENANT_KEY) ?? '';
	} catch {
		return '';
	}
}

export function rememberTenantSlug(slug: string): void {
	try {
		if (slug) localStorage.setItem(LAST_TENANT_KEY, slug);
	} catch {
		/* quota/隐私模式：忽略 */
	}
}

/**
 * 当前 URL 的租户段（仅旧链接别名会提供）；根路径回落最近一次登录租户。
 * 注意：它不再用于拼内部链接（toSlugged 已是恒等）。
 */
export function useTenantSlug(): string {
	const { tenantSlug } = useParams<{ tenantSlug: string }>();
	return tenantSlug ?? readLastTenantSlug();
}

/** 当前是否旧本地模式链接（仅用于兼容判断）。 */
export function useIsLocalMode(): boolean {
	return useTenantSlug() === LOCAL_MODE_SLUG;
}

/**
 * 会话租户 slug：JWT tenant_id → 公开租户名单（5 分钟缓存）。
 * 用于登录后品牌覆盖与登录回跳；解析不到返回空串（默认品牌/租户选择页）。
 */
export function useSessionTenantSlug(): string {
	const accessToken = useAuthStore((s) => s.accessToken);
	const tenantId = useMemo(() => {
		const payload = accessToken ? decodeJwtPayload(accessToken) : null;
		const value = (payload as { tenant_id?: unknown } | null)?.tenant_id;
		return typeof value === 'string' ? value : '';
	}, [accessToken]);
	const { data: tenants } = usePublicTenantSlugs();

	return useMemo(() => {
		if (!tenantId || !tenants) return '';
		const hit = tenants.find((tenant) => tenant.id === tenantId);
		return hit?.name || hit?.slug || '';
	}, [tenantId, tenants]);
}

/**
 * 内部导航恒等：去租户后所有页面都在根路径。
 * 保留 slug 参数只为兼容旧调用点（不参与路径拼接）。
 */
export function toSlugged(path: string, _slug?: string): string {
	return path;
}
