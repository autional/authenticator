import { useParams } from 'react-router';

/** 本地模式伪租户段：/local/** 免登录只读本机保险库（不出码以外不触达服务端）。 */
export const LOCAL_MODE_SLUG = 'local';

/** 取当前路由 tenantSlug（authenticator 路由恒在 /:tenantSlug 下） */
export function useTenantSlug(): string {
	const { tenantSlug } = useParams<{ tenantSlug: string }>();
	return tenantSlug ?? '';
}

/** 当前是否本地（免登录）模式。 */
export function useIsLocalMode(): boolean {
	return useTenantSlug() === LOCAL_MODE_SLUG;
}

/**
 * 为 SPA 导航路径补 slug 前缀（basename 恒 / 后所有 navigate 必须带 slug）。
 * - toSlugged('/settings', 'acme-corp') → '/acme-corp/settings'
 * - toSlugged('/', 'acme-corp') → '/acme-corp/'（当前 slug 首页）
 * - 处理 query: toSlugged('/account?id=x', 'acme-corp') → '/acme-corp/account?id=x'
 * - 双斜杠归一: path 以 / 开头直接拼接
 */
export function toSlugged(path: string, slug: string): string {
	if (!slug) return path;
	if (path === '/') return `/${slug}/`;
	return `/${slug}${path}`;
}
