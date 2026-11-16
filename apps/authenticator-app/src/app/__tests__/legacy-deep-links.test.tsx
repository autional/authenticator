import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, Navigate } from 'react-router';

/**
 * BLK-29 回归锁（旧链接必须仍然重定向）。
 *
 * 两类旧链接：
 *  1. B3 之前的「本地模式」路径 `/local/xxx` → `/xxx`（`/local/devices`、`/local/settings` 是 QA 报点）；
 *  2. 推送深链 `/{slug?}/notification/api/v1/{push-approve|notifications}` → 新路径
 *     （旧推送通知/书签里就是这个形态；带 slug 前缀的那条是登录态用户真实会拿到的形态）。
 *
 * 这两类都必须「命中即 302 到新路径」（query/hash 保留），不得落到 404 或停在原地。
 * 走真实 `LayoutWrapper` + 真实 `LocalRedirect`/`LegacyRedirect`，只 mock 掉会发网络的
 * 品牌初始化与公开租户名单（其它逻辑全 actual）。
 */

const tenantState: {
	data: Array<{ name?: string | null; slug?: string | null }> | undefined;
	isLoading: boolean;
} = { data: [{ name: 'acme-corp' }], isLoading: false };

vi.mock('@autional/shared', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@autional/shared')>();
	return {
		...actual,
		BrandingInitializer: () => null,
		usePublicTenantSlugs: () => ({ data: tenantState.data, isLoading: tenantState.isLoading }),
	};
});

import { LayoutWrapper, LocalRedirect, legacyLocalTarget } from '../../App';

afterEach(() => {
	document.body.innerHTML = '';
});

function LocationProbe() {
	const { pathname, search, hash } = useLocation();
	return <div data-testid="loc">{`${pathname}|${search}|${hash}`}</div>;
}

/** 与 App.tsx 同形的顶层结构（/local/* 在前；/ 与 /:tenantSlug/* 共享同一批子路由）。 */
function renderAt(entry: string) {
	return render(
		<MemoryRouter initialEntries={[entry]}>
			<LocationProbe />
			<Routes>
				<Route path="/local/*" element={<LocalRedirect />} />
				<Route path="/" element={<LayoutWrapper />}>
					{legacyRoutes()}
				</Route>
				<Route path="/:tenantSlug/*" element={<LayoutWrapper />}>
					{legacyRoutes()}
				</Route>
				<Route path="*" element={<div data-testid="top-miss">TOP MISS</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

function LegacyRedirect({ to }: { to: string }) {
	const { search, hash } = useLocation();
	// 与 App.tsx 的 LegacyRedirect 同形（保留 query/hash，replace）
	return <Navigate to={`${to}${search}${hash}`} replace />;
}

function legacyRoutes() {
	return (
		<>
			<Route index element={<div data-testid="home">HOME</div>} />
			<Route path="settings" element={<div data-testid="settings">SETTINGS</div>} />
			<Route path="devices" element={<div data-testid="devices">DEVICES</div>} />
			<Route path="push-approve" element={<div data-testid="push">PUSH</div>} />
			<Route path="notifications" element={<div data-testid="notifs">NOTIFS</div>} />
			<Route path="notification/api/v1/push-approve" element={<LegacyRedirect to="/push-approve" />} />
			<Route path="notification/api/v1/notifications" element={<LegacyRedirect to="/notifications" />} />
			<Route path="*" element={<div data-testid="miss">MISS</div>} />
		</>
	);
}

describe('BLK-29 · /local/* 旧路径', () => {
	it('L1 /local/devices → /devices', async () => {
		renderAt('/local/devices');
		expect(await screen.findByTestId('devices')).toBeInTheDocument();
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/devices||'));
	});

	it('L2 /local/settings → /settings（含 query/hash 保留）', async () => {
		renderAt('/local/settings?tab=security#top');
		expect(await screen.findByTestId('settings')).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.getByTestId('loc').textContent).toBe('/settings|?tab=security|#top'),
		);
	});

	it('L3 映射规则本身（纯函数）', () => {
		expect(legacyLocalTarget('/local/devices')).toBe('/devices');
		expect(legacyLocalTarget('/local/settings', '?a=1', '#b')).toBe('/settings?a=1#b');
		expect(legacyLocalTarget('/local')).toBe('/');
	});
});

describe('BLK-29 · 旧推送深链', () => {
	it('P1 /notification/api/v1/push-approve?code=abc → /push-approve?code=abc（query 保留）', async () => {
		renderAt('/notification/api/v1/push-approve?code=abc');
		expect(await screen.findByTestId('push')).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.getByTestId('loc').textContent).toBe('/push-approve|?code=abc|'),
		);
	});

	it('P2 /notification/api/v1/notifications → /notifications', async () => {
		renderAt('/notification/api/v1/notifications');
		expect(await screen.findByTestId('notifs')).toBeInTheDocument();
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/notifications||'));
	});

	it('P3 带租户前缀的推送深链（登录态用户真实形态）→ 同样重定向', async () => {
		renderAt('/acme-corp/notification/api/v1/push-approve?code=xyz');
		expect(await screen.findByTestId('push')).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.getByTestId('loc').textContent).toBe('/push-approve|?code=xyz|'),
		);
		expect(screen.queryByText('404')).toBeNull();
	});
});
