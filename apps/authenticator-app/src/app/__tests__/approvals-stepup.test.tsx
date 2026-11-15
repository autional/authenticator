import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/**
 * step_up（高风险审批的「额外确认」门，ADR-025 P1-t1-2）回归锁：
 *   ① 待审批列表：`requires_step_up=true` 的行**不渲染审批码**，改为渲染桌面码输入框
 *      （占位「输入电脑上显示的 6 位码」+ 提示「请核对电脑屏幕」），未满 6 位「是我」不可点；
 *   ② 提交：这类行有 request_id → 走 by-request-id 且 body = {confirm_code}；
 *   ③ 错误映射：403 的两种情形（缺码 / 错码）各自出文案，且**卡片保留**（pending 未消耗，可改码重试）；
 *   ④ 普通行零变化：不出现输入框、仍一键批准（老后端 by-code 无 body 逐字不变）；
 *   ⑤ 拒绝：服务端只有 by-code/:code/deny，step_up 行用用户手输的桌面码定位。
 *
 * 为什么必须锁「保留卡片」：403 是「还差一步证明」而不是「这条没了」——
 * 误把卡片移除会让用户既看不到也没法补救，而服务端那条 pending 还在。
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
import ApprovalCard from '../../components/ApprovalCard';
import { showToast } from '@autional/ui';
import type { PendingApproval } from '../../lib/login-approval';

const PENDING_PATH = '/identity/api/v1/auth/login-approval/pending';
const APPROVE_BY_REQUEST_ID = '/identity/api/v1/auth/login-approval/req-stepup/approve';
const APPROVE_BY_CODE = '/identity/api/v1/auth/login-approval/by-code/482913/approve';

/** step_up 行：服务端不下发 code（键缺失，omitempty） */
const stepUpItem = {
	requestId: 'req-stepup',
	originIp: '203.0.113.45',
	originUa: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
	expiresIn: 120,
	requiresStepUp: true,
};

/** 普通行（新契约在位：requires_step_up=false，有码） */
const normalItem = {
	code: '482913',
	requestId: 'req-normal',
	expiresIn: 120,
	requiresStepUp: false,
};

beforeEach(() => {
	vi.clearAllMocks();
	mockGet.mockReset();
	mockPost.mockReset();
	mockGet.mockResolvedValue({ data: { items: [stepUpItem] } });
	mockPost.mockResolvedValue({ data: {}, status: 200 });
});

afterEach(() => {
	vi.useRealTimers();
});

function renderApprovals() {
	return render(
		<MemoryRouter initialEntries={['/approvals']}>
			<ApprovalsPage />
		</MemoryRouter>,
	);
}

const confirmInput = () => screen.getByTestId('approval-confirm-input');
const approveButton = () => screen.getByRole('button', { name: '是我' });
const denyButton = () => screen.getByRole('button', { name: '不是我' });

describe('step_up 行渲染（不渲染码 · 改渲染桌面码输入框）', () => {
	it('无审批码大字；有输入框 + 占位 + 核对提示；未满 6 位「是我」不可点', async () => {
		renderApprovals();

		await waitFor(() => {
			expect(screen.getByTestId('approval-card-req-stepup')).toBeInTheDocument();
		});
		// 该行的码只在桌面屏幕上 —— App 侧绝不渲染
		expect(screen.queryByTestId('approval-code')).toBeNull();
		expect(screen.getByTestId('approval-stepup')).toBeInTheDocument();
		expect(confirmInput()).toHaveAttribute('placeholder', '输入电脑上显示的 6 位码');
		expect(screen.getByTestId('approval-stepup-hint')).toHaveTextContent('请核对电脑屏幕');
		// 输入框有可访问名（label 关联），a11y 不靠 placeholder 单独表意
		expect(screen.getByLabelText('额外确认')).toBe(confirmInput());

		expect(approveButton()).toBeDisabled();

		fireEvent.change(confirmInput(), { target: { value: '123' } });
		expect(approveButton()).toBeDisabled();

		fireEvent.change(confirmInput(), { target: { value: '123456' } });
		expect(approveButton()).toBeEnabled();
	});

	it('输入只接受数字、最多 6 位（粘贴带字母/超长被清洗）', async () => {
		renderApprovals();
		await waitFor(() => {
			expect(screen.getByTestId('approval-card-req-stepup')).toBeInTheDocument();
		});

		fireEvent.change(confirmInput(), { target: { value: '12ab34567' } });
		expect(confirmInput()).toHaveValue('123456');
	});
});

