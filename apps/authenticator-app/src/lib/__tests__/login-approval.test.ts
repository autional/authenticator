import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 审批动作失败归类的回归锁（后端 L3a 契约：
 *   approve/deny 并发冲突 → 409 / 61000903；请求不存在或不属于当前账号 → 404 / 61000901）。
 *
 * 为什么值得单独锁：页面对 409 与 404 的**文案与出路完全不同**
 *   - 409 → 「已被处理或替代」（事实性，不是系统错误），并清掉该条 + 刷新列表
 *   - 404 → 「已失效或不属于当前账号」
 * 归类一旦退化（例如把 409 当 unknown），用户就会看到「批准失败，请重试」这种会导向
 * 无限重试的错误提示。
 *
 * step_up（ADR-025 P1-t1-2）另有两段锁：
 *   - 提交入口选择（by-request-id / by-code + confirm_code / 老后端 by-code 无 body）；
 *   - 403 两种子情形（缺码 / 错码）的判别 —— 两者共用错误码 61002201，只能靠 i18n_key / message。
 */

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));

vi.mock('@autional/shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared')>()),
	apiClient: {
		get: (...args: unknown[]) => mockGet(...args),
		post: (...args: unknown[]) => mockPost(...args),
	},
}));

import {
	approvalIdentity,
	approvePending,
	classifyApprovalFailure,
	classifyStepUpFailure,
	isValidConfirmCode,
	listPendingApprovals,
	type PendingApproval,
} from '../login-approval';

/** 生产形状：axios 拒因（拦截器解包后 code 仍在 response.data） */
const apiError = (status: number, code?: number | string) => ({
	response: { status, data: code === undefined ? { message: 'boom' } : { code, message: 'boom' } },
});

describe('classifyApprovalFailure', () => {
	it('61000903（409 conflict）→ conflict', () => {
		expect(classifyApprovalFailure(apiError(409, 61000903))).toBe('conflict');
	});

	it('61000901（404 not found）→ not_found', () => {
		expect(classifyApprovalFailure(apiError(404, 61000901))).toBe('not_found');
	});

	it('语义码可字符串化（拦截器/网关可能给 "61000903"）→ 仍判 conflict', () => {
		expect(classifyApprovalFailure(apiError(409, '61000903'))).toBe('conflict');
		expect(classifyApprovalFailure(apiError(404, '61000901'))).toBe('not_found');
	});

	it('契约未收录该码时按 HTTP 状态兜底（旧后端 / 新码先发前端）', () => {
		expect(classifyApprovalFailure(apiError(409))).toBe('conflict');
		expect(classifyApprovalFailure(apiError(404))).toBe('not_found');
	});

	it('其它错误不误判（网络错误 / 5xx / 空对象）→ other', () => {
		expect(classifyApprovalFailure(new Error('network'))).toBe('other');
		expect(classifyApprovalFailure(apiError(500, 61000999))).toBe('other');
		expect(classifyApprovalFailure(undefined)).toBe('other');
		expect(classifyApprovalFailure({})).toBe('other');
	});

	it('410（过期）不属于 conflict/not_found —— 保持既有「按接口文案提示」行为', () => {
		expect(classifyApprovalFailure(apiError(410, 61000902))).toBe('other');
	});
});

describe('classifyStepUpFailure（403 两种子情形，共用错误码 61002201）', () => {
	const stepUpError = (data: Record<string, unknown>) => ({
		response: { status: 403, data: { code: 61002201, ...data } },
	});

	it('i18n_key 优先：step_up_required → 缺码', () => {
		expect(
			classifyStepUpFailure(stepUpError({ i18n_key: 'error.login_approval_step_up_required' })),
		).toBe('step_up_required');
	});

	it('i18n_key 优先：step_up_mismatch → 错码（拦截器 camel 化后的 i18nKey 也认）', () => {
		expect(
			classifyStepUpFailure(stepUpError({ i18nKey: 'error.login_approval_step_up_mismatch' })),
		).toBe('step_up_mismatch');
	});

	it('无 i18n_key 时按服务端 message 兜底（旧网关不转发该字段）', () => {
		expect(
			classifyStepUpFailure(
				stepUpError({
					message:
						'login approval requires additional confirmation: enter the 6-digit code shown on the device',
				}),
			),
		).toBe('step_up_required');
		expect(
			classifyStepUpFailure(
				stepUpError({
					message: 'approval code mismatch, check the 6-digit code shown on the device',
				}),
			),
		).toBe('step_up_mismatch');
	});

	it('非 403 / 无关错误一律 null（不误吞 409、404、410、网络错误）', () => {
		expect(classifyStepUpFailure(apiError(409, 61000903))).toBeNull();
		expect(classifyStepUpFailure(apiError(404, 61000901))).toBeNull();
		expect(classifyStepUpFailure(new Error('network'))).toBeNull();
		expect(classifyStepUpFailure(undefined)).toBeNull();
		// 403 但文案无关（如通用 reauth 提示）→ 不猜，交回既有分类
		expect(classifyStepUpFailure(stepUpError({ message: 'reauth required' }))).toBeNull();
	});

	it('i18n_key 命中时不依赖 HTTP 状态（网关改写状态码也认得出）', () => {
		expect(
			classifyStepUpFailure({
				response: { status: 400, data: { i18n_key: 'error.login_approval_step_up_required' } },
			}),
		).toBe('step_up_required');
	});
});

