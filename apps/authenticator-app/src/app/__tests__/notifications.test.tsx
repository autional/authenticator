import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
	const actual = await vi.importActual('react-router');
	return {
		...actual,
		useNavigate: () => mockNavigate,
	};
});

const {
	mockNotifications,
	mockNotificationsUnreadCount,
	mockNotificationsReadByIdPut,
	mockNotificationsReadAllPut,
} = vi.hoisted(() => ({
	mockNotifications: vi.fn().mockResolvedValue({ items: [] }),
	mockNotificationsUnreadCount: vi.fn().mockResolvedValue({ unreadCount: 0 }),
	mockNotificationsReadByIdPut: vi.fn().mockResolvedValue({}),
	mockNotificationsReadAllPut: vi.fn().mockResolvedValue({}),
}));

vi.mock('@autional/shared', async () => {
	const actual = await vi.importActual('@autional/shared');
	return {
		...actual,
		useAuthStore: {
			...(actual as unknown as { useAuthStore: Record<string, unknown> }).useAuthStore,
			getState: () => ({ user: { id: 'test-user' } }),
		},
		useAuth: () => ({
			isAuthenticated: true,
			user: { id: 'test-user', email: 'dev@example.com', username: 'testuser' },
			userId: 'test-user',
			accessToken: 'mock-token',
			currentTenantId: null,
			permissions: [],
			tenants: [],
		}),
		// NotificationsPage 通过 GeneratedApi（@autional/shared re-export）调用通知 API
		GeneratedApi: {
			notifications: mockNotifications,
			notificationsUnreadCount: mockNotificationsUnreadCount,
			notificationsReadByNotificationsPut: mockNotificationsReadByIdPut,
			notificationsReadAllPut: mockNotificationsReadAllPut,
		},
	};
});

vi.mock('@/components/BottomNav', () => ({
	default: () => <div data-testid="bottom-nav" />,
}));

import NotificationsPage from '../notifications/page';
import i18n from '../../i18n';

