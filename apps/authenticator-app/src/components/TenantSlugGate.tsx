/**
 * TenantSlugGate — 站点本地 slug 门（AU-30，W2；BLK-29 修订）
 *
 * 已认证 + 未知 slug + 任意子路径 ⇒ 404（禁渲染真实页）；有效 slug 一切如常。
 * - 不引入 allowedRoles/白名单路由（A-445 警示面零触碰）；
 * - 与 TenantRootRedirect/TenantIndexGuard 共享 ['public-tenants'] query key
 *   （staleTime 5m）→ 不新增请求源、不双取；
 * - 加载期先骨架（不先渲染后闪 404）。
 *
 * BLK-29（2026-11-16）：判定口径由「名单非空才判」改为**名单为权威**——
 * 名单为空（服务端确实没有公开租户）或拿不到（查询失败）时，未知 slug 一律 404。
 * 取舍：此前 fail-open 的设计动机是「名单 API 故障不制造全站 404」，但实际表现是
 * **未知 slug 静默渲染真实页 / 首页空壳**（无法与真实租户区分），这正是 BLK-29 的
 * 观测现象。爆炸半径也有限：本门只挂在 `/:tenantSlug/*`（旧链接形态）上，根路径
 * （`/settings`、`/devices` …）没有 slug 段，根本不进这个门 —— 故障期它们照常渲染。
 * 未知 slug 落到站内 404 页（带「返回首页」裸根漏斗），用户有可走的一步。
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

/** 名单条目最低形状（name 优先，slug 兜底；与共享层 PublicTenantInfo 兼容）。 */
export interface TenantSlugEntry {
	name?: string | null;
	slug?: string | null;
}

export type TenantSlugVerdict = 'loading' | 'pass' | 'not-found';

/**
 * slug 门判定（纯函数，供测试与组件共用）：
 * - 无 slug（根路径）→ pass（不限流，根路径是本站唯一 canonical 形态）；
 * - 首次加载中（无任何 data）→ loading（先骨架，不先渲染后闪 404）；
 * - 其余：slug 在名单里 → pass，否则 → not-found（含名单为空 / 查询失败）。
 */
export function tenantSlugVerdict(
	slug: string | null | undefined,
	tenants: readonly TenantSlugEntry[] | null | undefined,
	isLoading: boolean,
): TenantSlugVerdict {
	if (!slug) return 'pass';
	if (isLoading && !tenants) return 'loading';
	const list = tenants ?? [];
	return list.some((x) => (x.name || x.slug) === slug) ? 'pass' : 'not-found';
}

export default function TenantSlugGate({ children, notFound }: TenantSlugGateProps) {
	const { t } = useTranslation();
	const slug = useTenantSlug();
	const { data: tenants, isLoading } = usePublicTenantSlugs();

	const verdict = tenantSlugVerdict(slug, tenants as TenantSlugEntry[] | undefined, isLoading);

	if (verdict === 'loading') return <LoadingScreen message={t('common.loading')} />;
	if (verdict === 'not-found') return <>{notFound}</>;

	return <>{children}</>;
}
