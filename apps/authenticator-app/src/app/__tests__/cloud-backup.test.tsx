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
const mockPrepareNew = vi.fn();
const mockUploadPrepared = vi.fn();
const mockUploadExisting = vi.fn();
const mockDownloadLegacy = vi.fn().mockResolvedValue([]);
const mockDownloadV2 = vi.fn().mockResolvedValue([]);

interface MockBackup {
	id: string;
	createdAt: string;
	accountCount: number;
	version: number;
	deviceName: string;
}
let mockBackup: MockBackup | null = null;
let mockFormat: 'v1' | 'v2' | null = null;
let mockLoading = false;
let mockError: string | null = null;

vi.mock('@/hooks/use-cloud-backup', () => ({
	useCloudBackup: () => ({
		backup: mockBackup,
		format: mockFormat,
		needsRestore: null,
		loading: mockLoading,
		error: mockError,
		refetch: mockRefetch,
	}),
	useUploadCloudBackup: () => ({
		prepareNew: mockPrepareNew,
		uploadPrepared: mockUploadPrepared,
		uploadExisting: mockUploadExisting,
		uploading: false,
		error: null,
	}),
	useDownloadCloudBackup: () => ({
		downloadLegacy: mockDownloadLegacy,
		downloadV2: mockDownloadV2,
		downloading: false,
		error: null,
	}),
	useDeviceSyncList: () => ({
		devices: [],
		loading: false,
		error: null,
		refetch: vi.fn(),
	}),
	useSyncDevice: () => ({
		sync: vi.fn(),
		syncing: false,
		error: null,
	}),
}));

import CloudBackupPage from '../cloud-backup/page';

function renderPage() {
	return render(
		<MemoryRouter initialEntries={['/cloud-backup']}>
			<CloudBackupPage />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	storeState = { accounts: [] };
	mockBackup = null;
	mockFormat = null;
	mockLoading = false;
	mockError = null;
	mockDownloadLegacy.mockResolvedValue([]);
	mockDownloadV2.mockResolvedValue([]);
});

describe('CloudBackupPage', () => {
	it('renders header with back button', async () => {
		renderPage();
		expect(screen.getByText('云备份')).toBeInTheDocument();
	});

	it('renders section headers', async () => {
		renderPage();
		expect(screen.getByText('当前备份状态')).toBeInTheDocument();
		expect(screen.getByText('操作')).toBeInTheDocument();
	});

	it('renders upload and download buttons', async () => {
		renderPage();
		expect(screen.getByText('上传备份')).toBeInTheDocument();
		expect(screen.getByText('下载备份')).toBeInTheDocument();
	});

	it('renders refresh button', async () => {
		renderPage();
		expect(screen.getByText('刷新状态')).toBeInTheDocument();
	});

	it('shows "no backup" state when backup is null', async () => {
		mockBackup = null;
		renderPage();
		expect(screen.getByText('暂无云备份')).toBeInTheDocument();
		expect(screen.getByText('上传备份后可跨设备恢复您的 TOTP 账户')).toBeInTheDocument();
	});

	it('shows loading spinner when loading', async () => {
		mockLoading = true;
		renderPage();
		const spinners = document.querySelectorAll('.animate-spin');
		expect(spinners.length).toBeGreaterThan(0);
	});

	it('shows backup info when data is loaded', async () => {
		mockBackup = {
			id: 'backup-1',
			createdAt: '2025-01-15T10:30:00.000Z',
			accountCount: 5,
			version: 1,
			deviceName: 'iPhone',
		};
		mockFormat = 'v1';
		renderPage();
		expect(screen.getByText('上次备份时间')).toBeInTheDocument();
		expect(screen.getByText('账户数量')).toBeInTheDocument();
		expect(screen.getByText('5')).toBeInTheDocument();
		expect(screen.getByText('备份格式')).toBeInTheDocument();
		expect(screen.getByText('旧格式（仅本机）')).toBeInTheDocument();
		expect(screen.getByText('设备')).toBeInTheDocument();
		expect(screen.getByText('iPhone')).toBeInTheDocument();
	});

	it('shows error banner when error is set', async () => {
		mockError = '网络连接失败';
		renderPage();
		expect(screen.getByText('网络连接失败')).toBeInTheDocument();
	});

	it('upload is disabled when accounts is empty', async () => {
		storeState.accounts = [];
		renderPage();
		const uploadBtn = screen.getByText('上传备份').closest('button')!;
		expect(uploadBtn).toBeDisabled();
	});

	it('upload is enabled when accounts exist', async () => {
		storeState.accounts = [{ id: '1', name: 'Test', username: 'u' }];
		renderPage();
		const uploadBtn = screen.getByText('上传备份').closest('button')!;
		expect(uploadBtn).not.toBeDisabled();
	});

	it('clicking upload opens the passphrase dialog', async () => {
		storeState.accounts = [{ id: '1', name: 'Test', username: 'u' }];
		renderPage();
		const uploadBtn = screen.getByText('上传备份').closest('button')!;
		await act(async () => {
			fireEvent.click(uploadBtn);
		});
		expect(screen.getByText('设置备份口令')).toBeInTheDocument();
	});

	it('download v2 opens the restore dialog', async () => {
		mockBackup = {
			id: 'backup-1',
			createdAt: '2025-01-15T10:30:00.000Z',
			accountCount: 5,
			version: 2,
			deviceName: 'iPhone',
		};
		mockFormat = 'v2';
		renderPage();
		const downloadBtn = screen.getByText('下载备份').closest('button')!;
		await act(async () => {
			fireEvent.click(downloadBtn);
		});
		expect(screen.getByText('恢复云备份')).toBeInTheDocument();
	});

	it('download is disabled when no backup', async () => {
		mockBackup = null;
		renderPage();
		const downloadBtn = screen.getByText('下载备份').closest('button')!;
		expect(downloadBtn).toBeDisabled();
	});

	it('clicking refresh calls refetch', async () => {
		renderPage();
		const refreshBtn = screen.getByText('刷新状态').closest('button')!;
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
		expect(screen.getByText(/AES-256-GCM/)).toBeInTheDocument();
	});
});
