import { describe, it, expect } from 'vitest';
import { classifyApprovalFailure } from '../login-approval';

/**
 * 审批动作失败归类的回归锁（后端 L3a 契约：
 *   approve/deny 并发冲突 → 409 / 61000903；请求不存在或不属于当前账号 → 404 / 61000901）。
 *
 * 为什么值得单独锁：页面对 409 与 404 的**文案与出路完全不同**
 *   - 409 → 「已被处理或替代」（事实性，不是系统错误），并清掉该条 + 刷新列表
 *   - 404 → 「已失效或不属于当前账号」
 * 归类一旦退化（例如把 409 当 unknown），用户就会看到「批准失败，请重试」这种会导向
 * 无限重试的错误提示。
 */

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
