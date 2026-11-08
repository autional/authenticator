import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';

/**
 * B3 兼容层回归锁：`/local/* → /*`。
 *
 * 背景（2026-11-08 QA，authenticator-portal F2）：
 * React Router 的 matchRoutes 打分里，`/:tenantSlug/*` 的**具体子段**（settings/devices…）
 * 会赢过 `/local/*` 的 splat。也就是说，仅把 `/local/*` 放在 `/:tenantSlug/*` 前面
 * **不足以**生效——`/local/settings` 会匹配到 `/:tenantSlug/*`，slug=`local`，
 * 再被 TenantSlugGate 判成未知租户 → 404。
 *
 * 本测试用与 App.tsx 同形的路由树（含真实 LayoutWrapper）锁住两点：
 *  1. `/local/**` 一律回到根路径对应页（query/hash 保留），不进入租户门；
 *  2. 真租户路径仍走原逻辑（不能为了兼容把 `/:tenantSlug/*` 打死）。
 *
 * 半剥 mock：只替换会发网络的 BrandingInitializer 与租户名单，其余走 actual。
 */
vi.mock('@autional/shared', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@autional/shared')>();
	return {
		...actual,
		BrandingInitializer: () => null,
		usePublicTenantSlugs: () => ({ data: [{ name: 'acme-corp' }], isLoading: false }),
	};
});

import { LayoutWrapper, LocalRedirect, legacyLocalTarget } from '../../App';

function LocationProbe() {
	const { pathname, search, hash } = useLocation();
	return <div data-testid="loc">{`${pathname}|${search}|${hash}`}</div>;
}

function renderAt(entry: string) {
	return render(
		<MemoryRouter initialEntries={[entry]}>
			<LocationProbe />
			<Routes>
				{/* 与 App.tsx 相同的顶层结构：兼容路由在前，租户路由在后 */}
				<Route path="/local/*" element={<LocalRedirect />} />
				<Route path="/" element={<LayoutWrapper />}>
					<Route index element={<div data-testid="home">HOME</div>} />
					<Route path="settings" element={<div data-testid="settings">SETTINGS</div>} />
					<Route path="devices" element={<div data-testid="devices">DEVICES</div>} />
				</Route>
				<Route path="/:tenantSlug/*" element={<LayoutWrapper />}>
					<Route index element={<div data-testid="tenant-home">TENANT HOME</div>} />
					<Route path="settings" element={<div data-testid="tenant-settings">TENANT SETTINGS</div>} />
					<Route path="devices" element={<div data-testid="tenant-devices">TENANT DEVICES</div>} />
				</Route>
				<Route path="*" element={<div data-testid="not-found">404</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('legacyLocalTarget', () => {
	it('把 /local 前缀映射到根路径', () => {
		expect(legacyLocalTarget('/local/settings')).toBe('/settings');
		expect(legacyLocalTarget('/local')).toBe('/');
		expect(legacyLocalTarget('/local/')).toBe('/');
	});

	it('保留 query 与 hash', () => {
		expect(legacyLocalTarget('/local/devices', '?tab=1', '#top')).toBe('/devices?tab=1#top');
		expect(legacyLocalTarget('/local', '?logout=1')).toBe('/?logout=1');
	});

	it('不误伤相似首段', () => {
		expect(legacyLocalTarget('/locality/x')).toBe('/locality/x');
		expect(legacyLocalTarget('/settings')).toBe('/settings');
	});
});

describe('LayoutWrapper × /local/* 兼容（F2 回归）', () => {
	it('T1 /local/settings → /settings，渲染设置页且不进租户门/404', async () => {
		renderAt('/local/settings');
		expect(await screen.findByTestId('settings')).toBeInTheDocument();
		expect(screen.queryByTestId('not-found')).toBeNull();
		expect(screen.queryByTestId('tenant-settings')).toBeNull();
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/settings||'));
	});

	it('T2 /local → /（首页）', async () => {
		renderAt('/local');
		expect(await screen.findByTestId('home')).toBeInTheDocument();
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/||'));
	});

	it('T3 /local/devices?tab=1#x → /devices?tab=1#x（query/hash 保留）', async () => {
		renderAt('/local/devices?tab=1#x');
		expect(await screen.findByTestId('devices')).toBeInTheDocument();
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/devices|?tab=1|#x'));
	});

	it('T4 真租户路径不受影响：/acme-corp/settings 渲染租户设置页', async () => {
		renderAt('/acme-corp/settings');
		expect(await screen.findByTestId('tenant-settings')).toBeInTheDocument();
		expect(screen.queryByTestId('settings')).toBeNull();
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/acme-corp/settings||'));
	});
});
