import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
	const actual = await vi.importActual('react-router');
	return { ...actual, useNavigate: () => mockNavigate };
});

const { mockShowToast } = vi.hoisted(() => ({ mockShowToast: vi.fn() }));
vi.mock('@autional/ui', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@autional/ui')>();
	return { ...actual, showToast: mockShowToast };
});

const mockGenerateTOTP = vi.fn();
vi.mock('@/lib/totp', () => ({
	generateTOTP: (...args: unknown[]) => mockGenerateTOTP(...args),
}));

interface MockStoreState {
	accounts: unknown[];
	updateAccount: (id: string, updates: unknown) => void;
	removeAccount: (id: string) => void;
	toggleAccountPin: (id: string) => void;
	updateAccountOrder: (id: string, order: number) => void;
}
let storeState: MockStoreState;
vi.mock('@/lib/store', () => ({
	useAuthenticatorStore: (selector?: unknown) =>
		typeof selector === 'function' ? (selector as (s: unknown) => unknown)(storeState) : storeState,
}));

import AccountDetailPage from '../account/page';

const account = {
	id: '1',
	name: 'GitHub',
	username: 'dev@example.com',
	secret: 'JBSWY3DPEHPK3PXP',
	algorithm: 'SHA1',
	digits: 6,
	period: 30,
	createdAt: 1700000000000,
};

function renderAccount() {
	return render(
		<MemoryRouter initialEntries={['/account?id=1']}>
			<AccountDetailPage />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGenerateTOTP.mockResolvedValue({ code: '123456', remainingSeconds: 25, progress: 0.83 });
	storeState = {
		accounts: [account],
		updateAccount: vi.fn(),
		removeAccount: vi.fn(),
		toggleAccountPin: vi.fn(),
		updateAccountOrder: vi.fn(),
	};
});

describe('AccountDetailPage (AU-05 / AU-06)', () => {
	it('AU-05 密钥默认遮蔽（明文零渲染）→ 揭示可见 → 再点复掩码', async () => {
		renderAccount();

		expect(screen.queryByText('JBSWY3DPEHPK3PXP')).toBeNull();
		expect(screen.getByText('•••• •••• •••• ••••')).toBeInTheDocument();

		await act(async () => {
			fireEvent.click(screen.getByLabelText('显示密钥'));
		});
		expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();

		await act(async () => {
			fireEvent.click(screen.getByLabelText('隐藏密钥'));
		});
		expect(screen.queryByText('JBSWY3DPEHPK3PXP')).toBeNull();
		expect(screen.getByText('•••• •••• •••• ••••')).toBeInTheDocument();
	});

	it('AU-06 确认删除 → removeAccount + showToast（账户已删除）+ 跳转首页', async () => {
		renderAccount();

		await act(async () => {
			fireEvent.click(screen.getByText('删除此账户'));
		});
		expect(screen.getByText('确认删除？')).toBeInTheDocument();

		await act(async () => {
			fireEvent.click(screen.getByText('确认删除'));
		});

		expect(storeState.removeAccount).toHaveBeenCalledWith('1');
		expect(mockShowToast).toHaveBeenCalledWith('账户已删除', 'success');
		expect(mockNavigate).toHaveBeenCalledWith('/');
	});
});
