import { describe, expect, it } from 'vitest';
import {
	buildPushNotification,
	parsePushMessage,
	resolveClickUrl,
} from '../../../pwa/push-notification';

const CHALLENGE_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

function mfaPayload(overrides: Record<string, unknown> = {}) {
	return JSON.stringify({
		title: 'Login Approval Request',
		body: 'Approve login? Context: Chrome on Windows, Seattle, US',
		data: {
			type: 'mfa_push',
			challenge_id: CHALLENGE_ID,
			number_matching: '42',
			login_context: 'Chrome on Windows, Seattle, US',
			expires_at: '2026-10-21T12:00:00Z',
			...overrides,
		},
	});
}

describe('parsePushMessage', () => {
	it('空载荷、非法 JSON、数组与非对象均返回 null', () => {
		expect(parsePushMessage(null)).toBeNull();
		expect(parsePushMessage('')).toBeNull();
		expect(parsePushMessage('{bad}')).toBeNull();
		expect(parsePushMessage('[]')).toBeNull();
		expect(parsePushMessage('"text"')).toBeNull();
	});

	it('提取 title/body/data 并去除首尾空白', () => {
		const message = parsePushMessage(
			JSON.stringify({ title: ' 标题 ', body: ' 正文 ', data: { type: 'mfa_push' } }),
		);
		expect(message).toEqual({ title: '标题', body: '正文', data: { type: 'mfa_push' } });
	});

	it('超长标题与正文截断到上限', () => {
		const message = parsePushMessage(
			JSON.stringify({ title: 'T'.repeat(120), body: 'B'.repeat(400) }),
		);
		expect(message?.title).toHaveLength(80);
		expect(message?.title.endsWith('…')).toBe(true);
		expect(message?.body).toHaveLength(200);
		expect(message?.body.endsWith('…')).toBe(true);
	});

	it('data 不是对象时置空', () => {
		expect(parsePushMessage(JSON.stringify({ title: 'x', data: 'nope' }))?.data).toEqual({});
	});
});

describe('buildPushNotification', () => {
	it('MFA 推送使用固定文案，不泄露 login_context', () => {
		const spec = buildPushNotification(parsePushMessage(mfaPayload()), 'zh-CN');
		expect(spec.title).toBe('登录审批请求');
		expect(spec.body).toBe('匹配数字 42，点击查看详情');
		expect(spec.body).not.toContain('Seattle');
		expect(spec.title).not.toContain('Seattle');
		expect(spec.tag).toBe(`mfa-push:${CHALLENGE_ID}`);
	});

	it('MFA 深链携带 challengeId 与 numberMatching', () => {
		const spec = buildPushNotification(parsePushMessage(mfaPayload()), 'en-US');
		expect(spec.url).toBe(
			`/push-approve?challengeId=${CHALLENGE_ID}&numberMatching=42`,
		);
	});

	it('数字型 number_matching 也接受', () => {
		const spec = buildPushNotification(parsePushMessage(mfaPayload({ number_matching: 42 })), 'en-US');
		expect(spec.body).toBe('Match number 42 — tap to review');
		expect(spec.url).toContain('numberMatching=42');
	});

	it('非法 number_matching 丢弃，不影响深链', () => {
		const spec = buildPushNotification(
			parsePushMessage(mfaPayload({ number_matching: '42&x=1' })),
			'en-US',
		);
		expect(spec.body).toBe('Tap to review a new sign-in request');
		expect(spec.url).toBe(`/push-approve?challengeId=${CHALLENGE_ID}`);
	});

	it.each(['javascript:alert(1)', '//evil.example/push-approve', '../../admin', '', null])(
		'非法 challenge_id %s 回落首页',
		(challengeId) => {
			const spec = buildPushNotification(
				parsePushMessage(mfaPayload({ challenge_id: challengeId })),
				'en-US',
			);
			expect(spec.url).toBe('/');
			expect(spec.tag).toBeUndefined();
		},
	);

	it('未知类型沿用服务端文案，深链固定首页', () => {
		const payload = JSON.stringify({ title: 'Notice', body: 'Details', data: { type: 'other' } });
		const spec = buildPushNotification(parsePushMessage(payload), 'en-US');
		expect(spec).toEqual({ title: 'Notice', body: 'Details', url: '/' });
	});

	it('空载荷展示通用通知，不静默丢弃', () => {
		expect(buildPushNotification(null, 'zh')).toEqual({
			title: '登录审批请求',
			body: '点击查看详情',
			url: '/',
		});
		expect(buildPushNotification(null, 'en-GB')).toEqual({
			title: 'Login approval request',
			body: 'Tap to review',
			url: '/',
		});
	});
});

describe('resolveClickUrl', () => {
	it('站内相对路径原样返回', () => {
		expect(resolveClickUrl({ url: '/push-approve?challengeId=x' })).toBe(
			'/push-approve?challengeId=x',
		);
	});

	it.each([{ url: '//evil.example' }, { url: 'https://evil.example' }, { url: 'javascript:alert(1)' }, {}, null])(
		'非站内路径回落首页：%s',
		(data) => {
			expect(resolveClickUrl(data)).toBe('/');
		},
	);
});