function renderNotifications() {
	return render(
		<MemoryRouter initialEntries={['/notifications']}>
			<NotificationsPage />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(async () => {
	await i18n.changeLanguage('zh-CN');
});

describe('NotificationsPage', () => {
	it('renders header "通知中心" and "刷新" button', async () => {
		renderNotifications();
		expect(screen.getByText('通知中心')).toBeInTheDocument();
		expect(screen.getByLabelText('刷新')).toBeInTheDocument();
	});

	it('renders filter tabs: 全部, 未读, 已读', async () => {
		renderNotifications();
		expect(screen.getByText('全部')).toBeInTheDocument();
		expect(screen.getByText('未读')).toBeInTheDocument();
		expect(screen.getByText('已读')).toBeInTheDocument();
	});

	it('shows "暂无通知" when empty', async () => {
		renderNotifications();
		await waitFor(() => {
			expect(screen.getByText('暂无通知')).toBeInTheDocument();
		});
	});

	it('bottom nav is present', async () => {
		renderNotifications();
		expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
	});

	it('"返回" button navigates back', async () => {
		renderNotifications();
		const backBtn = screen.getByLabelText('返回');
		await act(async () => {
			fireEvent.click(backBtn);
		});
		expect(mockNavigate).toHaveBeenCalledWith('/');
	});

	it('AU-12 未读角标读运行时键 unreadCount（3 → 头部角标 3）', async () => {
		mockNotificationsUnreadCount.mockResolvedValue({ unreadCount: 3 });
		renderNotifications();

		await waitFor(() => {
			expect(screen.getByText('3')).toBeInTheDocument();
		});
	});

	it('AU-14 未读 tab 空态 → 「暂无未读通知」（与全部 tab 空态区分）', async () => {
		renderNotifications();
		await waitFor(() => {
			expect(screen.getByText('暂无通知')).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(screen.getByText('未读'));
		});

		expect(screen.getByText('暂无未读通知')).toBeInTheDocument();
		expect(screen.queryByText('暂无通知')).toBeNull();
	});

	it('AU-11 已读且无动作条目渲染为非按钮；未读条目仍为按钮', async () => {
		mockNotifications.mockResolvedValue({
			items: [
				{ id: 'n1', title: '未读条目', isRead: false },
				{ id: 'r1', title: '已读条目', isRead: true },
			],
		});
		renderNotifications();

		await waitFor(() => {
			expect(screen.getByText('已读条目')).toBeInTheDocument();
		});
		expect(screen.getByText('已读条目').closest('button')).toBeNull();
		expect(screen.getByText('未读条目').closest('button')).not.toBeNull();
	});

	it('AU-16 日期随语言切换（en-US → Jan 5 形态；中置 UTC 防时区抖动）', async () => {
		await i18n.changeLanguage('en-US');
		mockNotifications.mockResolvedValue({
			items: [{ id: 'old', title: '旧通知', isRead: true, createdAt: '2026-01-05T12:00:00Z' }],
		});
		renderNotifications();

		await waitFor(() => {
			expect(screen.getByText('Jan 5')).toBeInTheDocument();
		});
	});
});

describe('NotificationsPage AU-13 分页（加载更多）', () => {
	function mockTwoPages() {
		// total=60 > PAGE_SIZE=50：page=1 时 hasMore=true，page=2 时 hasMore=false
		mockNotifications.mockImplementation((params?: { page?: number }) => {
			if (params?.page === 2) {
				return Promise.resolve({
					items: [
						{ id: 'n2', title: '重复条目', isRead: true },
						{ id: 'n3', title: '第二页条目', isRead: true },
					],
					total: 60,
					pagination: { page: 2, pageSize: 50, total: 60, hasNext: false, hasPrev: true },
				});
			}
			return Promise.resolve({
				items: [
					{ id: 'n1', title: '第一页条目', isRead: true },
					{ id: 'n2', title: '重复条目', isRead: true },
				],
				total: 60,
				pagination: { page: 1, pageSize: 50, total: 60, hasNext: true, hasPrev: false },
			});
		});
	}

	it('① 初始仅取 page=1，页尾显进度与「加载更多」', async () => {
		mockTwoPages();
		renderNotifications();

		await waitFor(() => {
			expect(screen.getByText('第一页条目')).toBeInTheDocument();
		});
		expect(mockNotifications).toHaveBeenCalledTimes(1);
		expect(mockNotifications).toHaveBeenCalledWith({ page: 1, page_size: 50 });
		expect(screen.getByText('已加载 2/60 条')).toBeInTheDocument();
		expect(screen.getByText('加载更多')).toBeInTheDocument();
		expect(screen.queryByText('没有更多了')).toBeNull();
	});

	it('② 点「加载更多」→ 取 page=2、追加渲染并按 id 去重、到底显「没有更多了」', async () => {
		mockTwoPages();
		renderNotifications();
		await waitFor(() => {
			expect(screen.getByText('第一页条目')).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(screen.getByText('加载更多'));
		});

		expect(mockNotifications).toHaveBeenLastCalledWith({ page: 2, page_size: 50 });
		expect(screen.getByText('第二页条目')).toBeInTheDocument();
		expect(screen.getAllByText('重复条目')).toHaveLength(1);
		expect(screen.getByText('已加载 3/60 条')).toBeInTheDocument();
		expect(screen.queryByText('加载更多')).toBeNull();
		expect(screen.getByText('没有更多了')).toBeInTheDocument();
	});

	it('⑤ 刷新重置回 page=1 并丢弃已追加页', async () => {
		mockTwoPages();
		renderNotifications();
		await waitFor(() => {
			expect(screen.getByText('第一页条目')).toBeInTheDocument();
		});
		await act(async () => {
			fireEvent.click(screen.getByText('加载更多'));
		});
		expect(screen.getByText('第二页条目')).toBeInTheDocument();

		await act(async () => {
			fireEvent.click(screen.getByLabelText('刷新'));
		});

		expect(mockNotifications).toHaveBeenLastCalledWith({ page: 1, page_size: 50 });
		expect(screen.queryByText('第二页条目')).toBeNull();
		expect(screen.getByText('已加载 2/60 条')).toBeInTheDocument();
	});
});
