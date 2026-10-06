import { describe, it, expect, vi, beforeEach } from 'vitest';
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

interface MockStoreState {
	accounts: unknown[];
}
let storeState: MockStoreState = { accounts: [] };
vi.mock('@/lib/store', () => ({
	useAuthenticatorStore: (selector?: unknown) =>
		typeof selector === 'function'
			? (selector as (state: unknown) => unknown)(storeState)
			: storeState,
}));

const mockRefetch = vi.fn();
const mockSync = vi.fn();
const mockRemove = vi.fn();
const mockShowToast = vi.fn();
let mockRemoveError: string | null = null;
interface MockDevice {
	id: string;
	deviceName: string;
	deviceFingerprint: string;
	lastSyncAt: string;
	accountCount: number;
}
let mockDevices: MockDevice[] = [];
let mockLoading = false;
let mockError: string | null = null;

vi.mock('@/hooks/use-cloud-backup', () => ({
	useCloudBackup: () => ({
		backup: null,
		loading: false,
		error: null,
		refetch: vi.fn(),
	}),
	useUploadCloudBackup: () => ({
		upload: vi.fn(),
		uploading: false,
		error: null,
	}),
	useDownloadCloudBackup: () => ({
		download: vi.fn(),
		downloading: false,
		error: null,
	}),
	useDeviceSyncList: () => ({
		devices: mockDevices,
		loading: mockLoading,
		error: mockError,
		refetch: mockRefetch,
	}),
	useSyncDevice: () => ({
		sync: mockSync,
		syncing: false,
		error: null,
	}),
	useDeleteSyncDevice: () => ({
		remove: mockRemove,
		removing: false,
		error: mockRemoveError,
	}),
}));

vi.mock('@autional/ui', () => ({
	showToast: (...args: unknown[]) => mockShowToast(...args),
}));

import DeviceSyncPage from '../device-sync/page';

function renderPage() {
	return render(
		<MemoryRouter initialEntries={['/device-sync']}>
			<DeviceSyncPage />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockSync.mockReset();
	mockRemove.mockReset();
	mockShowToast.mockReset();
	storeState = { accounts: [] };
	mockDevices = [];
	mockLoading = false;
	mockError = null;
	mockRemoveError = null;
});

