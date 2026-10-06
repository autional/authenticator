import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { TotpAccount } from '@/lib/store';

/**
 * AU-03 回归锁：卡片内按钮与卡片导航隔离 ——
 * 复制/删除图标/删除浮层的点击一律 stopPropagation，不得触发 onEdit（进编辑页）。
 * AU-16①：删除图标 aria-label 走 i18n key card.deleteAccount。
 */
const { mockShowToast } = vi.hoisted(() => ({ mockShowToast: vi.fn() }));
vi.mock('@autional/ui', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@autional/ui')>();
	return { ...actual, showToast: mockShowToast };
});

const mockGenerateTOTP = vi.fn();
vi.mock('@/lib/totp', () => ({
	generateTOTP: (...args: unknown[]) => mockGenerateTOTP(...args),
}));

import TotpCard from '../../components/TotpCard';

const account: TotpAccount = {
	id: '1',
	name: 'GitHub',
	username: 'dev@example.com',
	secret: 'SECRET1',
	type: 'totp',
	algorithm: 'SHA1',
	digits: 6,
	period: 30,
	createdAt: 1700000000000,
};

function renderCard() {
	const props = { account, onDelete: vi.fn(), onEdit: vi.fn(), onPin: vi.fn() };
	render(<TotpCard {...props} />);
	return props;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGenerateTOTP.mockResolvedValue({ code: '123456', remainingSeconds: 25, progress: 0.83 });
	Object.defineProperty(navigator, 'clipboard', {
		value: { writeText: vi.fn().mockResolvedValue(undefined) },
		configurable: true,
	});
});

describe('TotpCard (AU-03 / AU-16①)', () => {
	it('AU-03 点复制 → 复制成功且不触发 onEdit', async () => {
		const props = renderCard();
		await screen.findByText('123456');

		await act(async () => {
			fireEvent.click(screen.getByText('123456'));
		});

		expect(navigator.clipboard.writeText).toHaveBeenCalledWith('123456');
		expect(props.onEdit).not.toHaveBeenCalled();
	});

	it('AU-03 点删除图标 → 浮层现，onEdit 零调用；取消 → 浮层收且 onEdit 零调用', async () => {
		const props = renderCard();
		await screen.findByText('123456');

		await act(async () => {
			fireEvent.click(screen.getByLabelText('删除账户'));
		});
		expect(screen.getByText('确认删除此账户？')).toBeInTheDocument();
		expect(props.onEdit).not.toHaveBeenCalled();

		await act(async () => {
			fireEvent.click(screen.getByText('取消'));
		});
		expect(screen.queryByText('确认删除此账户？')).toBeNull();
		expect(props.onEdit).not.toHaveBeenCalled();
	});

	it('AU-03 浮层确认删除 → onDelete 恰 1 次，onEdit 零调用', async () => {
		const props = renderCard();
		await screen.findByText('123456');

		await act(async () => {
			fireEvent.click(screen.getByLabelText('删除账户'));
		});
		await act(async () => {
			fireEvent.click(screen.getByText('删除'));
		});

		expect(props.onDelete).toHaveBeenCalledTimes(1);
		expect(props.onDelete).toHaveBeenCalledWith('1');
		expect(props.onEdit).not.toHaveBeenCalled();
	});

	it('AU-16① 删除图标 aria-label 走 i18n（zh「删除账户」）', async () => {
		renderCard();
		await screen.findByText('123456');
		expect(screen.getByLabelText('删除账户')).toBeInTheDocument();
	});
});

describe('TotpCard AU-08 剪贴板 30s 清空定时器（重臂 + 卸载清理）', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const writeTextMock = () => navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>;
	const emptyWrites = () => writeTextMock().mock.calls.filter((call) => call[0] === '').length;

	async function renderAndCopy() {
		renderCard();
		await act(async () => {});
		await act(async () => {
			fireEvent.click(screen.getByText('123456'));
		});
	}

	it('复制后 30s 恰 1 次空写入（正常清空）', async () => {
		await renderAndCopy();
		expect(writeTextMock()).toHaveBeenCalledWith('123456');
		expect(emptyWrites()).toBe(0);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(30000);
		});
		expect(emptyWrites()).toBe(1);
	});

	it('连点重臂：t=20s 再复制 → t=30s 无空写入、t=50s 恰 1 次', async () => {
		await renderAndCopy();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(20000);
		});
		await act(async () => {
			fireEvent.click(screen.getByText('123456'));
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10000); // t=30s：旧定时器已被取消
		});
		expect(emptyWrites()).toBe(0);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(20000); // t=50s：第二次复制后 30s
		});
		expect(emptyWrites()).toBe(1);
	});

	it('卸载后推进计时 → 无空写入（清理生效）', async () => {
		const view = render(<TotpCard account={account} onDelete={vi.fn()} onEdit={vi.fn()} onPin={vi.fn()} />);
		await act(async () => {});
		await act(async () => {
			fireEvent.click(screen.getByText('123456'));
		});

		view.unmount();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(30000);
		});
		expect(emptyWrites()).toBe(0);
	});
});