describe('approvePending 入口选择（step_up / 普通行 / 老后端）', () => {
	const stepUpItem: PendingApproval = {
		requestId: 'req-step-up',
		expiresIn: 120,
		requiresStepUp: true,
	};
	const normalNewBackend: PendingApproval = {
		code: '482913',
		requestId: 'req-normal',
		expiresIn: 120,
		requiresStepUp: false,
	};
	const legacyBackend: PendingApproval = { code: '482913', requestId: 'req-legacy', expiresIn: 120 };

	beforeEach(() => {
		mockGet.mockReset();
		mockPost.mockReset();
		mockPost.mockResolvedValue({ data: {}, status: 200 });
	});

	it('step_up 行（无码）→ by-request-id + confirm_code', async () => {
		await approvePending(stepUpItem, '123456');

		expect(mockPost).toHaveBeenCalledWith(
			'/identity/api/v1/auth/login-approval/req-step-up/approve',
			{ confirm_code: '123456' },
		);
	});

	it('step_up 行 + 只有 code（深链 / 推送 data.code）→ by-code + confirm_code', async () => {
		await approvePending({ code: '482913', expiresIn: 120, requiresStepUp: true }, '123456');

		expect(mockPost).toHaveBeenCalledWith(
			'/identity/api/v1/auth/login-approval/by-code/482913/approve',
			{ confirm_code: '123456' },
		);
	});

	it('普通行（新后端，requires_step_up=false）→ by-request-id，不带 confirm_code', async () => {
		await approvePending(normalNewBackend);

		expect(mockPost).toHaveBeenCalledWith(
			'/identity/api/v1/auth/login-approval/req-normal/approve',
			undefined,
		);
	});

	it('老后端（无 requires_step_up 字段）→ by-code 无 body，逐字保持既有行为', async () => {
		await approvePending(legacyBackend);

		expect(mockPost).toHaveBeenCalledWith(
			'/identity/api/v1/auth/login-approval/by-code/482913/approve',
		);
		expect(mockPost.mock.calls[0]).toHaveLength(1);
	});
});

describe('listPendingApprovals 保留 step_up 行', () => {
	beforeEach(() => {
		mockGet.mockReset();
	});

	it('无码但 requires_step_up=true + request_id 的行必须保留（否则高风险请求在 App 里消失）', async () => {
		// 拦截器已把响应深 camel 化（requires_step_up → requiresStepUp），此处按生产形状喂
		mockGet.mockResolvedValue({
			data: {
				items: [
					{ code: '482913', requestId: 'req_1', expiresIn: 60, requiresStepUp: false },
					{ requestId: 'req_2', expiresIn: 60, requiresStepUp: true },
					// 既无码也不要求 step_up：老逻辑也过滤（保留既有口径）
					{ requestId: 'req_3', expiresIn: 60 },
				],
			},
		});

		const items = await listPendingApprovals();

		expect(items.map((item) => item.requestId)).toEqual(['req_1', 'req_2']);
	});
});

describe('approvalIdentity / isValidConfirmCode', () => {
	it('普通行身份 = 审批码；step_up 行 = request_id', () => {
		expect(approvalIdentity({ code: '482913', requestId: 'req_1', expiresIn: 1 })).toBe('482913');
		expect(approvalIdentity({ requestId: 'req_2', expiresIn: 1, requiresStepUp: true })).toBe(
			'req_2',
		);
	});

	it('桌面码必须 6 位数字（未满/超长/含字母一律不通过）', () => {
		expect(isValidConfirmCode('123456')).toBe(true);
		expect(isValidConfirmCode(' 123456 ')).toBe(true);
		expect(isValidConfirmCode('12345')).toBe(false);
		expect(isValidConfirmCode('1234567')).toBe(false);
		expect(isValidConfirmCode('12345a')).toBe(false);
		expect(isValidConfirmCode('')).toBe(false);
		expect(isValidConfirmCode(undefined)).toBe(false);
	});
});
