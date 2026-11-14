import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
	const actual = await vi.importActual('react-router');
	return {
		...actual,
		useNavigate: () => mockNavigate,
	};
});

const mockToggle = vi.fn();
let themeState: { theme: string; toggle: () => void } = { theme: 'light', toggle: mockToggle };
vi.mock('@autional/ui', () => ({
	useTheme: () => themeState,
	LanguageSwitcher: () => <div data-testid="language-switcher" />,
	showToast: vi.fn(),
}));

const mockLogout = vi.fn();
const mockSharedUnsubscribe = vi.fn();
let authState = { isAuthenticated: true };
vi.mock('@autional/shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared')>()),
	useLogout: () => mockLogout,
	useAuth: () => ({
		isAuthenticated: authState.isAuthenticated,
		user: { id: 'user_01', username: 'testuser', email: 'dev@example.com' },
	}),
	AUTH_PAGES_URL: '/auth',
	// 页面直接从 shared 导入该函数（非 @/lib/push 转发），mock 必须落在这里。
	// 箭头包装：工厂在静态 import 阶段执行，直接引用 const 会触发 TDZ。
	unsubscribeBrowserPush: (...args: unknown[]) => mockSharedUnsubscribe(...args),
}));

interface MockStoreState {
	accounts: unknown[];
	hasPin: boolean;
	isUnlocked: boolean;
	isLoading: boolean;
	unlockError: string | null;
	searchQuery: string;
	selectedGroup: string | null;
	setSearchQuery: (query: string) => void;
	setSelectedGroup: (group: string | null) => void;
	removeAccount: (id: string) => void;
	updateAccount: (id: string, updates: unknown) => void;
	reorderAccounts: (accounts: unknown[]) => void;
	loadAccounts: (accounts: unknown[]) => void;
	addAccount: (account: unknown) => void;
	importAccounts: (accounts: unknown[]) => void;
	setUnlocked: (unlocked: boolean) => void;
	setHasPin: (hasPin: boolean) => void;
	setUnlockError: (error: string | null) => void;
	setLoading: (loading: boolean) => void;
}
let storeState: MockStoreState;
vi.mock('@/lib/store', () => ({
	useAuthenticatorStore: (selector?: unknown) =>
		typeof selector === 'function'
			? (selector as (state: unknown) => unknown)(storeState)
			: storeState,
}));

vi.mock('@/components/BottomNav', () => ({
	default: () => <div data-testid="bottom-nav" />,
}));

vi.mock('@/lib/push', () => ({
	getVapidPublicKey: vi.fn(),
	subscribeBrowserPush: vi.fn(),
	unsubscribeBrowserPush: vi.fn(),
	registerPushSubscription: vi.fn(),
	unregisterPushSubscription: vi.fn(),
}));

