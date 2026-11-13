import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/**
 * 底栏「待审批」角标的 SSE 即时刷新回归锁：
 *   ① 审批类通知 → 立即补拉一次 pending（角标不等 15s 周期就更新）；
 *   ② 非审批通知 → 不动：pending 与「通知未读数」都不因它多发请求；
 *   ③ 2s 内同一 approval_code 两条 → 只补拉一次（防重连补发放大）；
 *   ④ 未登录（enabled=false）→ 不订阅、不发请求。
 *
 * 事件源：App.tsx 持有全站唯一 SSE 连接并广播 `autional:notification`，底栏订阅广播。
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
const NOTIFICATION_EVENT = 'autional:notification';

function pendingItem(code: string) {
	return { code, requestId: `req_${code}`, expiresIn: 120 };
}

function renderNav() {
	return render(
		<MemoryRouter initialEntries={['/']}>
			<BottomNav />
		</MemoryRouter>,
	);
}

function emit(detail: unknown) {
	act(() => {
		window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail }));
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGet.mockReset();
	mockPost.mockReset();
	mockUnreadCount.mockReset();
	authState = { isAuthenticated: true, user: { id: 'test-user' } };
	mockUnreadCount.mockResolvedValue({ unreadCount: 3 });
	mockGet.mockResolvedValue({ data: { items: [pendingItem('482913')] } });
});

afterEach(() => {
	vi.useRealTimers();
});

describe('BottomNav · 待审批角标 SSE 即时刷新', () => {
	it('审批类通知到达 → 立即补拉 pending 并更新角标（不等 15s）', async () => {
		renderNav();

		await waitFor(() => {
			expect(mockGet).toHaveBeenCalledTimes(1);
		});
		expect(screen.getByRole('button', { name: /待审批/ })).toHaveTextContent('1');

		mockGet.mockResolvedValue({
			data: { items: [pendingItem('482913'), pendingItem('482914')] },
		});
		emit({ type: 'login_approval', action_url: '/a/482914', approval_code: '482914' });

		await waitFor(() => {
			expect(mockGet).toHaveBeenCalledTimes(2);
		});
		await waitFor(() => {
			expect(screen.getByRole('button', { name: /待审批/ })).toHaveTextContent('2');
		});
	});

	it('非审批通知 → pending 与未读数都不额外请求', async () => {
		renderNav();

		await waitFor(() => {
			expect(mockGet).toHaveBeenCalledTimes(1);
		});
		expect(mockUnreadCount).toHaveBeenCalledTimes(1);

		emit({ type: 'system', title: '系统维护通知' });
		emit({ type: 'security', action_url: '/notifications', title: '新设备登录提醒' });

		await act(async () => {
			await Promise.resolve();
		});
		expect(mockGet).toHaveBeenCalledTimes(1);
		// 通知未读数仍按原 60s 节奏，不因通知流放大
		expect(mockUnreadCount).toHaveBeenCalledTimes(1);
	});

	it('2s 内同一 approval_code 两条 → 只补拉一次', async () => {
		renderNav();

		await waitFor(() => {
			expect(mockGet).toHaveBeenCalledTimes(1);
		});

		const dup = { type: 'login_approval', approval_code: '482913' };
		emit(dup);
		emit(dup);

		await waitFor(() => {
			expect(mockGet).toHaveBeenCalledTimes(2);
		});
		await act(async () => {
			await Promise.resolve();
		});
		expect(mockGet).toHaveBeenCalledTimes(2);
	});

	it('未登录 → 不订阅、不发 pending 请求（未登录必 401）', async () => {
		authState = { isAuthenticated: false };

		renderNav();
		emit({ type: 'login_approval', action_url: '/a/482913', approval_code: '482913' });

		await act(async () => {
			await Promise.resolve();
		});
		expect(mockGet).not.toHaveBeenCalled();
	});
});
