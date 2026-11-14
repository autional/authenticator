import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PinKeypad from '@/components/PinKeypad';

/**
 * 自绘数字键盘契约：没有输入框，全部靠按钮 + 物理键盘；
 * 值长度通过 aria-live 文案（已输入 N 位）与圆点容器体现。
 */

function Harness({
	minLength = 4,
	maxLength = 8,
	autoSubmitAt,
	showConfirm,
	onSubmit = () => {},
}: {
	minLength?: number;
	maxLength?: number;
	autoSubmitAt?: number;
	showConfirm?: boolean;
	onSubmit?: () => void;
}) {
	const [value, setValue] = useState('');
	return (
		<PinKeypad
			value={value}
			onChange={setValue}
			onSubmit={onSubmit}
			minLength={minLength}
			maxLength={maxLength}
			autoSubmitAt={autoSubmitAt}
			showConfirm={showConfirm}
		/>
	);
}

const entered = (n: number) => screen.getByText(`已输入 ${n} 位`);
const key = (name: string) => screen.getByRole('button', { name });

afterEach(() => {
	vi.useRealTimers();
});

describe('PinKeypad', () => {
	it('点数字键追加，超过 maxLength 不再追加', () => {
		render(<Harness minLength={4} maxLength={4} />);

		fireEvent.click(key('1'));
		fireEvent.click(key('2'));
		expect(entered(2)).toBeInTheDocument();

		fireEvent.click(key('3'));
		fireEvent.click(key('0'));
		expect(entered(4)).toBeInTheDocument();

		// 已达 maxLength：继续点不再追加
		fireEvent.click(key('5'));
		expect(entered(4)).toBeInTheDocument();
	});

	it('不足 minLength 时确认键 disabled，达到后可点并调用 onSubmit', () => {
		const onSubmit = vi.fn();
		render(<Harness minLength={6} onSubmit={onSubmit} />);

		const confirm = key('确认');
		expect(confirm).toBeDisabled();

		['1', '2', '3', '4', '5'].forEach((d) => fireEvent.click(key(d)));
		expect(confirm).toBeDisabled();
		fireEvent.click(confirm);
		expect(onSubmit).not.toHaveBeenCalled();

		fireEvent.click(key('6'));
		expect(confirm).toBeEnabled();
		fireEvent.click(confirm);
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it('删除键退一位；长按 400ms 清空', () => {
		vi.useFakeTimers();
		render(<Harness minLength={4} />);

		['1', '2', '3', '4'].forEach((d) => fireEvent.click(key(d)));
		expect(entered(4)).toBeInTheDocument();

		fireEvent.click(key('删除'));
		expect(entered(3)).toBeInTheDocument();

		// 长按删除键到阈值 → 清空
		fireEvent.pointerDown(key('删除'));
		act(() => {
			vi.advanceTimersByTime(400);
		});
		expect(entered(0)).toBeInTheDocument();
	});

	it('物理键盘：数字追加、Backspace 退位、Enter 提交', () => {
		const onSubmit = vi.fn();
		render(<Harness minLength={4} onSubmit={onSubmit} />);

		fireEvent.keyDown(window, { key: '1' });
		fireEvent.keyDown(window, { key: '2' });
		expect(entered(2)).toBeInTheDocument();

		fireEvent.keyDown(window, { key: 'Backspace' });
		expect(entered(1)).toBeInTheDocument();

		// 补到 minLength 后回车提交
		fireEvent.keyDown(window, { key: 'Enter' });
		expect(onSubmit).not.toHaveBeenCalled();

		['3', '4', '5'].forEach((d) => fireEvent.keyDown(window, { key: d }));
		expect(entered(4)).toBeInTheDocument();
		fireEvent.keyDown(window, { key: 'Enter' });
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it('组合键（Ctrl/Cmd/Alt + 数字）不吞浏览器快捷键', () => {
		render(<Harness minLength={4} />);

		fireEvent.keyDown(window, { key: '1', ctrlKey: true });
		fireEvent.keyDown(window, { key: '2', metaKey: true });
		expect(entered(0)).toBeInTheDocument();
	});

	it('autoSubmitAt：输满目标位数自动提交一次（不重复）', () => {
		const onSubmit = vi.fn();
		render(<Harness minLength={6} maxLength={6} autoSubmitAt={6} onSubmit={onSubmit} />);

		['1', '2', '3', '4', '5'].forEach((d) => fireEvent.click(key(d)));
		expect(onSubmit).not.toHaveBeenCalled();

		fireEvent.click(key('6'));
		expect(onSubmit).toHaveBeenCalledTimes(1);

		// 已满位（maxLength 6）再点不追加、也不重复提交
		fireEvent.click(key('7'));
		expect(entered(6)).toBeInTheDocument();
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it('showConfirm=false：不渲染确认键，但 Enter 仍可提交（人工兜底）', () => {
		const onSubmit = vi.fn();
		render(<Harness minLength={6} maxLength={6} showConfirm={false} onSubmit={onSubmit} />);

		expect(screen.queryByLabelText('确认')).toBeNull();
		expect(screen.getByRole('group', { name: '数字键盘' })).toBeInTheDocument();

		['1', '2', '3', '4', '5', '6'].forEach((d) => fireEvent.click(key(d)));
		expect(entered(6)).toBeInTheDocument();

		fireEvent.keyDown(window, { key: 'Enter' });
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});
});