describe('step_up 行提交（by-request-id + confirm_code）', () => {
	it('输入 6 位后「是我」→ POST /login-approval/:request_id/approve，body 带 confirm_code', async () => {
		renderApprovals();
		await waitFor(() => {
			expect(screen.getByTestId('approval-card-req-stepup')).toBeInTheDocument();
		});

		fireEvent.change(confirmInput(), { target: { value: '123456' } });
		fireEvent.click(approveButton());

		await waitFor(() => {
			expect(mockPost).toHaveBeenCalledWith(APPROVE_BY_REQUEST_ID, { confirm_code: '123456' });
		});
		// 成功后按稳定身份（request_id）移除该条
		await waitFor(() => {
			expect(screen.queryByTestId('approval-card-req-stepup')).toBeNull();
		});
		expect(screen.getByText('暂无待审批的登录请求')).toBeInTheDocument();
	});
});

describe('step_up 403 两种情形（各自文案 · 卡片保留可重试）', () => {
	it('缺码（i18n_key = step_up_required）→「需要额外确认」提示，卡片与输入值都保留', async () => {
		mockPost.mockRejectedValue({
			response: {
				status: 403,
				data: { code: 61002201, i18n_key: 'error.login_approval_step_up_required' },
			},
		});

		renderApprovals();
		await waitFor(() => {
			expect(screen.getByTestId('approval-card-req-stepup')).toBeInTheDocument();
		});

		fireEvent.change(confirmInput(), { target: { value: '123456' } });
		fireEvent.click(approveButton());

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent(
				'该请求需要额外确认，请输入电脑上显示的 6 位码',
			);
		});
		// 403 不是「这条没了」：卡片必须在，用户可改码重试
		expect(screen.getByTestId('approval-card-req-stepup')).toBeInTheDocument();
		expect(confirmInput()).toHaveValue('123456');
		expect(approveButton()).toBeEnabled();
	});

	it('错码（message 兜底 code mismatch）→「码不正确」提示，卡片保留且可再提交', async () => {
		mockPost.mockRejectedValueOnce({
			response: {
				status: 403,
				data: {
					code: 61002201,
					message: 'approval code mismatch, check the 6-digit code shown on the device',
				},
			},
		});

		renderApprovals();
		await waitFor(() => {
			expect(screen.getByTestId('approval-card-req-stepup')).toBeInTheDocument();
		});

		fireEvent.change(confirmInput(), { target: { value: '000000' } });
		fireEvent.click(approveButton());

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent('码不正确，请核对电脑屏幕后重试');
		});
		expect(screen.getByTestId('approval-card-req-stepup')).toBeInTheDocument();

		// 改码后可以正常重试（第二次成功 → 移除）
		fireEvent.change(confirmInput(), { target: { value: '123456' } });
		fireEvent.click(approveButton());

		await waitFor(() => {
			expect(mockPost).toHaveBeenLastCalledWith(APPROVE_BY_REQUEST_ID, {
				confirm_code: '123456',
			});
		});
		await waitFor(() => {
			expect(screen.queryByTestId('approval-card-req-stepup')).toBeNull();
		});
	});

	it('403 不得退化成「已失效 / 已被处理」这类会移除卡片的文案', async () => {
		mockPost.mockRejectedValue({
			response: {
				status: 403,
				data: { code: 61002201, i18n_key: 'error.login_approval_step_up_mismatch' },
			},
		});
		const onStale = vi.fn();

		render(
			<ApprovalCard
				item={stepUpItem as PendingApproval}
				onResolved={vi.fn()}
				onExpired={vi.fn()}
				onStale={onStale}
			/>,
		);

		fireEvent.change(confirmInput(), { target: { value: '111111' } });
		fireEvent.click(approveButton());

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent('码不正确');
		});
		expect(onStale).not.toHaveBeenCalled();
	});
});

