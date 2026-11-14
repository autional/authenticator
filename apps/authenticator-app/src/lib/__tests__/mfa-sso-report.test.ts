import { describe, it, expect, vi, afterEach } from 'vitest';
import { MFA_SSO_EVENT, describeMfaFailure, reportMfaSsoFailure } from '../mfa-sso-report';

/**
 * 失败可诊断性：静默回落可以，但**不能**静默到没有痕迹；
 * 同时红线是「绝不输出 secret / proof / ticket」—— 连错误消息里混进来的也要脱敏。
 */

describe('describeMfaFailure', () => {
	it('抹掉 secret / proof / ticket 的值，保留可定位的结构', () => {
		const text = describeMfaFailure(
			new Error('ticket=tid.secret secret:JBSWY3DPEHPK3PXP proof=cHJvb2Y denied'),
		);
		expect(text).not.toContain('tid.secret');
		expect(text).not.toContain('JBSWY3DPEHPK3PXP');
		expect(text).not.toContain('cHJvb2Y');
		expect(text).toContain('denied');
		expect(text).toContain('ticket=<redacted>');
	});

	it('非 Error 的原因不 dump 对象（避免把响应体带出来）', () => {
		expect(describeMfaFailure({ ticket: 'tid.secret', proof: 'cHJvb2Y' })).toBe('[object Object]');
		expect(describeMfaFailure(undefined)).toBe('[object Undefined]');
		expect(describeMfaFailure('plain string')).toBe('plain string');
	});

	it('超长消息截断（错误体可能很大）', () => {
		expect(describeMfaFailure(new Error('x'.repeat(500))).length).toBeLessThanOrEqual(220);
	});
});

describe('reportMfaSsoFailure', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('console.warn 一行摘要 + 派发 autional:mfa-sso 事件', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const received: unknown[] = [];
		const listener = (event: Event) => received.push((event as CustomEvent).detail);
		window.addEventListener(MFA_SSO_EVENT, listener);

		reportMfaSsoFailure('ticket-exchange', new Error('ticket=tid.secret'));

		expect(String(warn.mock.calls[0][0])).toBe('[mfa-sso] ticket exchange failed');
		expect(received).toEqual([
			{ phase: 'ticket-exchange', reason: expect.stringContaining('ticket=<redacted>') },
		]);

		window.removeEventListener(MFA_SSO_EVENT, listener);
	});
});
