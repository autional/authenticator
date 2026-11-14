import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

/**
 * AU-17 密码表单语义回归锁（jsdom 结构断言）——
 * 密码面（导出/导入对话框）每个 form 内须存在 username 语义字段（Chromium 可访问性启发式）；
 * PIN 面（解锁屏 / 设置页）走自绘数字键盘，须完全没有密码输入框与 form 提交语义。
 * （真验证在 console 复采：VERBOSE [DOM] 密码告警归零。）
 */

const storeState = vi.hoisted(() => ({
	isLoading: false,
	isUnlocked: false,
	hasPin: true,
	loadAccounts: vi.fn(),
	setHasPin: vi.fn(),
	setLoading: vi.fn(),
}));

vi.mock('@/lib/store', () => ({
	useAuthenticatorStore: (selector?: (s: typeof storeState) => unknown) =>
		typeof selector === 'function' ? selector(storeState) : storeState,
}));

vi.mock('@/lib/storage', () => ({
	unlockWithPin: vi.fn().mockResolvedValue([]),
	hasPinProtection: vi.fn(() => true),
	loadWithoutPin: vi.fn().mockResolvedValue([]),
	unlockWithBiometric: vi.fn().mockResolvedValue([]),
	getPinLength: vi.fn(() => 6),
}));

vi.mock('@/lib/webauthn', () => ({
	hasBiometricRegistered: vi.fn(() => false),
	isBiometricAvailable: vi.fn().mockResolvedValue(false),
	verifyBiometric: vi.fn(),
	hasPRFEnabled: vi.fn(() => false),
	isPRFSupported: vi.fn(() => false),
}));

import SettingsPinProtection from '@/components/settings/SettingsPinProtection';
import SettingsExportPasswordDialog from '@/components/settings/SettingsExportPasswordDialog';
import SettingsImportPasswordDialog from '@/components/settings/SettingsImportPasswordDialog';
import UnlockScreen from '@/components/UnlockScreen';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('AU-17 密码表单语义', () => {
	it('PIN 保护：走自绘数字键盘（无密码输入框、无表单提交语义）', () => {
		const { container } = render(
			<SettingsPinProtection
				hasPin={false}
				pinInput=""
				onPinChange={vi.fn()}
				pinSaving={false}
				pinMessage={null}
				onSave={vi.fn()}
			/>,
		);
		// 系统键盘 / 密码管理器的诱因（input + form）必须彻底消失
		expect(container.querySelector('input[type="password"]')).toBeNull();
		expect(container.querySelector('#settings-pin-input')).toBeNull();
		expect(container.querySelector('form')).toBeNull();

		expect(screen.getByRole('group', { name: '数字键盘' })).toBeInTheDocument();
		// 6 位自动提交：不渲染确认键
		expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
	});

	it('导出对话框：密码输入在 form 内 + hidden username + new-password；submit 触发导出回调；取消为 type=button', () => {
		const onExport = vi.fn();
		const { container } = render(
			<SettingsExportPasswordDialog
				open
				value=" pass "
				onChange={vi.fn()}
				onExport={onExport}
				onCancel={vi.fn()}
			/>,
		);
		const password = container.querySelector('input[type="password"]')!;
		expect(password.getAttribute('autocomplete')).toBe('new-password');
		const form = password.closest('form')!;
		expect(form).not.toBeNull();
		expect(form.querySelector('input[autocomplete="username"]')).not.toBeNull();

		const buttons = form.querySelectorAll('button');
		expect(buttons[0].getAttribute('type')).toBe('button');
		expect(buttons[1].getAttribute('type')).toBe('submit');

		fireEvent.submit(form);
		expect(onExport).toHaveBeenCalledWith('pass');
	});

	it('导入对话框：密码输入在 form 内 + hidden username + new-password；空值不触发、有值 submit 触发', () => {
		const onDecrypt = vi.fn();
		const { container, rerender } = render(
			<SettingsImportPasswordDialog
				open
				value=""
				onChange={vi.fn()}
				onDecrypt={onDecrypt}
				onCancel={vi.fn()}
			/>,
		);
		const password = container.querySelector('input[type="password"]')!;
		expect(password.getAttribute('autocomplete')).toBe('new-password');
		const form = password.closest('form')!;
		expect(form).not.toBeNull();
		expect(form.querySelector('input[autocomplete="username"]')).not.toBeNull();

		fireEvent.submit(form);
		expect(onDecrypt).not.toHaveBeenCalled();

		rerender(
			<SettingsImportPasswordDialog
				open
				value="secret"
				onChange={vi.fn()}
				onDecrypt={onDecrypt}
				onCancel={vi.fn()}
			/>,
		);
		fireEvent.submit(form);
		expect(onDecrypt).toHaveBeenCalledTimes(1);
	});

	it('解锁屏：PIN 走自绘数字键盘（无密码输入框、无表单提交语义）', async () => {
		const { container } = render(
			<UnlockScreen>
				<div />
			</UnlockScreen>,
		);
		await act(async () => {});

		// 系统键盘/密码管理器的诱因（input + form）必须彻底消失
		expect(container.querySelector('input[type="password"]')).toBeNull();
		expect(container.querySelector('#unlock-pin-input')).toBeNull();
		expect(container.querySelector('form')).toBeNull();

		expect(screen.getByRole('group', { name: '数字键盘' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
		// 6 位固定、输满自动提交：解锁屏同样不渲染确认键
		expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
	});
});
