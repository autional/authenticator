import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet, useParams } from 'react-router';
import { TenantSlugProvider } from '@autional/shared';

/**
 * AU-30 回归锁：TenantSlugGate —— 未知 slug 子路由禁渲染真实页。
 * 半剥 mock：仅替换 usePublicTenantSlugs，其余 shared 导出走 actual。
 */
const mockPublicTenants = vi.hoisted(() => ({
	value: {
		data: undefined as Array<{ name?: string; slug?: string }> | undefined,
		isLoading: false,
	},
}));

vi.mock('@autional/shared', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@autional/shared')>();
	return {
		...actual,
		usePublicTenantSlugs: () => mockPublicTenants.value,
	};
});

import TenantSlugGate from '../../components/TenantSlugGate';

function renderGate(initialEntry: string) {
	return render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<Routes>
				<Route
					path="/:tenantSlug"
					element={
						<TenantSlugGate notFound={<div data-testid="not-found">404</div>}>
							<div data-testid="children">CHILD</div>
						</TenantSlugGate>
					}
				/>
			</Routes>
		</MemoryRouter>,
	);
}

/** T5 集成树：镜像 App.tsx LayoutWrapper（Provider + Gate + Outlet）。 */
function TestLayout() {
	const { tenantSlug } = useParams();
	return (
		<TenantSlugProvider value={tenantSlug}>
			<TenantSlugGate notFound={<div data-testid="not-found">404</div>}>
				<Outlet />
			</TenantSlugGate>
		</TenantSlugProvider>
	);
}

function renderTree(initialEntry: string) {
	return render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<Routes>
				<Route path="/:tenantSlug" element={<TestLayout />}>
					<Route path="settings" element={<div data-testid="settings-page">SETTINGS</div>} />
				</Route>
			</Routes>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	mockPublicTenants.value = { data: undefined, isLoading: false };
});

describe('TenantSlugGate (AU-30)', () => {
	it('T1 合法 slug（name 或 slug 命中名单）→ children 渲染', () => {
		mockPublicTenants.value = {
			data: [{ name: 'acme-corp' }, { slug: 'beta-corp' }],
			isLoading: false,
		};
		renderGate('/acme-corp');
		expect(screen.getByTestId('children')).toBeInTheDocument();
		expect(screen.queryByTestId('not-found')).toBeNull();

		cleanup();
		renderGate('/beta-corp');
		expect(screen.getByTestId('children')).toBeInTheDocument();
		expect(screen.queryByTestId('not-found')).toBeNull();
	});

	it('T2 非法 slug + 非空名单 → notFound 渲染，且 children 零渲染（核心锁）', () => {
		mockPublicTenants.value = { data: [{ name: 'acme-corp' }], isLoading: false };
		renderGate('/xxx-not-exist');
		expect(screen.getByTestId('not-found')).toBeInTheDocument();
		expect(screen.queryByTestId('children')).toBeNull();
	});

	/**
	 * T3 口径反转（BLK-29，2026-11-16）：原断言是「名单为空 → fail-open 放行」。
	 * 实测后果是 QA 报的「未知 slug 落到真实页/空壳」（`/nope-shoes/settings` 能渲染设置页），
	 * 因为「名单为空」与「slug 未知」在客户端无法区分。现改为**名单为权威**：
	 * 拿不到名单就不再假装它存在 ⇒ 404。
	 * 取舍：名单 API 故障期，旧链接形态 `/:slug/...` 会 404（页内有「返回首页」裸根漏斗）；
	 *       根路径（`/settings` …）没有 slug 段，不进此门，故障期照常渲染。
	 */
	it('T3 名单为空（API 故障）→ 不再 fail-open，按未知 slug 出 404', () => {
		mockPublicTenants.value = { data: [], isLoading: false };
		renderGate('/xxx-not-exist');
		expect(screen.getByTestId('not-found')).toBeInTheDocument();
		expect(screen.queryByTestId('children')).toBeNull();
	});

	it('T3b 名单拿不到（undefined 且非加载中）→ 同样 404，不渲染真实页', () => {
		mockPublicTenants.value = { data: undefined, isLoading: false };
		renderGate('/xxx-not-exist');
		expect(screen.getByTestId('not-found')).toBeInTheDocument();
		expect(screen.queryByTestId('children')).toBeNull();
	});

	it('T4 加载期 → 骨架占位，真实页不泄出', () => {
		mockPublicTenants.value = { data: undefined, isLoading: true };
		renderGate('/whatever');
		expect(screen.getByText('页面加载中...')).toBeInTheDocument();
		expect(screen.queryByTestId('children')).toBeNull();
	});

	it('T5 集成 /:tenantSlug/settings：非法 slug 设置页零渲染；合法 slug 设置页正常', () => {
		mockPublicTenants.value = { data: [{ name: 'acme-corp' }], isLoading: false };

		renderTree('/xxx-not-exist/settings');
		expect(screen.queryByTestId('settings-page')).toBeNull();
		expect(screen.getByTestId('not-found')).toBeInTheDocument();

		cleanup();
		renderTree('/acme-corp/settings');
		expect(screen.getByTestId('settings-page')).toBeInTheDocument();
		expect(screen.queryByTestId('not-found')).toBeNull();
	});
});
