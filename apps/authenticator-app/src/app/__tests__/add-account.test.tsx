import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
	const actual = await vi.importActual('react-router');
	return {
		...actual,
		useNavigate: () => mockNavigate,
	};
});

const mockValidateSecret = vi.fn();
const mockGenerateTOTP = vi.fn();
vi.mock('@/lib/totp', () => ({
	validateSecret: (...args: unknown[]) => mockValidateSecret(...args),
	generateTOTP: (...args: unknown[]) => mockGenerateTOTP(...args),
}));

interface MockStoreState {
	accounts: unknown[];
	addAccount: (account: unknown) => void;
}
let storeState: MockStoreState = { accounts: [], addAccount: vi.fn() };
vi.mock('@/lib/store', () => ({
	useAuthenticatorStore: (selector?: unknown) =>
		typeof selector === 'function'
			? (selector as (state: unknown) => unknown)(storeState)
			: storeState,
}));

interface MockQrScannerProps {
	onScan?: (result: unknown) => void;
	onMigration?: (accounts: unknown[]) => void;
	onScanLogin?: (challenge: { token: string; numberMatching?: string }) => void;
	onError?: (error: string) => void;
	onManualFallback?: () => void;
}
vi.mock('@/components/QrScanner', () => ({
	default: (props: MockQrScannerProps) => (
		<div data-testid="qr-scanner">
			<p>将二维码对准扫描框</p>
			{/* AU-04 集成探针：暴露降级 CTA 触发通道 */}
			<button type="button" onClick={() => props.onManualFallback?.()}>
				manual-fallback-stub
			</button>
			<button
				type="button"
				onClick={() => props.onScanLogin?.({ token: 't1', numberMatching: '123456' })}
			>
				scan-login-stub
			</button>
		</div>
	),
}));

vi.mock('@/components/BottomNav', () => ({
	default: () => <div data-testid="bottom-nav">BottomNav</div>,
}));

const mockSignIn = vi.fn();
vi.mock('@/lib/use-sign-in', () => ({
	useSignIn: () => ({ signIn: mockSignIn, dialog: null }),
}));

vi.mock('@autional/ui', () => ({
	showToast: vi.fn(),
}));

interface MockAuthStoreState {
	user: { id: string; email: string; username: string } | null;
}
let authStoreState: MockAuthStoreState = { user: null };
let authState = { isAuthenticated: true };
vi.mock('@autional/shared', async () => {
	const actual = await vi.importActual('@autional/shared');
	return {
		...actual,
		useAuthStore: (selector?: unknown) =>
			typeof selector === 'function'
				? (selector as (state: unknown) => unknown)(authStoreState)
				: authStoreState,
		useAuth: () => ({
			isAuthenticated: authState.isAuthenticated,
			user: authStoreState.user,
			userId: authStoreState.user?.id || null,
			accessToken: 'mock-token',
			currentTenantId: null,
			permissions: [],
			tenants: [],
		}),
		GeneratedApi: {
			mfaTotpEnablePost: vi.fn(),
			mfaTotpVerifyPost: vi.fn(),
		},
	};
});

import AddAccountPage from '../add/page';
import { showToast } from '@autional/ui';
import { savePendingApproval } from '@/lib/pending-approval';

function renderAddAccount() {
	return render(
		<MemoryRouter initialEntries={['/add']}>
			<AddAccountPage />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockNavigate.mockReset();
	sessionStorage.clear();
	mockValidateSecret.mockResolvedValue(true);
	mockGenerateTOTP.mockResolvedValue({ code: '123456', remainingSeconds: 25, progress: 0.83 });
	storeState = {
		accounts: [],
		addAccount: vi.fn(),
	};
	authStoreState = {
		user: { id: 'user_01', email: 'dev@example.com', username: 'testuser' },
	};
	authState = { isAuthenticated: true };
});

