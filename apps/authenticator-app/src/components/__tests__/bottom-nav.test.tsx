import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

/**
 * 底部导航「待审批」入口回归锁：
 *   ① 登录后渲染「待审批」项，角标 = GET login-approval/pending 的条数（0 不显示、>99 折叠为 99+）；
 *   ② 点击跳 `/approvals`（此前该页存在但无任何入口）；
 *   ③ 未登录不渲染该项、不发请求（服务端数据，未登录必 401）；
 *   ④ 拉取失败静默：入口照常渲染、无角标、不打断导航；
 *   ⑤ 轮询 15s 一次且**仅前台**（隐藏时不请求、回前台立即补拉），卸载后清理（不 setState）。
 */

const { mockGet, mockPost, mockUnreadCount } = vi.hoisted(() => ({
	mockGet: vi.fn(),
	mockPost: vi.fn(),
	mockUnreadCount: vi.fn(),
}));

let authState: { isAuthenticated: boolean; user?: { id: string } } = {
	isAuthenticated: true,
	user: { id: 'test-user' },
};

vi.mock('@autional/shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared')>()),
	useAuth: () => ({
		isAuthenticated: authState.isAuthenticated,
		user: authState.user,
	}),
	GeneratedApi: { notificationsUnreadCount: (...args: unknown[]) => mockUnreadCount(...args) },
	apiClient: {
		get: (...args: unknown[]) => mockGet(...args),
		post: (...args: unknown[]) => mockPost(...args),
	},
}));

import BottomNav from '../BottomNav';

const PENDING_PATH = '/identity/api/v1/auth/login-approval/pending';

function pendingItem(code: string) {
	return {
		code,
		requestId: `req_${code}`,
		originIp: '203.0.113.45',
		originUa: 'Mozilla/5.0',
		expiresIn: 120,
	};
}

/** 两侧都挂 BottomNav：导航后仍可断言「跳到了哪个页面」。 */
function renderNav() {
	return render(
		<MemoryRouter initialEntries={['/']}>
			<Routes>
				<Route
					path="/"
					element={
						<>
							<BottomNav />
							<div data-testid="home-stub" />
						</>
					}
				/>
				<Route
					path="/approvals"
					element={
						<>
							<BottomNav />
							<div data-testid="approvals-stub" />
						</>
					}
				/>
			</Routes>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGet.mockReset();
	mockPost.mockReset();
	mockUnreadCount.mockReset();
	authState = { isAuthenticated: true, user: { id: 'test-user' } };
	mockUnreadCount.mockResolvedValue({ unreadCount: 0 });
	mockGet.mockResolvedValue({ data: { items: [pendingItem('482913')] } });
});

afterEach(() => {
	vi.useRealTimers();
	restoreVisibility();
});

/** jsdom 的 visibilityState 只读 → 在本实例上覆写 getter；删掉自有属性即回到原型默认值 'visible'。 */
function setVisibility(state: 'visible' | 'hidden') {
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => state,
	});
}

function restoreVisibility() {
	delete (document as unknown as Record<string, unknown>).visibilityState;
}

function emitVisibilityChange() {
	document.dispatchEvent(new Event('visibilitychange'));
}

