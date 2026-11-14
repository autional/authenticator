import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/**
 * AU-26 回归锁：push-approve 错误态两枚真实出路 ——
 * 「重试」= 真 GET（调用计数 +1）；无 challengeId 时不给假重试；「返回首页」href="/"。
 */
const mockGetPushChallengeStatus = vi.fn();
vi.mock('../../lib/push', () => ({
	approvePushChallenge: vi.fn(),
	denyPushChallenge: vi.fn(),
	getPushChallengeStatus: (...args: unknown[]) => mockGetPushChallengeStatus(...args),
}));

import PushApprovePage from '../push-approve/page';
import { approvePushChallenge, denyPushChallenge } from '../../lib/push';

function renderPage(entry: string) {
	return render(
		<MemoryRouter initialEntries={[entry]}>
			<PushApprovePage />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('PushApprovePage (AU-26)', () => {
	it('T1 加载失败 → 错误态同时渲染「重试」「返回首页」两枚出路', async () => {
		mockGetPushChallengeStatus.mockRejectedValue(new Error('boom'));
		renderPage('/push-approve?challengeId=c1');

		await waitFor(() => {
			expect(screen.getByText('重试')).toBeInTheDocument();
		});
		expect(screen.getByText('出错了')).toBeInTheDocument();
		expect(screen.getByText('返回首页')).toBeInTheDocument();
	});

	it('T2 点「重试」→ 真实再发 getPushChallengeStatus（假重试回归锁）', async () => {
		mockGetPushChallengeStatus.mockRejectedValue(new Error('boom'));
		renderPage('/push-approve?challengeId=c1');
		await waitFor(() => expect(mockGetPushChallengeStatus).toHaveBeenCalledTimes(1));

		await act(async () => {
			fireEvent.click(screen.getByText('重试'));
		});
		await waitFor(() => expect(mockGetPushChallengeStatus).toHaveBeenCalledTimes(2));
	});

	it('T3 无 challengeId → 不渲染重试按钮（不可重试的「重试」不造假），仅返回首页', async () => {
		renderPage('/push-approve');

		await waitFor(() => {
			expect(screen.getByText('缺少验证参数')).toBeInTheDocument();
		});
		expect(screen.queryByText('重试')).toBeNull();
		expect(screen.getByText('返回首页')).toBeInTheDocument();
		expect(mockGetPushChallengeStatus).not.toHaveBeenCalled();
	});

	it('T4 返回首页链接 href="/"', async () => {
		mockGetPushChallengeStatus.mockRejectedValue(new Error('boom'));
		renderPage('/push-approve?challengeId=c1');

		await waitFor(() => expect(screen.getByText('返回首页')).toBeInTheDocument());
		expect(screen.getByText('返回首页').closest('a')).toHaveAttribute('href', '/');
	});

	it('T5 终态 approved → 「已批准登录」+ 描述（AU-25 i18n 收口回归锁）', async () => {
		mockGetPushChallengeStatus.mockResolvedValue({ status: 'approved' });
		renderPage('/push-approve?challengeId=c1');

		await waitFor(() => {
			expect(screen.getByText('已批准登录')).toBeInTheDocument();
		});
		expect(screen.getByText('您已成功批准该登录请求。')).toBeInTheDocument();
	});

	it('T6 pending 态全中文审批面（标题/上下文/核验数字/按钮，AU-25）', async () => {
		mockGetPushChallengeStatus.mockResolvedValue({
			status: 'pending',
			loginContext: 'Chrome on Windows',
			numberMatching: '482913',
		});
		renderPage('/push-approve?challengeId=c1&numberMatching=654321');

		await waitFor(() => {
			expect(screen.getByText('登录审批请求')).toBeInTheDocument();
		});
		expect(screen.getByText(/Chrome on Windows/)).toBeInTheDocument();
		expect(screen.getByText('核验数字')).toBeInTheDocument();
		expect(screen.getByText('482913')).toBeInTheDocument();
		expect(screen.getByText('批准')).toBeInTheDocument();
		expect(screen.getByText('拒绝')).toBeInTheDocument();
	});

	it('T6b 伪造链接回归锁：核验数字只认服务端返回，URL 里的 numberMatching 一律不显示', async () => {
		mockGetPushChallengeStatus.mockResolvedValue({
			status: 'pending',
			loginContext: 'Chrome on Windows',
			numberMatching: '482913',
		});
		// 攻击者把自己挑战的码塞进链接：受害者页面绝不能显示它
		renderPage('/push-approve?challengeId=c1&numberMatching=654321');

		await waitFor(() => {
			expect(screen.getByText('482913')).toBeInTheDocument();
		});
		expect(screen.queryByText('654321')).toBeNull();
	});

	it('T6c 服务端无 numberMatching → 不渲染核验数字区块（也不回落到 URL 参数）', async () => {
		mockGetPushChallengeStatus.mockResolvedValue({
			status: 'pending',
			loginContext: 'Chrome on Windows',
		});
		renderPage('/push-approve?challengeId=c1&numberMatching=654321');

		await waitFor(() => {
			expect(screen.getByText('登录审批请求')).toBeInTheDocument();
		});
		expect(screen.queryByText('核验数字')).toBeNull();
		expect(screen.queryByText('654321')).toBeNull();
	});

	it('T6d 批准回传的是「服务端下发」的核验码，URL 里的码绝不进请求', async () => {
		mockGetPushChallengeStatus.mockResolvedValue({
			status: 'pending',
			numberMatching: '482913',
		});
		renderPage('/push-approve?challengeId=c1&numberMatching=654321');

		await waitFor(() => {
			expect(screen.getByText('批准')).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(screen.getByText('批准'));
		});
		// 第二个参数必须是服务端那份码（伪造链接里的 654321 不得进请求）
		expect(approvePushChallenge).toHaveBeenCalledWith('c1', '482913');
		expect(denyPushChallenge).not.toHaveBeenCalled();
	});

	it('T6e 拒绝回传的是「服务端下发」的核验码，URL 里的码绝不进请求', async () => {
		mockGetPushChallengeStatus.mockResolvedValue({
			status: 'pending',
			numberMatching: '482913',
		});
		renderPage('/push-approve?challengeId=c1&numberMatching=654321');

		await waitFor(() => {
			expect(screen.getByText('拒绝')).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(screen.getByText('拒绝'));
		});
		expect(denyPushChallenge).toHaveBeenCalledWith('c1', '482913');
		expect(approvePushChallenge).not.toHaveBeenCalled();
	});

	it('T6f 服务端未下发核验码 → fail-closed：两按钮 disabled + 可读提示，点击零请求（不回落 URL 码）', async () => {
		mockGetPushChallengeStatus.mockResolvedValue({
			status: 'pending',
			numberMatching: '',
		});
		renderPage('/push-approve?challengeId=c1&numberMatching=654321');

		await waitFor(() => {
			expect(
				screen.getByText('未获取到服务端下发的核验数字，无法批准或拒绝，请重新打开推送通知。'),
			).toBeInTheDocument();
		});

		const approveBtn = screen.getByText('批准').closest('button');
		const denyBtn = screen.getByText('拒绝').closest('button');
		expect(approveBtn).toBeDisabled();
		expect(denyBtn).toBeDisabled();

		await act(async () => {
			if (approveBtn) fireEvent.click(approveBtn);
			if (denyBtn) fireEvent.click(denyBtn);
		});
		expect(approvePushChallenge).not.toHaveBeenCalled();
		expect(denyPushChallenge).not.toHaveBeenCalled();
	});

	it('T7 Problem 信封 i18n_key 优先 → 本地化文案，不再直出英文 title（AU2-02 / U380）', async () => {
		mockGetPushChallengeStatus.mockRejectedValue({
			response: {
				status: 404,
				data: {
					code: 61040050,
					title: 'push challenge not found',
					detail: '推送挑战未找到',
					i18n_key: 'error.push_challenge_not_found',
				},
			},
		});
		renderPage('/push-approve?challengeId=c1');

		await waitFor(() => {
			expect(screen.getByText('推送挑战未找到')).toBeInTheDocument();
		});
		expect(screen.queryByText('push challenge not found')).toBeNull();
	});

	it('T8 本地无该 i18n_key → 回落键链原文（不渲染裸 key）', async () => {
		mockGetPushChallengeStatus.mockRejectedValue({
			response: {
				status: 500,
				data: { title: 'server exploded', i18n_key: 'error.not_in_bundle' },
			},
		});
		renderPage('/push-approve?challengeId=c1');

		await waitFor(() => {
			expect(screen.getByText('server exploded')).toBeInTheDocument();
		});
		expect(screen.queryByText('error.not_in_bundle')).toBeNull();
	});

	it('T9 服务端 expired 状态 → 「推送挑战已过期」，不得伪装成已拒绝', async () => {
		mockGetPushChallengeStatus.mockResolvedValue({ status: 'expired' });
		renderPage('/push-approve?challengeId=c1');

		await waitFor(() => {
			expect(screen.getByText('推送挑战已过期')).toBeInTheDocument();
		});
		expect(screen.queryByText('已拒绝登录')).toBeNull();
		expect(screen.queryByText('已批准登录')).toBeNull();
	});

	it('T10 批准遇 409（61000903）→「已被处理或替代」+ 静默复核服务端状态（不落系统错误）', async () => {
		mockGetPushChallengeStatus.mockResolvedValue({
			status: 'pending',
			numberMatching: '482913',
		});
		vi.mocked(approvePushChallenge).mockRejectedValue({
			response: { status: 409, data: { code: 61000903 } },
		});

		renderPage('/push-approve?challengeId=c1');
		await waitFor(() => {
			expect(screen.getByText('批准')).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(screen.getByText('批准'));
		});

		await waitFor(() => {
			expect(screen.getByText('该请求已被处理或替代。')).toBeInTheDocument();
		});
		// 自动复核：mount 一次 + 409 后静默一次
		expect(mockGetPushChallengeStatus).toHaveBeenCalledTimes(2);
		expect(screen.queryByText(/系统错误/)).toBeNull();
		// 不得退化成「批准失败，请重试」这类引导反复重试的文案
		expect(screen.queryByText(/批准失败/)).toBeNull();
	});

	it('T11 批准遇 404（61000901）→「已失效或不属于当前账号」+ 静默复核', async () => {
		mockGetPushChallengeStatus.mockResolvedValue({
			status: 'pending',
			numberMatching: '482913',
		});
		vi.mocked(approvePushChallenge).mockRejectedValue({
			response: { status: 404, data: { code: 61000901 } },
		});

		renderPage('/push-approve?challengeId=c1');
		await waitFor(() => {
			expect(screen.getByText('批准')).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(screen.getByText('批准'));
		});

		await waitFor(() => {
			expect(screen.getByText('该审批请求已失效或不属于当前账号')).toBeInTheDocument();
		});
		expect(mockGetPushChallengeStatus).toHaveBeenCalledTimes(2);
	});
});
