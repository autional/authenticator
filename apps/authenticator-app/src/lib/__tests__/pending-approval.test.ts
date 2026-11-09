import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	clearPendingApproval,
	savePendingApproval,
	takePendingApproval,
} from '../pending-approval';

/**
 * 扫码登录「先登录再审批」的票据：一次性、5 分钟过期、损坏即弃。
 */
describe('pending-approval（扫码登录待审批票据）', () => {
	beforeEach(() => {
		sessionStorage.clear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('保存后取出：返回 ready + token/numberMatching，并立即清除（一次性）', () => {
		savePendingApproval({ token: 'tok_1', numberMatching: '123456' });

		expect(takePendingApproval()).toEqual({
			status: 'ready',
			challenge: { token: 'tok_1', numberMatching: '123456' },
		});
		expect(takePendingApproval()).toBeNull();
	});

	it('超过 5 分钟 → 返回 expired（供 UI 提示）且清除', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-09T10:00:00Z'));
		savePendingApproval({ token: 'tok_old' });

		vi.setSystemTime(new Date('2026-11-09T10:06:00Z'));
		expect(takePendingApproval()).toEqual({ status: 'expired' });
		expect(sessionStorage.length).toBe(0);
	});

	it('损坏内容 → null，不抛错', () => {
		sessionStorage.setItem('authenticator.pending-approval.v1', '{not-json');
		expect(takePendingApproval()).toBeNull();
	});

	it('clearPendingApproval 后可重复调用，不抛错', () => {
		savePendingApproval({ token: 'tok_2' });
		clearPendingApproval();
		expect(takePendingApproval()).toBeNull();
		clearPendingApproval();
	});
});
