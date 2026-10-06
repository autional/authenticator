/**
 * TenantSlugGate — 站点本地 slug 门（AU-30，W2）
 *
 * 已认证 + 未知 slug + 任意子路径 ⇒ 404（禁渲染真实页）；有效 slug 一切如常。
 * - 不引入 allowedRoles/白名单路由（A-445 警示面零触碰）；
 * - 与 TenantRootRedirect/TenantIndexGuard 共享 ['public-tenants'] query key
 *   （staleTime 5m）→ 不新增请求源、不双取；
 * - 加载期先骨架（不先渲染后闪 404）；名单为空 fail-open 放行
 *   （同 TenantIndexGuard 口径：名单 API 故障不制造全站 404）。
 * 未认证面仍由 RequireAuth 的 unknownSlugGate 负责（两半拼成全口径，RequireAuth 不动）。
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePublicTenantSlugs } from '@autional/shared';
import { LoadingScreen } from '@autional/ui';
import { useTenantSlug } from '@/lib/slug';

interface TenantSlugGateProps {
	children: ReactNode;
	notFound: ReactNode;
}

export default function TenantSlugGate({ children, notFound }: TenantSlugGateProps) {
	const { t } = useTranslation();
	const slug = useTenantSlug();
	const { data: tenants, isLoading } = usePublicTenantSlugs();

	// 加载期：先骨架（口径对齐 TenantIndexGuard.tsx:124）
	if (isLoading && !tenants) return <LoadingScreen message={t('common.loading')} />;

	// 名单非空且 slug 不在名单 → 未知 slug：404（真实页零渲染）
	if (slug && tenants && tenants.length > 0 && !tenants.some((x) => (x.name || x.slug) === slug)) {
		return <>{notFound}</>;
	}

	return <>{children}</>;
}