vi.mock('@/lib/webauthn', () => ({
	registerBiometric: vi.fn(),
	hasBiometricRegistered: vi.fn(() => false),
	clearBiometric: vi.fn(),
	isBiometricAvailable: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('@/lib/api', () => ({
	generateBackupCodes: vi.fn(() => Promise.resolve({ data: { codes: [] } })),
	getBackupCodesCount: vi.fn(() => Promise.resolve({ data: { count: 0 } })),
}));

vi.mock('@/lib/storage', () => ({
	setPinProtection: vi.fn(() => Promise.resolve()),
	clearDeviceKeyCache: vi.fn(),
}));

vi.mock('@/lib/crypto', () => ({
	derivePinKey: vi.fn(),
	encryptWithKey: vi.fn(),
	decryptWithKey: vi.fn(),
	arrayBufferToBase64: vi.fn(),
	base64ToArrayBuffer: vi.fn(),
	PIN_KDF_ITERATIONS: 600_000,
	LEGACY_PBKDF2_ITERATIONS: 100_000,
	PIN_PATTERN: /^\d{6}$/,
	PIN_LENGTH: 6,
}));

import * as pushLib from '@/lib/push';
import * as storage from '@/lib/storage';
import SettingsPage from '../settings/page';

function renderSettings() {
	return render(
		<MemoryRouter initialEntries={['/settings']}>
			<SettingsPage />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockNavigate.mockClear();
	mockToggle.mockClear();
	mockLogout.mockClear();
	themeState = { theme: 'light', toggle: mockToggle };
	authState = { isAuthenticated: true };
	storeState = {
		accounts: [],
		hasPin: false,
		isUnlocked: true,
		isLoading: false,
		unlockError: null,
		searchQuery: '',
		selectedGroup: null,
		setSearchQuery: vi.fn(),
		setSelectedGroup: vi.fn(),
		removeAccount: vi.fn(),
		updateAccount: vi.fn(),
		reorderAccounts: vi.fn(),
		loadAccounts: vi.fn(),
		addAccount: vi.fn(),
		importAccounts: vi.fn(),
		setUnlocked: vi.fn(),
		setHasPin: vi.fn(),
		setUnlockError: vi.fn(),
		setLoading: vi.fn(),
	};
});

describe('SettingsPage', () => {
	describe('rendering', () => {
		it('renders header with title "设置"', async () => {
			renderSettings();
			expect(screen.getByText('设置')).toBeInTheDocument();
		});

		it('renders all section headers', async () => {
			renderSettings();
			expect(screen.getByText('外观')).toBeInTheDocument();
			expect(screen.getByText('安全')).toBeInTheDocument();
			expect(screen.getByText('活动与安全')).toBeInTheDocument();
			expect(screen.getByText('设备管理')).toBeInTheDocument();
			expect(screen.getByText('数据管理')).toBeInTheDocument();
			expect(screen.getByText('云同步')).toBeInTheDocument();
			expect(screen.getByText('账户')).toBeInTheDocument();
			expect(screen.getByText('关于')).toBeInTheDocument();
		});

		it('renders language switcher and bottom nav', async () => {
			renderSettings();
			expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
			expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
		});
	});

	describe('network status', () => {
		it('shows "在线" status when navigator.onLine is true', async () => {
			renderSettings();
			expect(screen.getByText('在线')).toBeInTheDocument();
			expect(screen.getByText('所有功能正常运行')).toBeInTheDocument();
		});
	});

	describe('dark mode toggle', () => {
		// 页面有两个 switch（深色模式 / 后台审批通知）→ 必须按可访问名定位
		it('renders dark mode row with toggle switch', async () => {
			renderSettings();
			expect(screen.getByText('深色模式')).toBeInTheDocument();
			const toggle = screen.getByRole('switch', { name: '深色模式' });
			expect(toggle).toBeInTheDocument();
			expect(toggle.getAttribute('aria-checked')).toBe('false');
		});

		it('calls toggle function on click', async () => {
			renderSettings();
			const toggle = screen.getByRole('switch', { name: '深色模式' });
			await act(async () => {
				fireEvent.click(toggle);
			});
			expect(mockToggle).toHaveBeenCalledTimes(1);
		});

		it('shows checked state when theme is dark', async () => {
			themeState = { theme: 'dark', toggle: mockToggle };
			renderSettings();
			const toggle = screen.getByRole('switch', { name: '深色模式' });
			expect(toggle.getAttribute('aria-checked')).toBe('true');
		});
	});

	describe('security score', () => {
		it('renders security score section', async () => {
			renderSettings();
			expect(screen.getByText('安全评分')).toBeInTheDocument();
		});

		it('displays low score message with no accounts, no pin, no push, no backup', async () => {
			renderSettings();
			expect(screen.getByText('需要加强，请尽快完善安全设置')).toBeInTheDocument();
		});
	});

	describe('backup codes button', () => {
		it('renders "生成备用码" button', async () => {
			renderSettings();
			expect(screen.getByText('生成备用码')).toBeInTheDocument();
		});
	});

	describe('background approval push (opt-in, 2026-11-13)', () => {
		// 产品口径：前台提醒 = SSE（默认开启、无需设置）；Web Push 只是「锁屏/后台」的可选补充，
		// 默认关闭，old FCM 时代的 Push MFA 开关不再渲染。
		it('渲染「后台审批通知」开关，默认关闭', () => {
			renderSettings();
			expect(screen.getByText('后台审批通知')).toBeInTheDocument();
			const toggle = screen.getByRole('switch', { name: '后台审批通知' });
			expect(toggle.getAttribute('aria-checked')).toBe('false');
		});

		it('jsdom 无 Notification → 禁用态并解释「当前浏览器不支持」', async () => {
			renderSettings();
			expect(screen.getByRole('switch', { name: '后台审批通知' })).toBeDisabled();
			expect(await screen.findByText('当前浏览器不支持')).toBeInTheDocument();
		});

		it('不再渲染旧 Push MFA 开关（不使用第三方推送）', () => {
			renderSettings();
			expect(screen.queryByText('启用 Push 通知')).toBeNull();
			expect(screen.queryByText('Push 登录审批')).toBeNull();
		});
	});

	describe('export', () => {
		it('renders "导出备份" button', async () => {
			renderSettings();
			expect(screen.getByText('导出备份')).toBeInTheDocument();
		});

		it('renders "导入备份" label', async () => {
			renderSettings();
			expect(screen.getByText('导入备份')).toBeInTheDocument();
		});
	});

	describe('cloud backup and device sync', () => {
		it('renders cloud backup navigation button', async () => {
			renderSettings();
			expect(screen.getByText('云备份')).toBeInTheDocument();
		});

		it('renders device sync navigation button', async () => {
			renderSettings();
			expect(screen.getByText('设备同步')).toBeInTheDocument();
		});
	});

	describe('logout', () => {
		it('renders "退出登录" button', async () => {
			renderSettings();
			expect(screen.getByText('退出登录')).toBeInTheDocument();
		});

		it('本地模式：不显示退出登录，显示登录入口', () => {
		authState.isAuthenticated = false;
		renderSettings();
		expect(screen.getByText('登录 Autional')).toBeInTheDocument();
		expect(screen.queryByText('退出登录')).not.toBeInTheDocument();
	});

	it('calls logout on click', async () => {
			renderSettings();
			const logoutBtn = screen.getByText('退出登录');
			await act(async () => {
				fireEvent.click(logoutBtn);
			});
			expect(mockLogout).toHaveBeenCalledTimes(1);
		});
	});

	describe('version display', () => {
		it('shows app name in about section', async () => {
			renderSettings();
			expect(screen.getByText('Autional Authenticator')).toBeInTheDocument();
		});

		it('shows version 0.2.0 in about section', async () => {
			renderSettings();
			expect(screen.getByText('版本 0.2.0 · Web PWA · 加密存储 · Push MFA')).toBeInTheDocument();
		});
	});

	describe('back navigation', () => {
		it('back arrow navigates to home', async () => {
			renderSettings();
			const backBtn = screen.getByLabelText('返回首页');
			await act(async () => {
				fireEvent.click(backBtn);
			});
			expect(mockNavigate).toHaveBeenCalledWith('/');
		});
	});

	describe('PIN protection (keypad, 2026-11-14)', () => {
		it('未启用 PIN → 显示未保护警告', async () => {
			renderSettings();
			expect(screen.getByText(/^未设 PIN/)).toBeInTheDocument();
		});

		it('已启用 PIN → 自绘键盘；两遍 6 位输满自动提交 → 写入 PIN 一次', async () => {
			storeState = { ...storeState, hasPin: true };
			renderSettings();

			// 设置页不再有 PIN 输入框（系统键盘 / 密码管理器诱因归零）
			expect(screen.getByRole('group', { name: '数字键盘' })).toBeInTheDocument();

			const press = (digits: string) =>
				digits.split('').forEach((d) => fireEvent.click(screen.getByRole('button', { name: d })));

			// 首遍：输满 6 位自动进入确认阶段（无需保存按钮 / 确认键）
			press('123456');
			await waitFor(() => expect(screen.getByText('再输入一次确认')).toBeInTheDocument());
			expect(storage.setPinProtection).not.toHaveBeenCalled();

			// 二遍一致 → 调用 setPinProtection 一次
			press('123456');
			await waitFor(() => expect(storage.setPinProtection).toHaveBeenCalledTimes(1));
			expect(storage.setPinProtection).toHaveBeenCalledWith('123456');
			expect(storeState.setHasPin).toHaveBeenCalledWith(true);
		});

		it('两遍不一致 → 报错 + 回到首遍并清空，不写入', async () => {
			storeState = { ...storeState, hasPin: true };
			renderSettings();

			const press = (digits: string) =>
				digits.split('').forEach((d) => fireEvent.click(screen.getByRole('button', { name: d })));

			press('123456');
			await waitFor(() => expect(screen.getByText('再输入一次确认')).toBeInTheDocument());
			press('654321');
			await waitFor(() => expect(screen.getByText('两次输入不一致')).toBeInTheDocument());

			// 回到首遍且两值清空（键盘 autoSubmit 已复位，可重输）
			expect(screen.getByText('输入新 PIN（6 位数字）')).toBeInTheDocument();
			expect(screen.getByText('已输入 0 位')).toBeInTheDocument();
			expect(storage.setPinProtection).not.toHaveBeenCalled();
		});
	});
});