describe('BottomNav · 待审批入口', () => {
	it('登录后渲染「待审批」并用 pending 条数做角标', async () => {
		renderNav();

		expect(screen.getByRole('button', { name: /待审批/ })).toBeInTheDocument();
		await waitFor(() => {
			expect(screen.getByRole('button', { name: /待审批/ })).toHaveTextContent('1');
		});
		expect(mockGet).toHaveBeenCalledWith(PENDING_PATH);
	});

	it('角标 0 不显示、>99 折叠为 99+', async () => {
		mockGet.mockResolvedValue({ data: { items: [] } });
		const { unmount } = renderNav();
		await waitFor(() => {
			expect(mockGet).toHaveBeenCalled();
		});
		expect(screen.getByRole('button', { name: /待审批/ }).textContent).toBe('待审批');
		unmount();

		mockGet.mockResolvedValue({
			data: { items: Array.from({ length: 120 }, (_, i) => pendingItem(String(100000 + i))) },
		});
		renderNav();
		await waitFor(() => {
			expect(screen.getByRole('button', { name: /待审批/ })).toHaveTextContent('99+');
		});
	});

	it('点击「待审批」跳转 /approvals', async () => {
		renderNav();

		fireEvent.click(screen.getByRole('button', { name: /待审批/ }));

		await waitFor(() => {
			expect(screen.getByTestId('approvals-stub')).toBeInTheDocument();
		});
		expect(screen.queryByTestId('home-stub')).toBeNull();
	});

	it('未登录：不渲染入口、不请求 pending', async () => {
		authState = { isAuthenticated: false };

		renderNav();

		expect(screen.queryByRole('button', { name: /待审批/ })).toBeNull();
		expect(mockGet).not.toHaveBeenCalled();
	});

	it('pending 拉取失败静默：入口仍渲染、无角标、不报错', async () => {
		mockGet.mockRejectedValue(new Error('network down'));

		renderNav();

		await waitFor(() => {
			expect(mockGet).toHaveBeenCalledWith(PENDING_PATH);
		});
		expect(screen.getByRole('button', { name: /待审批/ }).textContent).toBe('待审批');
		// 失败不打断导航
		fireEvent.click(screen.getByRole('button', { name: /待审批/ }));
		await waitFor(() => {
			expect(screen.getByTestId('approvals-stub')).toBeInTheDocument();
		});
	});

	it('15s 轮询一次，卸载后清理（不再请求、不再 setState）', async () => {
		vi.useFakeTimers();
		const { unmount } = renderNav();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(mockGet).toHaveBeenCalledTimes(1);

		// 旧的 60s 粒度已被收紧：15s 就该再拉一次
		await act(async () => {
			await vi.advanceTimersByTimeAsync(15000);
		});
		expect(mockGet).toHaveBeenCalledTimes(2);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(15000);
		});
		expect(mockGet).toHaveBeenCalledTimes(3);

		unmount();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(180000);
		});
		expect(mockGet).toHaveBeenCalledTimes(3);
	});

	it('页面隐藏时不轮询，回到前台立即补拉一次再恢复节奏', async () => {
		vi.useFakeTimers();
		setVisibility('visible');
		renderNav();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(mockGet).toHaveBeenCalledTimes(1);

		// 切到后台：周期到点也不发请求
		setVisibility('hidden');
		await act(async () => {
			emitVisibilityChange();
			await vi.advanceTimersByTimeAsync(60000);
		});
		expect(mockGet).toHaveBeenCalledTimes(1);

		// 回前台：立即补拉一次（不等下一个周期）
		setVisibility('visible');
		await act(async () => {
			emitVisibilityChange();
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(mockGet).toHaveBeenCalledTimes(2);

		// 节奏恢复：再过一个 15s 周期又拉一次
		await act(async () => {
			await vi.advanceTimersByTimeAsync(15000);
		});
		expect(mockGet).toHaveBeenCalledTimes(3);
	});

	it('激活态对辅助技术可见：当前页 aria-current=page，其它页没有', async () => {
		renderNav();

		// 初始在 /：首页项激活
		expect(screen.getByRole('button', { name: /账户/ })).toHaveAttribute('aria-current', 'page');
		expect(screen.getByRole('button', { name: /待审批/ })).not.toHaveAttribute('aria-current');

		// 跳到 /approvals 后归属转移
		fireEvent.click(screen.getByRole('button', { name: /待审批/ }));
		await waitFor(() => {
			expect(screen.getByTestId('approvals-stub')).toBeInTheDocument();
		});
		expect(screen.getByRole('button', { name: /待审批/ })).toHaveAttribute('aria-current', 'page');
		expect(screen.getByRole('button', { name: /账户/ })).not.toHaveAttribute('aria-current');
	});
});
