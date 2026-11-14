import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/**
 * 全局「需要重新登录」banner：
 *   ① 无信号时不渲染（不占位、不影响布局）；
 *   ② 收到 `autional:needs-relogin` → 出现，且**不泄露** 403/scope 等技术细节；
 *   ③ 点「重新登录」→ 走与页面内一致的登录入口（startSignIn + 最近租户）；
 *   ④ 点「关闭」→ 消失，且本次会话后续同类信号不再弹。
 *
 * 注意：④ 会置模块级「已关闭」标记，所以必须放在最后一个用例。
 */

const { mockStartSignIn, mockSignIn } = vi.hoisted(() => ({
	mockStartSignIn: vi.fn(),
	mockSignIn: vi.fn(),
}));

vi.mock('@/lib/use-sign-in', () => ({
	startSignIn: mockStartSignIn,
	useSignIn: () => ({ signIn: mockSignIn, dialog: null }),
}));

vi.mock('@autional/shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared')>()),
	useAuth: () => ({ isAuthenticated: true }),
}));

import ReloginNotice from '../ReloginNotice';
import { notifyNeedsRelogin } from '../../lib/relogin';

const LAST_TENANT_KEY = 'authenticator-last-tenant-slug';

function renderNotice() {
	return render(
		<MemoryRouter>
			<ReloginNotice />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	mockStartSignIn.mockReset();
	mockSignIn.mockReset();
	localStorage.setItem(LAST_TENANT_KEY, 'acme');
});

afterEach(() => {
	localStorage.clear();
});

describe('ReloginNotice', () => {
	it('无信号时不渲染', () => {
		renderNotice();
		expect(screen.queryByTestId('relogin-notice')).toBeNull();
	});

	it('收到信号后显示提示，且不暴露技术细节；点「重新登录」用最近租户发起登录', () => {
		renderNotice();

		act(() => {
			notifyNeedsRelogin('stream-ticket-403');
		});

		const banner = screen.getByTestId('relogin-notice');
		expect(banner).toBeInTheDocument();
		expect(banner.textContent).toContain('登录权限已更新');
		// 不泄露 403 / scope / 接口名
		expect(banner.textContent).not.toMatch(/403|scope|ticket|subscription/i);

		fireEvent.click(screen.getByRole('button', { name: '重新登录' }));
		expect(mockStartSignIn).toHaveBeenCalledWith('acme');
		expect(mockSignIn).not.toHaveBeenCalled();
	});

	it('没有最近租户时回落到选择组织弹窗（与页面内登录一致）', () => {
		localStorage.removeItem(LAST_TENANT_KEY);
		renderNotice();

		act(() => {
			notifyNeedsRelogin('stream-ticket-403');
		});

		fireEvent.click(screen.getByRole('button', { name: '重新登录' }));
		expect(mockStartSignIn).not.toHaveBeenCalled();
		expect(mockSignIn).toHaveBeenCalledTimes(1);
	});

	it('点关闭后消失，且本次会话后续信号不再弹（必须放最后一个用例）', () => {
		renderNotice();

		act(() => {
			notifyNeedsRelogin('stream-ticket-403');
		});
		expect(screen.getByTestId('relogin-notice')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
		expect(screen.queryByTestId('relogin-notice')).toBeNull();

		// SSE 5 分钟低频重试再来一次 403 → 不再打扰
		act(() => {
			notifyNeedsRelogin('stream-ticket-403');
		});
		expect(screen.queryByTestId('relogin-notice')).toBeNull();
	});
});
