import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
	APPROVAL_REFRESH_DEDUPE_MS,
	NOTIFICATION_EVENT,
	approvalDedupeKey,
	isApprovalNotification,
	useApprovalNotificationRefresh,
} from '../approval-notification';

/**
 * 审批类通知判定 + 订阅去重的回归锁：
 *   ① 后端下发的审批通知形态（action_url=/a/<code>、metadata 里的 approval_code/request_id、
 *      type=login_approval）都判为审批类；metadata 是 JSON 字符串的老形态也认；
 *   ② 无关通知（system/security/email、无审批字段）一律不判为审批类；
 *   ③ 同一审批 2s 内重复到达只回调一次，不同审批各自回调；
 *   ④ enabled=false 不挂监听；卸载即摘监听。
 */

function emit(detail: unknown) {
	act(() => {
		window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail }));
	});
}

describe('isApprovalNotification', () => {
	it('action_url 以 /a/ 开头 → 审批类', () => {
		expect(isApprovalNotification({ id: 'n1', action_url: '/a/482913' })).toBe(true);
		// camelCase 形态（列表接口经拦截器 camelCase 化）
		expect(isApprovalNotification({ id: 'n1', actionUrl: '/a/482913' })).toBe(true);
	});

	it('带 approval_code / request_id（含 metadata 对象与 JSON 字符串）→ 审批类', () => {
		expect(isApprovalNotification({ approval_code: '482913' })).toBe(true);
		expect(isApprovalNotification({ metadata: { approval_code: '482913' } })).toBe(true);
		// 仅 request_id 不算：它是通用追踪字段，任何通知都可能带 —— 只用于去重，不做判定
		expect(isApprovalNotification({ metadata: { request_id: 'req_1' } })).toBe(false);
		expect(isApprovalNotification({ type: 'login_approval', metadata: { request_id: 'req_1' } })).toBe(
			true,
		);
		expect(
			isApprovalNotification({ metadata: JSON.stringify({ action_url: '/a/482913' }) }),
		).toBe(true);
	});

	it('type 含 approval → 审批类', () => {
		expect(isApprovalNotification({ type: 'login_approval' })).toBe(true);
		expect(isApprovalNotification({ metadata: { type: 'approval_request' } })).toBe(true);
	});

	it('无关通知不判为审批类（不为它刷新）', () => {
		expect(isApprovalNotification({ type: 'system', title: '系统维护' })).toBe(false);
		expect(isApprovalNotification({ type: 'security', action_url: '/notifications' })).toBe(false);
		expect(isApprovalNotification({ type: 'email', metadata: '{}' })).toBe(false);
		// 畸形 metadata 不当成审批类（JSON 解析失败静默）
		expect(isApprovalNotification({ type: 'system', metadata: '{oops' })).toBe(false);
		expect(isApprovalNotification(null)).toBe(false);
		expect(isApprovalNotification(undefined)).toBe(false);
	});
});

describe('approvalDedupeKey', () => {
	it('优先审批码，其次请求 id / 落地链接 / 通知 id', () => {
		expect(approvalDedupeKey({ approval_code: '482913', request_id: 'req_1' })).toBe('482913');
		expect(approvalDedupeKey({ metadata: { request_id: 'req_1' } })).toBe('req_1');
		expect(approvalDedupeKey({ action_url: '/a/482913' })).toBe('/a/482913');
		expect(approvalDedupeKey({ id: 'n1' })).toBe('n1');
		expect(approvalDedupeKey(null)).toBe('');
	});
});

describe('useApprovalNotificationRefresh', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('审批类通知 → 回调；无关通知 → 不回调', () => {
		const onApproval = vi.fn();
		renderHook(() => useApprovalNotificationRefresh(true, onApproval));

		emit({ type: 'system', title: '系统维护通知' });
		emit({ type: 'security', action_url: '/notifications' });
		expect(onApproval).not.toHaveBeenCalled();

		emit({ type: 'login_approval', action_url: '/a/482913' });
		expect(onApproval).toHaveBeenCalledTimes(1);
	});

	it('同一审批 2s 内重复到达只回调一次；窗口外再到达继续回调', () => {
		let now = 1_000_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);

		const onApproval = vi.fn();
		renderHook(() => useApprovalNotificationRefresh(true, onApproval));

		const notification = {
			type: 'login_approval',
			action_url: '/a/482913',
			approval_code: '482913',
		};

		emit(notification);
		emit(notification); // SSE 重连补发 / 同一审批的重复帧
		expect(onApproval).toHaveBeenCalledTimes(1);

		now += APPROVAL_REFRESH_DEDUPE_MS - 1;
		emit(notification);
		expect(onApproval).toHaveBeenCalledTimes(1);

		now += 1; // 正好到 2s 窗口外
		emit(notification);
		expect(onApproval).toHaveBeenCalledTimes(2);
	});

	it('不同审批各自回调（去重按 approval_code/request_id，不是一刀切）', () => {
		const onApproval = vi.fn();
		renderHook(() => useApprovalNotificationRefresh(true, onApproval));

		emit({ action_url: '/a/482913', approval_code: '482913' });
		emit({ action_url: '/a/482914', approval_code: '482914' });
		expect(onApproval).toHaveBeenCalledTimes(2);

		// 同一 request_id 的不同帧（例如状态更新）仍只算一次
		emit({ type: 'login_approval', metadata: { request_id: 'req_9' } });
		emit({ type: 'login_approval', metadata: { request_id: 'req_9' } });
		expect(onApproval).toHaveBeenCalledTimes(3);
	});

	it('enabled=false 不挂监听；卸载即摘监听（不 setState）', () => {
		const onApproval = vi.fn();
		const { unmount, rerender } = renderHook(
			({ enabled }: { enabled: boolean }) => useApprovalNotificationRefresh(enabled, onApproval),
			{ initialProps: { enabled: false } },
		);

		emit({ action_url: '/a/482913' });
		expect(onApproval).not.toHaveBeenCalled();

		rerender({ enabled: true });
		emit({ action_url: '/a/482913' });
		expect(onApproval).toHaveBeenCalledTimes(1);

		unmount();
		emit({ action_url: '/a/482914' });
		expect(onApproval).toHaveBeenCalledTimes(1);
	});
});