describe('DeviceSyncPage', () => {
	it('renders header', async () => {
		renderPage();
		expect(screen.getByText('设备同步')).toBeInTheDocument();
	});

	it('renders section headers', async () => {
		renderPage();
		expect(screen.getByText('同步设备列表')).toBeInTheDocument();
		expect(screen.getByText('操作')).toBeInTheDocument();
	});

	it('renders sync button', async () => {
		renderPage();
		expect(screen.getByText('同步本设备')).toBeInTheDocument();
	});

	it('renders refresh button', async () => {
		renderPage();
		expect(screen.getByText('刷新设备列表')).toBeInTheDocument();
	});

	it('shows empty state when no synced devices', async () => {
		mockDevices = [];
		renderPage();
		expect(screen.getByText('暂无已同步的设备')).toBeInTheDocument();
		expect(screen.getByText('同步设备后可在多设备间共享 TOTP 账户数据')).toBeInTheDocument();
	});

	it('shows loading spinner when fetching devices', async () => {
		mockLoading = true;
		renderPage();
		const spinners = document.querySelectorAll('.animate-spin');
		expect(spinners.length).toBeGreaterThan(0);
	});

	it('shows error banner when error is set', async () => {
		mockError = '获取设备列表失败';
		renderPage();
		expect(screen.getByText('获取设备列表失败')).toBeInTheDocument();
	});

	it('renders device list when devices exist', async () => {
		mockDevices = [
			{
				id: 'dev-1',
				deviceName: 'iPhone 15',
				deviceFingerprint: 'a1b2c3d4e5f6g7h8',
				lastSyncAt: '2025-01-15T08:00:00.000Z',
				accountCount: 12,
			},
			{
				id: 'dev-2',
				deviceName: 'MacBook Pro',
				deviceFingerprint: 'x1y2z3w4v5u6t7s8',
				lastSyncAt: '2025-01-14T20:30:00.000Z',
				accountCount: 8,
			},
		];
		renderPage();

		expect(screen.getByText('iPhone 15')).toBeInTheDocument();
		expect(screen.getByText('MacBook Pro')).toBeInTheDocument();
		expect(screen.getByText('· 12 个账户')).toBeInTheDocument();
		expect(screen.getByText('· 8 个账户')).toBeInTheDocument();
	});

	it('shows device fingerprint truncated', async () => {
		mockDevices = [
			{
				id: 'dev-1',
				deviceName: 'iPhone',
				deviceFingerprint: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9',
				lastSyncAt: '2025-01-15T08:00:00.000Z',
				accountCount: 3,
			},
		];
		renderPage();

		const fingerprint = screen.getByTitle('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9');
		expect(fingerprint).toBeInTheDocument();
		expect(fingerprint.textContent).toBe('a1b2c3...q7r8s9');
	});

	it('sync button is disabled when no accounts', async () => {
		storeState.accounts = [];
		renderPage();
		const syncBtn = screen.getByText('同步本设备').closest('button')!;
		expect(syncBtn).toBeDisabled();
	});

	it('sync button is enabled when accounts exist', async () => {
		storeState.accounts = [{ id: '1', name: 'Test', username: 'u' }];
		renderPage();
		const syncBtn = screen.getByText('同步本设备').closest('button')!;
		expect(syncBtn).not.toBeDisabled();
	});

	it('clicking sync triggers sync function', async () => {
		storeState.accounts = [
			{ id: '1', name: 'Test', username: 'u', secret: 'S1', algorithm: 'SHA1' },
		];
		renderPage();
		const syncBtn = screen.getByText('同步本设备').closest('button')!;
		await act(async () => {
			fireEvent.click(syncBtn);
		});
		expect(mockSync).toHaveBeenCalled();
	});

	it('clicking refresh calls refetch', async () => {
		renderPage();
		const refreshBtn = screen.getByText('刷新设备列表').closest('button')!;
		await act(async () => {
			fireEvent.click(refreshBtn);
		});
		expect(mockRefetch).toHaveBeenCalled();
	});

	it('back button navigates to settings', async () => {
		renderPage();
		const backBtn = screen.getByRole('button', { name: '返回' });
		await act(async () => {
			fireEvent.click(backBtn);
		});
		expect(mockNavigate).toHaveBeenCalledWith('/settings');
	});

	it('shows security note', async () => {
		renderPage();
		expect(screen.getByText(/服务器加密存储/)).toBeInTheDocument();
	});

	describe('AU-21 上限自恢复', () => {
		it('T1 同步 reject 61040100 → 上限提示 toast（直读本次错误）', async () => {
			storeState.accounts = [{ id: '1', name: 'Test', username: 'u', secret: 'S1' }];
			mockSync.mockRejectedValueOnce({
				response: { status: 400, data: { code: '61040100', title: 'device limit exceeded' } },
			});
			renderPage();
			await act(async () => {
				fireEvent.click(screen.getByText('同步本设备').closest('button')!);
			});
			await waitFor(() => {
				expect(mockShowToast).toHaveBeenCalledWith(
					'已达 5 台同步设备上限。请先移除不再使用的设备，或在本设备上重新同步（同一设备将原地更新）',
					'error',
				);
			});
		});

		it('T2a 解绑确认 → remove(id) + refetch + 成功 toast', async () => {
			mockDevices = [
				{
					id: 'dev-1',
					deviceName: 'iPhone 15',
					deviceFingerprint: 'a1b2c3d4e5f6g7h8',
					lastSyncAt: '2025-01-15T08:00:00.000Z',
					accountCount: 2,
				},
			];
			mockRemove.mockResolvedValueOnce(undefined);
			const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
			renderPage();
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: '移除' }));
			});
			confirmSpy.mockRestore();
			await waitFor(() => {
				expect(mockRemove).toHaveBeenCalledWith('dev-1');
			});
			expect(mockRefetch).toHaveBeenCalled();
			expect(mockShowToast).toHaveBeenCalledWith('已移除该设备', 'success');
		});

		it('T2b 取消确认 → 零删除请求、零 toast', async () => {
			mockDevices = [
				{
					id: 'dev-1',
					deviceName: 'iPhone 15',
					deviceFingerprint: 'a1b2c3d4e5f6g7h8',
					lastSyncAt: '2025-01-15T08:00:00.000Z',
					accountCount: 2,
				},
			];
			const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
			renderPage();
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: '移除' }));
			});
			confirmSpy.mockRestore();
			expect(mockRemove).not.toHaveBeenCalled();
			expect(mockShowToast).not.toHaveBeenCalled();
		});

		it('T3 行内解绑按钮：aria-label 到位 / id 空不渲染 / capNote 前置告知 / 失败回退文案', async () => {
			mockDevices = [
				{
					id: '',
					deviceName: 'NoIdDevice',
					deviceFingerprint: 'fp-no-id',
					lastSyncAt: '2025-01-15T08:00:00.000Z',
					accountCount: 1,
				},
				{
					id: 'dev-9',
					deviceName: 'iPhone 15',
					deviceFingerprint: 'fp-nine',
					lastSyncAt: '2025-01-15T08:00:00.000Z',
					accountCount: 2,
				},
			];
			renderPage();
			expect(screen.getByText('每账号最多同步 5 台设备')).toBeInTheDocument();
			const removeButtons = screen.getAllByRole('button', { name: '移除' });
			expect(removeButtons).toHaveLength(1);

			mockRemove.mockRejectedValueOnce(new Error('boom'));
			const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
			await act(async () => {
				fireEvent.click(removeButtons[0]);
			});
			confirmSpy.mockRestore();
			await waitFor(() => {
				expect(mockRemove).toHaveBeenCalledWith('dev-9');
			});
			expect(mockShowToast).toHaveBeenCalledWith('移除设备失败', 'error');
		});
	});
});