describe('普通行零变化（无输入框 · 一键批准）', () => {
	it('新契约普通行（requires_step_up=false）→ 无输入框；一键批准走 by-request-id 且不带码', async () => {
		mockGet.mockResolvedValue({ data: { items: [normalItem] } });

		renderApprovals();
		await waitFor(() => {
			expect(screen.getByTestId('approval-card-482913')).toBeInTheDocument();
		});

		expect(screen.queryByTestId('approval-confirm-input')).toBeNull();
		expect(screen.queryByTestId('approval-stepup')).toBeNull();
		expect(screen.getByTestId('approval-code')).toHaveTextContent('482913');
		expect(approveButton()).toBeEnabled();

		fireEvent.click(approveButton());

		await waitFor(() => {
			expect(mockPost).toHaveBeenCalledWith(
				'/identity/api/v1/auth/login-approval/req-normal/approve',
				undefined,
			);
		});
	});

	it('老后端（无 requires_step_up 字段）→ 仍走 by-code 且无请求体（逐字不变）', async () => {
		mockGet.mockResolvedValue({
			data: { items: [{ code: '482913', requestId: 'req-normal', expiresIn: 120 }] },
		});

		renderApprovals();
		await waitFor(() => {
			expect(screen.getByTestId('approval-card-482913')).toBeInTheDocument();
		});

		expect(screen.queryByTestId('approval-confirm-input')).toBeNull();
		fireEvent.click(approveButton());

		await waitFor(() => {
			expect(mockPost).toHaveBeenCalledWith(APPROVE_BY_CODE);
		});
		expect(mockPost.mock.calls[0]).toHaveLength(1);
	});
});

describe('step_up 行的拒绝（服务端只有 by-code/:code/deny）', () => {
	it('「不是我」未满 6 位不可点；输码后用该码定位并拒绝', async () => {
		renderApprovals();
		await waitFor(() => {
			expect(screen.getByTestId('approval-card-req-stepup')).toBeInTheDocument();
		});

		expect(denyButton()).toBeDisabled();
		fireEvent.change(confirmInput(), { target: { value: '654321' } });
		expect(denyButton()).toBeEnabled();

		fireEvent.click(denyButton());

		await waitFor(() => {
			expect(mockPost).toHaveBeenCalledWith(
				'/identity/api/v1/auth/login-approval/by-code/654321/deny',
			);
		});
		expect(showToast).toHaveBeenCalledWith('已拒绝该登录请求', 'success');
	});

	it('绝不发出 /by-code/undefined/deny（无码是常态，不能拼出脏路径）', async () => {
		renderApprovals();
		await waitFor(() => {
			expect(screen.getByTestId('approval-card-req-stepup')).toBeInTheDocument();
		});

		fireEvent.click(denyButton());
		expect(mockPost).not.toHaveBeenCalled();
	});
});

describe('「全部拒绝」只覆盖有码的普通行', () => {
	it('step_up 行（无码）跳过，不被批量拒绝误伤也不发脏请求', async () => {
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
		mockGet.mockResolvedValue({ data: { items: [normalItem, stepUpItem] } });

		renderApprovals();
		await waitFor(() => {
			expect(screen.getByTestId('approval-card-482913')).toBeInTheDocument();
		});
		expect(screen.getByTestId('approval-card-req-stepup')).toBeInTheDocument();

		fireEvent.click(screen.getByTestId('deny-all'));

		await waitFor(() => {
			expect(screen.queryByTestId('approval-card-482913')).toBeNull();
		});
		expect(mockPost).toHaveBeenCalledTimes(1);
		expect(mockPost).toHaveBeenCalledWith(
			'/identity/api/v1/auth/login-approval/by-code/482913/deny',
		);
		// step_up 行仍在（要用户手输桌面码后单独拒绝）
		expect(screen.getByTestId('approval-card-req-stepup')).toBeInTheDocument();
		expect(showToast).toHaveBeenCalledWith('已拒绝 1 条登录请求', 'success');
		confirmSpy.mockRestore();
	});

	it('列表里只有 step_up 行 → 不渲染「全部拒绝」（没有可批量拒绝的目标）', async () => {
		mockGet.mockResolvedValue({ data: { items: [stepUpItem] } });

		renderApprovals();
		await waitFor(() => {
			expect(screen.getByTestId('approval-card-req-stepup')).toBeInTheDocument();
		});

		expect(screen.queryByTestId('deny-all')).toBeNull();
	});
});

describe('列表混合渲染', () => {
	it('普通行 + step_up 行并存：各自身份独立（request_id 与 code 不互串）', async () => {
		mockGet.mockResolvedValue({ data: { items: [normalItem, stepUpItem] } });

		renderApprovals();
		await waitFor(() => {
			expect(screen.getByTestId('approval-card-482913')).toBeInTheDocument();
		});
		expect(screen.getByTestId('approval-card-req-stepup')).toBeInTheDocument();
		// 两个输入框？只有 step_up 那一张有
		expect(screen.getAllByTestId('approval-confirm-input')).toHaveLength(1);
		expect(mockGet).toHaveBeenCalledWith(PENDING_PATH);
	});
});
