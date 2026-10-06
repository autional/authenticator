import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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
vi.mock('@autional/shared', () => ({
	useLogout: () => mockLogout,
	AUTH_PAGES_URL: '/auth',
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
}));

vi.mock('@/lib/crypto', () => ({
	derivePinKey: vi.fn(),
	encryptWithKey: vi.fn(),
	decryptWithKey: vi.fn(),
	arrayBufferToBase64: vi.fn(),
	base64ToArrayBuffer: vi.fn(),
}));

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
		it('renders dark mode row with toggle switch', async () => {
			renderSettings();
			expect(screen.getByText('深色模式')).toBeInTheDocument();
			const toggle = screen.getByRole('switch');
			expect(toggle).toBeInTheDocument();
			expect(toggle.getAttribute('aria-checked')).toBe('false');
		});

		it('calls toggle function on click', async () => {
			renderSettings();
			const toggle = screen.getByRole('switch');
			await act(async () => {
				fireEvent.click(toggle);
			});
			expect(mockToggle).toHaveBeenCalledTimes(1);
		});

		it('shows checked state when theme is dark', async () => {
			themeState = { theme: 'dark', toggle: mockToggle };
			renderSettings();
			const toggle = screen.getByRole('switch');
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

	describe('push MFA button', () => {
		it('renders "启用 Push 通知" button', async () => {
			renderSettings();
			expect(screen.getByText('启用 Push 通知')).toBeInTheDocument();
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

	describe('PIN placeholder (AU-15)', () => {
		it('未启用 PIN → 占位为新建引导「输入 4-8 位数字」', async () => {
			renderSettings();
			expect(screen.getByPlaceholderText('输入 4-8 位数字')).toBeInTheDocument();
		});

		it('已启用 PIN → 占位为修改引导「输入新 PIN 或留空禁用」', async () => {
			storeState = { ...storeState, hasPin: true };
			renderSettings();
			expect(screen.getByPlaceholderText('输入新 PIN 或留空禁用')).toBeInTheDocument();
		});
	});
});
