import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Delete } from 'lucide-react';

/**
 * 自绘数字键盘 —— PIN 的唯一输入面。
 *
 * 为什么不用 <input>：纯数字的输入框（如 6 位 PIN）会被系统当成密码框（系统键盘 + 密码管理器
 * 「保存密码」提示）。按钮网格既没有输入框也没有表单提交语义，误判从根上消失。
 *
 * 无障碍：每个键都是真实 <button>（可 Tab 遍历、读屏可朗读），进度用 role="status"
 * 容器 + aria-live 文本播报；桌面物理键盘（数字 / 退格 / 回车）同样可用。
 */
export interface PinKeypadProps {
	value: string;
	onChange: (next: string) => void;
	onSubmit: () => void;
	/** 目标位数下限（当前所有调用方都传 6） */
	minLength: number;
	maxLength?: number;
	/** 达到该位数自动提交（与 minLength 同时满足才触发）。不传 = 不自动提交。 */
	autoSubmitAt?: number;
	/** 是否显示右下角确认键（默认 true）。自动提交场景传 false。 */
	showConfirm?: boolean;
	disabled?: boolean;
	/** 错误态：圆点转危险色 */
	error?: boolean;
	/** 抖动触发器：每次错误递增。仅靠 error 布尔值无法在同一错误态下重复抖动 */
	shakeKey?: number;
	footer?: ReactNode;
}

const LONG_PRESS_MS = 350;
const SHAKE_MS = 420;
/** 长按清空后的这段时间内忽略随之而来的 click（避免清空后又被删一位） */
const LONG_PRESS_CLICK_GUARD_MS = 800;

const DIGIT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** 焦点在可交互元素上时，回车交给该元素自己处理（不抢生物识别按钮的键盘激活） */
function isInteractiveTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	return (
		tag === 'BUTTON' ||
		tag === 'A' ||
		tag === 'INPUT' ||
		tag === 'TEXTAREA' ||
		tag === 'SELECT' ||
		target.isContentEditable ||
		target.getAttribute('role') === 'button'
	);
}

