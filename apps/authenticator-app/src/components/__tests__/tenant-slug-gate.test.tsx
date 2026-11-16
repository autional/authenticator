import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';

/**
 * BLK-29 回归锁（未知 slug 必须 404，不得渲染真实页/空壳）。
 *
 * 观测现象（2026-11-16）：`/nope-shoes/settings` 这类未知租户路径此前能渲染**真实的**
 * 设置页——因为 TenantSlugGate 是 fail-open 的：名单为空或查询失败时直接放行。
 * 用户看到的是一个"看起来正常"的页面（空壳），而不是 404。
 *
 * 现在口径：名单为权威 —— 名单为空 / 拿不到 / slug 不在名单 ⇒ 站内 404 页。
 * 只影响 `/:tenantSlug/*`（旧链接形态）；根路径没有 slug 段，不进这个门。
 */

const tenantState: {
	data: Array<{ name?: string | null; slug?: string | null }> | undefined;
	isLoading: boolean;
} = { data: undefined, isLoading: false };

vi.mock('@autional/shared', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@autional/shared')>();
	return {
		...actual,
		BrandingInitializer: () => null,
		usePublicTenantSlugs: () => ({ data: tenantState.data, isLoading: tenantState.isLoading }),
	};
});

import { LayoutWrapper } from '../../App';
import { tenantSlugVerdict } from '../TenantSlugGate';

afterEach(() => {
	tenantState.data = undefined;
	tenantState.isLoading = false;
	document.body.innerHTML = '';
});

function LocationProbe() {
	const { pathname } = useLocation();
	return <div data-testid="loc">{pathname}</div>;
}

/** 与 App.tsx 同形的路由树（/ 与 /:tenantSlug/* 共享同一批子路由）。 */
function renderAt(entry: string) {
	return render(
		<MemoryRouter initialEntries={[entry]}>
			<LocationProbe />
			<Routes>
				<Route path="/" element={<LayoutWrapper />}>
					<Route index element={<div data-testid="home">HOME</div>} />
					<Route path="settings" element={<div data-testid="settings">SETTINGS</div>} />
					<Route path="devices" element={<div data-testid="devices">DEVICES</div>} />
					<Route path="*" element={<div data-testid="root-miss">MISS</div>} />
				</Route>
				<Route path="/:tenantSlug/*" element={<LayoutWrapper />}>
					<Route index element={<div data-testid="home">HOME</div>} />
					<Route path="settings" element={<div data-testid="settings">SETTINGS</div>} />
					<Route path="devices" element={<div data-testid="devices">DEVICES</div>} />
					<Route path="*" element={<div data-testid="root-miss">MISS</div>} />
				</Route>
				<Route path="*" element={<div data-testid="top-miss">TOP MISS</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('tenantSlugVerdict（纯函数口径）', () => {
	it('根路径（无 slug）永远放行', () => {
		expect(tenantSlugVerdict('', [{ name: 'acme-corp' }], false)).toBe('pass');
		expect(tenantSlugVerdict('', undefined, true)).toBe('pass');
	});

	it('首次加载中（无 data）先骨架，不判 404', () => {
		expect(tenantSlugVerdict('acme-corp', undefined, true)).toBe('loading');
	});

	it('名单命中 → 放行（name 或 slug 任一匹配）', () => {
		expect(tenantSlugVerdict('acme-corp', [{ name: 'acme-corp' }], false)).toBe('pass');
		expect(tenantSlugVerdict('acme', [{ slug: 'acme' }], false)).toBe('pass');
	});

	it('名单非空但未命中 → 404', () => {
		expect(tenantSlugVerdict('nope-shoes', [{ name: 'acme-corp' }], false)).toBe('not-found');
	});

	it('名单为空（服务端确实无公开租户）→ 404（旧行为是 fail-open 放行）', () => {
		expect(tenantSlugVerdict('nope-shoes', [], false)).toBe('not-found');
	});

	it('名单拿不到（查询失败）→ 404（旧行为是 fail-open 放行）', () => {
		expect(tenantSlugVerdict('nope-shoes', undefined, false)).toBe('not-found');
	});
});

describe('TenantSlugGate × 未知 slug（BLK-29 渲染面锁定）', () => {
	it('U1 名单已加载但 slug 未知 → 站内 404 页（渲染真实页 = 回归）', async () => {
		tenantState.data = [{ name: 'acme-corp' }];
		renderAt('/nope-shoes/settings');
		expect(await screen.findByText('404')).toBeInTheDocument();
		expect(screen.queryByTestId('settings')).toBeNull();
	});

	it('U2 名单为空 → 404（此前是空壳/真实页）', async () => {
		tenantState.data = [];
		renderAt('/nope-shoes/settings');
		expect(await screen.findByText('404')).toBeInTheDocument();
		expect(screen.queryByTestId('settings')).toBeNull();
	});

	it('U3 名单拿不到（undefined）→ 404（此前 fail-open 渲染真实页）', async () => {
		tenantState.data = undefined;
		renderAt('/nope-shoes/devices');
		expect(await screen.findByText('404')).toBeInTheDocument();
		expect(screen.queryByTestId('devices')).toBeNull();
	});

	it('U4 未知 slug 且 404 页给出「返回首页」裸根漏斗（不自指）', async () => {
		tenantState.data = [];
		renderAt('/nope-shoes/settings');
		const back = await screen.findByRole('link', { name: /返回|back/i });
		expect(back.getAttribute('href')).toBe('/');
	});

	it('U5 有效 slug 一切如常（不为修 404 打死旧链接）', async () => {
		tenantState.data = [{ name: 'acme-corp' }];
		renderAt('/acme-corp/settings');
		expect(await screen.findByTestId('settings')).toBeInTheDocument();
		expect(screen.queryByText('404')).toBeNull();
	});

	it('U6 根路径不受影响（无 slug 段，不进该门）', async () => {
		tenantState.data = [];
		renderAt('/settings');
		expect(await screen.findByTestId('settings')).toBeInTheDocument();
		expect(screen.queryByText('404')).toBeNull();
	});
});
