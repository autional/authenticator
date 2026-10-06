import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/**
 * AU-27/28 回归锁：login-approve 七态状态机 ——
 * 预校验先于提交面；空 token 零 POST；重试必真重试；Option A（pending 批准 = Scan → Confirm）；
 * 61000903 → precheck 收敛（不落假 error）。
 */
const mockAuthQrLoginStatus = vi.fn();
const mockAuthQrLoginScanPost = vi.fn();
const mockAuthQrLoginConfirmPost = vi.fn();
const mockAuthQrLoginCancelPost = vi.fn();

vi.mock('@autional/shared', async () => {
	const actual = await vi.importActual('@autional/shared');
	return {
		...actual,
		GeneratedApi: {
			authQrLoginStatus: (...args: unknown[]) => mockAuthQrLoginStatus(...args),
			authQrLoginScanPost: (...args: unknown[]) => mockAuthQrLoginScanPost(...args),
			authQrLoginConfirmPost: (...args: unknown[]) => mockAuthQrLoginConfirmPost(...args),
			authQrLoginCancelPost: (...args: unknown[]) => mockAuthQrLoginCancelPost(...args),
		},
	};
});

import LoginApprovePage from '../login-approve/page';

const apiError = (status: number, code: string | number) =>
	({ response: { status, data: { code, title: 'errtitle' } } });

function renderPage(entry: string) {
	return render(
		<MemoryRouter initialEntries={[entry]}>
			<LoginApprovePage />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('LoginApprovePage (AU-27/28)', () => {
	it('T1 空 token：落 invalid、零 API 调用、DOM 无批准/拒绝提交面', async () => {
		renderPage('/login-approve');

		await waitFor(() => {
			expect(screen.getByText('缺少验证参数')).toBeInTheDocument();
		});
		expect(mockAuthQrLoginStatus).not.toHaveBeenCalled();
		expect(mockAuthQrLoginScanPost).not.toHaveBeenCalled();
		expect(mockAuthQrLoginConfirmPost).not.toHaveBeenCalled();
		expect(mockAuthQrLoginCancelPost).not.toHaveBeenCalled();
		expect(screen.queryByRole('button', { name: '批准登录' })).toBeNull();
		expect(screen.queryByRole('button', { name: '拒绝' })).toBeNull();
	});

	it('T2 404（61000901）→ 终态 invalid：notFoundDesc、无重试、无提交面', async () => {
		mockAuthQrLoginStatus.mockRejectedValue(apiError(404, '61000901'));
		renderPage('/login-approve?token=t1');

		await waitFor(() => {
			expect(screen.getByText('请求不存在或已失效，请在电脑端重新发起')).toBeInTheDocument();
		});
		expect(screen.queryByText('重试')).toBeNull();
		expect(screen.queryByRole('button', { name: '批准登录' })).toBeNull();
		expect(screen.queryByRole('button', { name: '拒绝' })).toBeNull();
		expect(screen.getByText('返回首页')).toBeInTheDocument();
	});

	it('T3a 410（61000902）→ expiredDesc', async () => {
		mockAuthQrLoginStatus.mockRejectedValue(apiError(410, '61000902'));
		renderPage('/login-approve?token=t1');

		await waitFor(() => {
			expect(screen.getByText('请求已过期，请在电脑端重新发起')).toBeInTheDocument();
		});
	});

	it('T3b 状态回读 cancelled → invalid（该请求已被拒绝）；confirmed → approved', async () => {
		mockAuthQrLoginStatus.mockResolvedValueOnce({ code: 0, data: { status: 'cancelled' } });
		renderPage('/login-approve?token=t1');
		await waitFor(() => {
			expect(screen.getByText('该请求已被拒绝')).toBeInTheDocument();
		});

		mockAuthQrLoginStatus.mockResolvedValueOnce({ code: 0, data: { status: 'confirmed' } });
		renderPage('/login-approve?token=t2');
		await waitFor(() => {
			expect(screen.getByText('已批准登录')).toBeInTheDocument();
		});
	});

	it('T4 pending + Option A：批准 = Scan → Confirm 顺序链 → approved', async () => {
		const callOrder: string[] = [];
		mockAuthQrLoginStatus.mockResolvedValue({
			code: 0,
			data: { status: 'pending', numberMatching: '123456' },
		});
		mockAuthQrLoginScanPost.mockImplementation(async () => {
			callOrder.push('scan');
			return { code: 0, data: {} };
		});
		mockAuthQrLoginConfirmPost.mockImplementation(async () => {
			callOrder.push('confirm');
			return { code: 0, data: {} };
		});

		renderPage('/login-approve?token=t1&nm=123456');
		await waitFor(() => {
			expect(screen.getByRole('button', { name: '批准登录' })).toBeInTheDocument();
		});
		expect(screen.getByText('123456')).toBeInTheDocument();

		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: '批准登录' }));
		});

		await waitFor(() => {
			expect(screen.getByText('已批准登录')).toBeInTheDocument();
		});
		expect(callOrder).toEqual(['scan', 'confirm']);
	});

	it('T5 scanned：批准仅 Confirm（零 Scan）', async () => {
		mockAuthQrLoginStatus.mockResolvedValue({ code: 0, data: { status: 'scanned' } });
		mockAuthQrLoginConfirmPost.mockResolvedValue({ code: 0, data: {} });

		renderPage('/login-approve?token=t1');
		await waitFor(() => {
			expect(screen.getByRole('button', { name: '批准登录' })).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: '批准登录' }));
		});

		await waitFor(() => {
			expect(screen.getByText('已批准登录')).toBeInTheDocument();
		});
		expect(mockAuthQrLoginScanPost).not.toHaveBeenCalled();
		expect(mockAuthQrLoginConfirmPost).toHaveBeenCalledTimes(1);
	});

	it('T6 网络错误 → error 态；点「重试」→ authQrLoginStatus 真实二次调用（真重试锁）', async () => {
		mockAuthQrLoginStatus.mockRejectedValue(new Error('net'));
		renderPage('/login-approve?token=t1');

		await waitFor(() => {
			expect(screen.getByText('重试')).toBeInTheDocument();
		});
		expect(mockAuthQrLoginStatus).toHaveBeenCalledTimes(1);

		await act(async () => {
			fireEvent.click(screen.getByText('重试'));
		});
		await waitFor(() => {
			expect(mockAuthQrLoginStatus).toHaveBeenCalledTimes(2);
		});
	});

	it('T7 提交遇 61000903 → 触发 precheck 以服务端真实状态收敛（不落假 error）', async () => {
		mockAuthQrLoginStatus
			.mockResolvedValueOnce({ code: 0, data: { status: 'pending' } })
			.mockResolvedValueOnce({ code: 0, data: { status: 'cancelled' } });
		mockAuthQrLoginScanPost.mockResolvedValue({ code: 0, data: {} });
		mockAuthQrLoginConfirmPost.mockRejectedValue(apiError(409, '61000903'));

		renderPage('/login-approve?token=t1');
		await waitFor(() => {
			expect(screen.getByRole('button', { name: '批准登录' })).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: '批准登录' }));
		});

		// 收敛到服务端真实状态（cancelled → invalid），而非假 error
		await waitFor(() => {
			expect(screen.getByText('该请求已被拒绝')).toBeInTheDocument();
		});
		expect(mockAuthQrLoginStatus).toHaveBeenCalledTimes(2);
		expect(screen.queryByRole('button', { name: '批准登录' })).toBeNull();
	});
});