export default function PinKeypad({
	value,
	onChange,
	onSubmit,
	minLength,
	maxLength = 8,
	autoSubmitAt,
	showConfirm = true,
	disabled = false,
	error = false,
	shakeKey = 0,
	footer,
}: PinKeypadProps) {
	const { t } = useTranslation();
	const [shaking, setShaking] = useState(false);
	const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const longPressFiredAt = useRef(0);

	// 抖动：shakeKey 递增（首选）或 error false→true 都会重跑本 effect
	useEffect(() => {
		if (!error && !shakeKey) return;
		setShaking(true);
		const id = setTimeout(() => setShaking(false), SHAKE_MS);
		return () => clearTimeout(id);
	}, [error, shakeKey]);

	const cancelLongPress = useCallback(() => {
		if (longPressTimer.current) clearTimeout(longPressTimer.current);
		longPressTimer.current = null;
	}, []);

	// 卸载时清掉未触发的长按定时器（避免卸载后 setState）
	useEffect(() => cancelLongPress, [cancelLongPress]);

	const haptic = useCallback(() => {
		try {
			navigator.vibrate?.(8);
		} catch {
			/* 桌面 / 不支持则忽略 */
		}
	}, []);

	const append = useCallback(
		(digit: string) => {
			if (disabled || value.length >= maxLength) return;
			haptic();
			onChange(value + digit);
		},
		[disabled, haptic, maxLength, onChange, value],
	);

	const backspace = useCallback(() => {
		if (disabled || value.length === 0) return;
		haptic();
		onChange(value.slice(0, -1));
	}, [disabled, haptic, onChange, value]);

	const clearAll = useCallback(() => {
		if (disabled || value.length === 0) return;
		haptic();
		onChange('');
	}, [disabled, haptic, onChange, value]);

	const submit = useCallback(() => {
		if (disabled || value.length < minLength) return;
		onSubmit();
	}, [disabled, minLength, onSubmit, value.length]);

	// 自动提交：输满目标位数即提交（ref 防同一值重复触发；退位后复位）
	const autoFiredRef = useRef(false);
	useEffect(() => {
		if (autoSubmitAt === undefined) return;
		if (disabled || value.length !== autoSubmitAt || autoSubmitAt < minLength) {
			if (value.length < autoSubmitAt) autoFiredRef.current = false;
			return;
		}
		if (autoFiredRef.current) return;
		autoFiredRef.current = true;
		onSubmit();
	}, [autoSubmitAt, disabled, minLength, onSubmit, value.length]);

	// 物理键盘（桌面）：数字追加 / Backspace 退位 / Enter 提交
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (disabled) return;
			// 组合键留给浏览器（Ctrl+1 切标签页等）
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (/^[0-9]$/.test(e.key)) {
				e.preventDefault();
				append(e.key);
			} else if (e.key === 'Backspace') {
				e.preventDefault();
				backspace();
			} else if (e.key === 'Enter') {
				if (isInteractiveTarget(e.target)) return;
				e.preventDefault();
				submit();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [append, backspace, disabled, submit]);

	const startLongPress = useCallback(() => {
		if (disabled || value.length === 0) return;
		cancelLongPress();
		longPressTimer.current = setTimeout(() => {
			longPressTimer.current = null;
			longPressFiredAt.current = Date.now();
			clearAll();
		}, LONG_PRESS_MS);
	}, [cancelLongPress, clearAll, disabled, value.length]);

	const handleDeleteClick = useCallback(() => {
		if (longPressFiredAt.current && Date.now() - longPressFiredAt.current < LONG_PRESS_CLICK_GUARD_MS) {
			longPressFiredAt.current = 0;
			return;
		}
		backspace();
	}, [backspace]);

	const canSubmit = value.length >= minLength;
	const slots = Math.max(minLength, value.length);
	const dotFilled = error ? 'bg-danger' : 'bg-primary-500';

	return (
		<div className="flex w-full max-w-xs flex-col items-center">
			{/* 圆点：起步显示 minLength 个，超过则跟着增长 */}
			<div
				role="status"
				aria-label={t('unlock.pinAria')}
				className={`mb-6 flex h-6 items-center justify-center gap-3 ${shaking ? 'pin-shake' : ''}`}
			>
				{Array.from({ length: slots }).map((_, i) => (
					<span
						key={i}
						aria-hidden="true"
						className={`h-3 w-3 rounded-full transition-all duration-150 ${
							i < value.length ? `scale-100 ${dotFilled}` : 'scale-90 border border-auth-border bg-transparent'
						}`}
					/>
				))}
			</div>
			<p className="sr-only" aria-live="polite">
				{t('keypad.entered', { count: value.length })}
			</p>

			<div role="group" aria-label={t('keypad.aria')} className="grid grid-cols-3 gap-3">
				{DIGIT_KEYS.map((d) => (
					<button
						key={d}
						type="button"
						onClick={() => append(d)}
						disabled={disabled}
						aria-label={d}
						className="h-[68px] w-[68px] rounded-full border border-auth-border bg-auth-elevated text-2xl font-medium text-[var(--color-text-primary)] transition-transform duration-100 active:scale-95 disabled:opacity-40"
					>
						{d}
					</button>
				))}

				<button
					type="button"
					onClick={handleDeleteClick}
					onPointerDown={startLongPress}
					onPointerUp={cancelLongPress}
					onPointerLeave={cancelLongPress}
					onPointerCancel={cancelLongPress}
					onContextMenu={(e) => e.preventDefault()}
					disabled={disabled || value.length === 0}
					aria-label={t('keypad.delete')}
					className="flex h-[68px] w-[68px] items-center justify-center rounded-full border border-auth-border bg-auth-surface text-[var(--color-text-secondary)] transition-transform duration-100 active:scale-95 disabled:opacity-30"
				>
					<Delete className="h-5 w-5" aria-hidden="true" />
				</button>

				<button
					type="button"
					onClick={() => append('0')}
					disabled={disabled}
					aria-label="0"
					className="h-[68px] w-[68px] rounded-full border border-auth-border bg-auth-elevated text-2xl font-medium text-[var(--color-text-primary)] transition-transform duration-100 active:scale-95 disabled:opacity-40"
				>
					0
				</button>

				{showConfirm ? (
					<button
						type="button"
						onClick={submit}
						disabled={disabled || !canSubmit}
						aria-label={t('keypad.confirm')}
						className="flex h-[68px] w-[68px] items-center justify-center rounded-full bg-primary-600 text-white transition-all duration-100 active:scale-95 disabled:opacity-30"
					>
						<Check className="h-6 w-6" aria-hidden="true" />
					</button>
				) : (
					/* 自动提交场景：占位保持 3 列网格对齐 */
					<span className="h-[68px] w-[68px]" aria-hidden="true" />
				)}
			</div>

			<p className="mt-4 text-xs text-[var(--color-text-muted)]">{t('keypad.clearHint')}</p>

			{footer}
		</div>
	);
}
