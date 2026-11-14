import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

/**
 * AU-17 密码表单语义回归锁（jsdom 结构断言）——
 * 四处密码面每个 form 内须存在 username 语义字段（Chromium 可访问性启发式）；
 * 导出/导入对话框的密码输入须在 form 内且 submit 走表单语义。
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
	getPinLength: vi.fn(() => null),
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
	it('PIN 保护表单：密码输入在 form 内，form 含 text 语义 hidden username', () => {
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
		const password = container.querySelector('input[type="password"]')!;
		const form = password.closest('form');
		expect(form).not.toBeNull();
		const username = form!.querySelector('input[name="username"]');
		expect(username).not.toBeNull();
		expect(username!.getAttribute('autocomplete')).toBe('username');
		expect(username!.getAttribute('type')).toBe('text');
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
		expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
	});
});
