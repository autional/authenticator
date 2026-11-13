import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

/**
 * 登录审批（App 侧）回归锁：
 *   ① `/approvals` 从 pending 渲染审批码 + 打码来源，approve 成功后该项从列表移除；
 *   ② `/a/:code` 的码不是 6 位数字 → 直接终态「链接无效」，零请求；
 *   ③ `/a/:code` 命中自己名下的待审批 → 复用同一张审批卡片；
 *   ④ 卡片展示位置（geo_city → geoCity），空/缺失即不渲染；
 *   ⑤ `/approvals` 前台每 15s 静默自动刷新：不闪 loading、失败不清空列表、不可见时暂停。
 *
 * 安全取向：URL 里的码只用于「挑出这一条」，不构成任何判定依据。
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

vi.mock('@/components/BottomNav', () => ({
	default: () => <div data-testid="bottom-nav" />,
}));

import ApprovalsPage from '../approvals/page';
import ApprovalLinkPage from '../a/page';
import ApprovalCard from '../../components/ApprovalCard';
import type { PendingApproval } from '../../lib/login-approval';

const PENDING_PATH = '/identity/api/v1/auth/login-approval/pending';

const pendingItem = {
	code: '482913',
	requestId: 'req_1',
	originIp: '203.0.113.45',
	originUa: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131',
	expiresIn: 120,
	createdAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
	vi.clearAllMocks();
	mockGet.mockReset();
	mockPost.mockReset();
	mockGet.mockResolvedValue({ data: { items: [pendingItem] } });
	mockPost.mockResolvedValue({ data: {}, status: 200 });
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

function renderApprovalsPage() {
	return render(
		<MemoryRouter initialEntries={['/approvals']}>
			<ApprovalsPage />
		</MemoryRouter>,
	);
}

describe('/approvals', () => {
	it('渲染 pending：审批码 + 打码来源；批准后从列表移除', async () => {
		render(
			<MemoryRouter initialEntries={['/approvals']}>
				<ApprovalsPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('approval-card-482913')).toBeInTheDocument();
		});
		// 回归锁：本页是底栏一级入口，必须同时有粘顶标题栏与底部导航（曾漏渲染 BottomNav）
		expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument();
		expect(mockGet).toHaveBeenCalledWith(PENDING_PATH);
		expect(screen.getByTestId('approval-code')).toHaveTextContent('482913');
		// IP 打码（保留前 3 段），UA 截断
		expect(screen.getByTestId('approval-origin').textContent).toContain('203.0.113.*');
		expect(screen.getByTestId('approval-origin').textContent).toContain('…');

		fireEvent.click(screen.getByRole('button', { name: "是我" }));

		await waitFor(() => {
			expect(mockPost).toHaveBeenCalledWith(
				'/identity/api/v1/auth/login-approval/by-code/482913/approve',
			);
		});
		await waitFor(() => {
			expect(screen.queryByTestId('approval-card-482913')).toBeNull();
		});
		expect(screen.getByText('暂无待审批的登录请求')).toBeInTheDocument();
	});

	it('拒绝走 deny 端点，失败时按接口错误提示且不移除', async () => {
		mockPost.mockRejectedValue({
			response: { status: 410, data: { message: 'request expired' } },
		});

		render(
			<MemoryRouter initialEntries={['/approvals']}>
				<ApprovalsPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('approval-card-482913')).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole('button', { name: '不是我' }));

		await waitFor(() => {
			expect(mockPost).toHaveBeenCalledWith(
				'/identity/api/v1/auth/login-approval/by-code/482913/deny',
			);
		});
		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeInTheDocument();
		});
		// 失败不静默移除（用户要能看到「没成功」）
		expect(screen.getByTestId('approval-card-482913')).toBeInTheDocument();
	});

	it('过期项不展示（expires_in ≤ 0 直接过滤）', async () => {
		mockGet.mockResolvedValue({
			data: { items: [{ ...pendingItem, code: '111111', expiresIn: 0 }] },
		});

		render(
			<MemoryRouter initialEntries={['/approvals']}>
				<ApprovalsPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('暂无待审批的登录请求')).toBeInTheDocument();
		});
		expect(screen.queryByTestId('approval-card-111111')).toBeNull();
	});
});

describe('/approvals 自动刷新（前台 15s · 静默）', () => {
	it('可见时每 15s 重拉一次，且不闪 loading（列表内容持续存在）', async () => {
		vi.useFakeTimers();
		setVisibility('visible');
		renderApprovalsPage();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(mockGet).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId('approval-card-482913')).toBeInTheDocument();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(15000);
		});
		expect(mockGet).toHaveBeenCalledTimes(2);
		// 静默刷新：卡片一直在、没有 loading 文案闪现
		expect(screen.getByTestId('approval-card-482913')).toBeInTheDocument();
		expect(screen.queryByText('正在读取待审批请求…')).toBeNull();
	});

	it('页面不可见时不刷新；回到前台立即补拉一次', async () => {
		vi.useFakeTimers();
		setVisibility('hidden');
		renderApprovalsPage();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		// 进入页面本身仍拉一次（用户就是要看数据），随后暂停
		expect(mockGet).toHaveBeenCalledTimes(1);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(60000);
		});
		expect(mockGet).toHaveBeenCalledTimes(1);

		setVisibility('visible');
		await act(async () => {
			emitVisibilityChange();
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(mockGet).toHaveBeenCalledTimes(2);
	});

	it('自动刷新失败静默：不清空已有列表、不弹全局错误', async () => {
		vi.useFakeTimers();
		setVisibility('visible');
		renderApprovalsPage();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(screen.getByTestId('approval-card-482913')).toBeInTheDocument();

		mockGet.mockRejectedValue(new Error('network down'));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(15000);
		});

		expect(screen.getByTestId('approval-card-482913')).toBeInTheDocument();
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.queryByText('加载待审批请求失败')).toBeNull();
	});
});

describe('ApprovalCard 上下文信号徽标（known_device / familiar_network）', () => {
	const renderCard = (overrides: Partial<PendingApproval> = {}) =>
		render(
			<ApprovalCard
				item={{ ...pendingItem, ...overrides }}
				onResolved={vi.fn()}
				onExpired={vi.fn()}
			/>,
		);

	it('true/true → 常用设备 + 常用网络（无「新」徽标）', () => {
		renderCard({ knownDevice: true, familiarNetwork: true });

		expect(screen.getByTestId('approval-signal-device')).toHaveTextContent('常用设备');
		expect(screen.getByTestId('approval-signal-network')).toHaveTextContent('常用网络');
		expect(screen.queryByText('新设备')).toBeNull();
		expect(screen.queryByText('新网络')).toBeNull();
	});

	it('false/false → 新设备 + 新网络（警示语义，仍带文字）', () => {
		renderCard({ knownDevice: false, familiarNetwork: false });

		expect(screen.getByTestId('approval-signal-device')).toHaveTextContent('新设备');
		expect(screen.getByTestId('approval-signal-network')).toHaveTextContent('新网络');
		expect(screen.queryByText('常用设备')).toBeNull();
		expect(screen.queryByText('常用网络')).toBeNull();
	});

	it('null/null → 一个徽标都不渲染（不显示「未知」、不占位）', () => {
		renderCard({ knownDevice: null, familiarNetwork: null });

		expect(screen.queryByTestId('approval-signals')).toBeNull();
		expect(screen.queryByTestId('approval-signal-device')).toBeNull();
		expect(screen.queryByTestId('approval-signal-network')).toBeNull();
		expect(screen.queryByText('常用设备')).toBeNull();
		expect(screen.queryByText('新设备')).toBeNull();
		expect(screen.queryByText('常用网络')).toBeNull();
		expect(screen.queryByText('新网络')).toBeNull();
	});

	it('混合（true / null）→ 只渲染可判定的那一个', () => {
		renderCard({ knownDevice: true, familiarNetwork: null });

		expect(screen.getByTestId('approval-signal-device')).toHaveTextContent('常用设备');
		expect(screen.queryByTestId('approval-signal-network')).toBeNull();
		expect(screen.queryByText('常用网络')).toBeNull();
		expect(screen.queryByText('新网络')).toBeNull();
	});

	it('字段缺失（旧版后端未下发）→ 等同于 null，不渲染徽标', () => {
		renderCard();

		expect(screen.queryByTestId('approval-signals')).toBeNull();
		expect(screen.queryByText('常用设备')).toBeNull();
		expect(screen.queryByText('新设备')).toBeNull();
	});
});

describe('ApprovalCard 位置展示（geo_city → geoCity）', () => {
	const renderCard = (overrides: Partial<PendingApproval> = {}) =>
		render(
			<ApprovalCard
				item={{ ...pendingItem, ...overrides }}
				onResolved={vi.fn()}
				onExpired={vi.fn()}
			/>,
		);

	it('有城市 → 单独一行渲染该城市（不与来源挤同一行）', () => {
		renderCard({ geoCity: '广东 深圳' });

		expect(screen.getByTestId('approval-location')).toHaveTextContent('广东 深圳');
		// 独立成行：位置不落进「来源」那一行，避免窄屏换行错乱
		expect(screen.getByTestId('approval-origin').textContent).not.toContain('广东 深圳');
	});

	it('空串 / 纯空白 → 不渲染位置行（也不显示「未知」）', () => {
		const { unmount } = renderCard({ geoCity: '' });
		expect(screen.queryByTestId('approval-location')).toBeNull();
		unmount();

		const second = renderCard({ geoCity: '   ' });
		expect(screen.queryByTestId('approval-location')).toBeNull();
		second.unmount();
	});

	it('字段缺失（旧版后端未下发）→ 不渲染位置行', () => {
		renderCard();

		expect(screen.queryByTestId('approval-location')).toBeNull();
	});
});

function renderLink(entry: string) {
	return render(
		<MemoryRouter initialEntries={[entry]}>
			<Routes>
				<Route path="/a/:code" element={<ApprovalLinkPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('/a/:code 短链落地', () => {
	it('码不是 6 位数字 → 终态「链接无效」，且零请求', async () => {
		renderLink('/a/abc12');

		await waitFor(() => {
			expect(screen.getByText('链接无效')).toBeInTheDocument();
		});
		expect(mockGet).not.toHaveBeenCalled();
		expect(screen.queryByRole('button', { name: '是我' })).toBeNull();
	});

	it('拉取后找不到该码 → 终态「请求已失效」（不改画成可批准卡片）', async () => {
		renderLink('/a/999999');

		await waitFor(() => {
			expect(screen.getByText('请求已失效')).toBeInTheDocument();
		});
		expect(screen.queryByRole('button', { name: '是我' })).toBeNull();
	});

	it('命中自己名下的待审批 → 复用同一张审批卡片', async () => {
		renderLink('/a/482913');

		await waitFor(() => {
			expect(screen.getByTestId('approval-card-482913')).toBeInTheDocument();
		});
		expect(screen.getByRole('button', { name: '是我' })).toBeInTheDocument();
	});
});