describe('AddAccountPage', () => {
	describe('rendering', () => {
		it('renders header with "添加账户" title', () => {
			renderAddAccount();
			expect(screen.getByRole('heading', { name: '添加账户' })).toBeInTheDocument();
		});

		it('renders all 3 tabs visible', () => {
			renderAddAccount();
			expect(screen.getByText('手动输入')).toBeInTheDocument();
			expect(screen.getByText('扫一扫')).toBeInTheDocument();
			expect(screen.getByText('Autional 绑定')).toBeInTheDocument();
		});

		it('renders bottom nav', () => {
			renderAddAccount();
			expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
		});

		it('renders back navigation button with aria-label', () => {
			renderAddAccount();
			expect(screen.getByRole('button', { name: '返回首页' })).toBeInTheDocument();
		});
	});

	describe('manual entry tab (default)', () => {
		it('renders form with service name, username, secret inputs', () => {
			renderAddAccount();
			expect(screen.getByLabelText(/服务名称/)).toBeInTheDocument();
			expect(screen.getByLabelText(/用户账号/)).toBeInTheDocument();
			expect(screen.getByLabelText(/密钥/)).toBeInTheDocument();
		});

		it('renders "添加账户" submit button', () => {
			renderAddAccount();
			expect(screen.getByRole('button', { name: '添加账户' })).toBeInTheDocument();
		});

		it('renders secret hint text', () => {
			renderAddAccount();
			expect(screen.getByText(/从目标服务的 MFA 设置页面复制密钥/)).toBeInTheDocument();
		});

		it('shows error message when submitting empty form', async () => {
			renderAddAccount();
			const submitBtn = screen.getByRole('button', { name: '添加账户' });
			await act(async () => {
				fireEvent.click(submitBtn);
			});
			await waitFor(() => {
				expect(screen.getByText('请填写所有必填字段')).toBeInTheDocument();
			});
		});
	});

	describe('form validation and submission', () => {
		it('fills form and submits successfully', async () => {
			renderAddAccount();
			const nameInput = screen.getByLabelText(/服务名称/);
			const usernameInput = screen.getByLabelText(/用户账号/);
			const secretInput = screen.getByLabelText(/密钥/);

			await act(async () => {
				fireEvent.change(nameInput, { target: { value: 'GitHub' } });
				fireEvent.change(usernameInput, { target: { value: 'dev@github.com' } });
				fireEvent.change(secretInput, { target: { value: 'JBSWY3DPEHPK3PXP' } });
			});

			const submitBtn = screen.getByRole('button', { name: '添加账户' });
			await act(async () => {
				fireEvent.click(submitBtn);
			});

			await waitFor(() => {
				expect(mockValidateSecret).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP');
			});
			await waitFor(() => {
				expect(storeState.addAccount).toHaveBeenCalledWith(
					expect.objectContaining({
						name: 'GitHub',
						username: 'dev@github.com',
						secret: 'JBSWY3DPEHPK3PXP',
						type: 'totp',
					}),
				);
			});
		});

		it('detects duplicate account', async () => {
			storeState = {
				accounts: [{ secret: 'JBSWY3DPEHPK3PXP', username: 'dev@github.com' }],
				addAccount: vi.fn(),
			};
			renderAddAccount();

			const nameInput = screen.getByLabelText(/服务名称/);
			const usernameInput = screen.getByLabelText(/用户账号/);
			const secretInput = screen.getByLabelText(/密钥/);

			await act(async () => {
				fireEvent.change(nameInput, { target: { value: 'GitHub' } });
				fireEvent.change(usernameInput, { target: { value: 'dev@github.com' } });
				fireEvent.change(secretInput, { target: { value: 'JBSWY3DPEHPK3PXP' } });
			});

			const submitBtn = screen.getByRole('button', { name: '添加账户' });
			await act(async () => {
				fireEvent.click(submitBtn);
			});

			await waitFor(() => {
				expect(screen.getByText('该账户已存在（相同的用户名和密钥）')).toBeInTheDocument();
			});
		});
	});

	describe('tab switching', () => {
		it('switches to QR tab and shows scanner text', async () => {
			renderAddAccount();
			const qrTab = screen.getByText('扫一扫');
			await act(async () => {
				fireEvent.click(qrTab);
			});
			expect(screen.getByTestId('qr-scanner')).toBeInTheDocument();
			expect(screen.getByText('将二维码对准扫描框')).toBeInTheDocument();
		});

		it('带 ?tab=qr 直接落在扫一扫（扫码入口）', async () => {
			render(
				<MemoryRouter initialEntries={['/platform/add?tab=qr']}>
					<Routes>
						<Route path="/:tenantSlug/add" element={<AddAccountPage />} />
					</Routes>
				</MemoryRouter>,
			);
			expect(await screen.findByTestId('qr-scanner')).toBeInTheDocument();
		});

		it('本地模式：隐藏 Autional 绑定页签，扫码登录给出可操作出路（不留黑屏）', async () => {
			authState.isAuthenticated = false;
			render(
				<MemoryRouter initialEntries={['/local/add']}>
					<Routes>
						<Route path="/:tenantSlug/add" element={<AddAccountPage />} />
					</Routes>
				</MemoryRouter>,
			);
			expect(screen.queryByText('Autional 绑定')).not.toBeInTheDocument();
			await act(async () => {
				fireEvent.click(screen.getByText('扫一扫'));
			});
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'scan-login-stub' }));
			});
			// 扫描器被换成卡片，而不是留在原地黑屏
			expect(screen.queryByTestId('qr-scanner')).not.toBeInTheDocument();
			expect(screen.getByText('扫码登录需要先登录 Autional 账号')).toBeInTheDocument();
			expect(screen.getByRole('button', { name: '登录并继续' })).toBeInTheDocument();
			expect(mockNavigate).not.toHaveBeenCalled();
		});

		it('未登录扫到登录码 → 重新扫码：扫描器恢复', async () => {
			authState.isAuthenticated = false;
			render(
				<MemoryRouter initialEntries={['/local/add']}>
					<Routes>
						<Route path="/:tenantSlug/add" element={<AddAccountPage />} />
					</Routes>
				</MemoryRouter>,
			);
			await act(async () => {
				fireEvent.click(screen.getByText('扫一扫'));
			});
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'scan-login-stub' }));
			});
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: '重新扫码' }));
			});
			expect(screen.getByTestId('qr-scanner')).toBeInTheDocument();
		});

		it('未登录扫到登录码 → 登录并继续：票据入 sessionStorage 并触发登录', async () => {
			authState.isAuthenticated = false;
			render(
				<MemoryRouter initialEntries={['/local/add']}>
					<Routes>
						<Route path="/:tenantSlug/add" element={<AddAccountPage />} />
					</Routes>
				</MemoryRouter>,
			);
			await act(async () => {
				fireEvent.click(screen.getByText('扫一扫'));
			});
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'scan-login-stub' }));
			});
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: '登录并继续' }));
			});
			expect(mockSignIn).toHaveBeenCalledTimes(1);
			expect(sessionStorage.getItem('authenticator.pending-approval.v1')).toContain('t1');
		});

		it('登录回跳后（sessionStorage 有票据）自动续上审批页', async () => {
			authState.isAuthenticated = true;
			savePendingApproval({ token: 't9', numberMatching: '87654321' });
			renderAddAccount();
			await waitFor(() => {
				expect(mockNavigate).toHaveBeenCalledWith('/login-approve?token=t9&nm=87654321');
			});
			expect(sessionStorage.getItem('authenticator.pending-approval.v1')).toBeNull();
		});

		it('票据已过期 → 提示重新扫码，不跳审批', async () => {
			authState.isAuthenticated = true;
			sessionStorage.setItem(
				'authenticator.pending-approval.v1',
				JSON.stringify({ token: 't_old', at: Date.now() - 6 * 60 * 1000 }),
			);
			renderAddAccount();
			await waitFor(() => {
				expect(vi.mocked(showToast)).toHaveBeenCalled();
			});
			expect(mockNavigate).not.toHaveBeenCalled();
		});

		it('QR 登录码：扫到 autional://login 后按当前租户跳审批页（slug 不丢）', async () => {
			render(
				<MemoryRouter initialEntries={['/platform/add']}>
					<Routes>
						<Route path="/:tenantSlug/add" element={<AddAccountPage />} />
					</Routes>
				</MemoryRouter>,
			);
			await act(async () => {
				fireEvent.click(screen.getByText('扫一扫'));
			});
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'scan-login-stub' }));
			});
			expect(mockNavigate).toHaveBeenCalledWith(
				'/login-approve?token=t1&nm=123456',
			);
		});

		it('switches to Autional bind tab and shows bind heading', async () => {
			renderAddAccount();
			const bindTab = screen.getByText('Autional 绑定');
			await act(async () => {
				fireEvent.click(bindTab);
			});
			expect(screen.getByText('从 Autional 绑定 TOTP')).toBeInTheDocument();
		});

		it('switching back to manual tab shows form again', async () => {
			renderAddAccount();
			const bindTab = screen.getByText('Autional 绑定');
			await act(async () => {
				fireEvent.click(bindTab);
			});
			const manualTab = screen.getByText('手动输入');
			await act(async () => {
				fireEvent.click(manualTab);
			});
			expect(screen.getByLabelText(/服务名称/)).toBeInTheDocument();
		});

		it('AU-04 降级集成：QrScanner onManualFallback 触发 → 切回手动输入 tab', async () => {
			renderAddAccount();
			await act(async () => {
				fireEvent.click(screen.getByText('扫一扫'));
			});
			expect(screen.getByTestId('qr-scanner')).toBeInTheDocument();

			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'manual-fallback-stub' }));
			});
			expect(screen.getByLabelText(/服务名称/)).toBeInTheDocument();
		});
	});

	describe('Autional bind tab', () => {
		it('renders bind description text', async () => {
			renderAddAccount();
			const bindTab = screen.getByText('Autional 绑定');
			await act(async () => {
				fireEvent.click(bindTab);
			});
			expect(screen.getByText(/一键从 Autional 后端获取 TOTP 密钥/)).toBeInTheDocument();
		});

		it('renders pre-filled service name input', async () => {
			renderAddAccount();
			const bindTab = screen.getByText('Autional 绑定');
			await act(async () => {
				fireEvent.click(bindTab);
			});
			const serviceInput = screen.getByDisplayValue('Autional');
			expect(serviceInput).toBeInTheDocument();
		});

		it('renders pre-filled username input from auth store', async () => {
			renderAddAccount();
			const bindTab = screen.getByText('Autional 绑定');
			await act(async () => {
				fireEvent.click(bindTab);
			});
			const usernameInput = screen.getByDisplayValue('dev@example.com');
			expect(usernameInput).toBeInTheDocument();
		});

		it('renders "获取 TOTP 密钥" button', async () => {
			renderAddAccount();
			const bindTab = screen.getByText('Autional 绑定');
			await act(async () => {
				fireEvent.click(bindTab);
			});
			expect(screen.getByRole('button', { name: '获取 TOTP 密钥' })).toBeInTheDocument();
		});
	});

	describe('back navigation', () => {
		it('clicking back button navigates to home', async () => {
			renderAddAccount();
			const backBtn = screen.getByRole('button', { name: '返回首页' });
			await act(async () => {
				fireEvent.click(backBtn);
			});
			expect(mockNavigate).toHaveBeenCalledWith('/');
		});
	});
});
