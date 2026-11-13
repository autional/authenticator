import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/**
 * `/approvals` SSE 即时刷新回归锁：
 *   ① 审批类通知（action_url=/a/<code> / approval_code / type=login_approval）→ 立即静默拉一次 pending；
 *   ② 非审批通知（system/security/email）→ 不产生任何请求（不为无关通知刷新）；
 *   ③ 2s 内同一 approval_code 两条 → 只刷新一次（防 SSE 重连补发把请求放大）；
 *   ④ 15s 轮询仍在（SSE 只是把延迟从 15s 压到「推送到达」，不是替代兜底）。
 *
 * 事件源：App.tsx 持有全站唯一 SSE 连接并广播 `autional:notification`，
 * 本页订阅广播（mock 该事件 == 模拟一次 SSE 推送到达）。
 */

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));

vi.mock('@autional/shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared')>()),
	apiClient: {
		get: (...args: unknown[]) => mockGet(...args),
		post: (...args: unknown[]) => mockPost(...args),
	},
}));

vi.mock('@autional/ui', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/ui')>()),
	showToast: vi.fn(),
}));

// 底栏在真实页面里也会订阅同一广播；这里隔离掉，只验证本页的刷新行为。
vi.mock('@/components/BottomNav', () => ({
	default: () => <div data-testid="bottom-nav" />,
}));

import ApprovalsPage from '../approvals/page';

const PENDING_PATH = '/identity/api/v1/auth/login-approval/pending';
const NOTIFICATION_EVENT = 'autional:notification';

const pendingItem = {
	code: '482913',
	requestId: 'req_1',
	originIp: '203.0.113.45',
	originUa: 'Mozilla/5.0',
	expiresIn: 120,
};

beforeEach(() => {
	vi.clearAllMocks();
	mockGet.mockReset();
	mockPost.mockReset();
	mockGet.mockResolvedValue({ data: { items: [pendingItem] } });
});

afterEach(() => {
	vi.useRealTimers();
});

function renderApprovalsPage() {
	return render(
		<MemoryRouter initialEntries={['/approvals']}>
			<ApprovalsPage />
		</MemoryRouter>,
	);
}

function emit(detail: unknown) {
	act(() => {
		window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail }));
	});
}

describe('/approvals · SSE 即时刷新', () => {
	it('审批类通知到达 → 立即再拉一次 pending（不等 15s）', async () => {
		renderApprovalsPage();

		await waitFor(() => {
			expect(mockGet).toHaveBeenCalledTimes(1);
		});
		expect(mockGet).toHaveBeenCalledWith(PENDING_PATH);

		emit({ type: 'login_approval', action_url: '/a/482913', approval_code: '482913' });

		await waitFor(() => {
			expect(mockGet).toHaveBeenCalledTimes(2);
		});
		// 静默：不闪 loading、不弹错误、不清空列表
		expect(screen.queryByText('正在读取待审批请求…')).toBeNull();
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByTestId('approval-card-482913')).toBeInTheDocument();
	});

	it('非审批通知 → 不刷新（零新增请求）', async () => {
		renderApprovalsPage();

		await waitFor(() => {
			expect(mockGet).toHaveBeenCalledTimes(1);
		});

		emit({ type: 'system', title: '系统维护通知' });
		emit({ type: 'security', action_url: '/notifications', title: '新设备登录提醒' });
		emit({ type: 'email', title: '邮箱验证' });

		// 给可能的异步触发一点时间，再断言没有新增请求
		await act(async () => {
			await Promise.resolve();
		});
		expect(mockGet).toHaveBeenCalledTimes(1);
	});

	it('2s 内同一 approval_code 两条 → 只刷新一次', async () => {
		renderApprovalsPage();

		await waitFor(() => {
			expect(mockGet).toHaveBeenCalledTimes(1);
		});

		const dup = { type: 'login_approval', action_url: '/a/482913', approval_code: '482913' };
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

	it('15s 轮询兜底仍在（SSE 不替代轮询）', async () => {
		vi.useFakeTimers();
		renderApprovalsPage();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(mockGet).toHaveBeenCalledTimes(1);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(15000);
		});
		expect(mockGet).toHaveBeenCalledTimes(2);
	});
});
