import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Check, AlertCircle } from 'lucide-react';
import PinKeypad from '@/components/PinKeypad';
import { PIN_LENGTH } from '@/lib/crypto';

type PinPhase = 'new' | 'confirm';

/**
 * 应用锁 PIN（设置页）：与解锁屏 / 强制设锁屏同一套输入面 —— 自绘数字键盘，
 * 6 位输满自动提交，没有输入框、没有表单、没有保存按钮。
 *
 * 为什么不支持「留空禁用」：冷启动是硬强制设锁（无 PIN 的库必须先设 PIN），
 * 禁用后下次打开又会被强制设回，属自相矛盾的入口，故移除。
 */
export default function SettingsPinProtection({
	hasPin,
	pinInput,
	onPinChange,
	pinSaving,
	pinMessage,
	onSave,
}: {
	hasPin: boolean;
	pinInput: string;
	onPinChange: (v: string) => void;
	pinSaving: boolean;
	pinMessage: { type: 'success' | 'error'; text: string } | null;
	onSave: (e?: React.FormEvent) => void;
}) {
	const { t } = useTranslation();
	const [phase, setPhase] = useState<PinPhase>('new');
	const [confirmPin, setConfirmPin] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [shakeKey, setShakeKey] = useState(0);

	// 父组件保存结束 → 回到首阶段并清掉确认值：
	// 否则键盘的 autoSubmit 已按满 6 位触发过，用户得先删一位才能重提。
	useEffect(() => {
		if (!pinMessage) return;
		setPhase('new');
		setConfirmPin('');
		if (pinMessage.type === 'success') {
			setError(null);
		} else {
			// 保存失败：连首遍输入一起清空（键盘 autoSubmit 已 fire，停在满 6 位会卡住重提）
			onPinChange('');
		}
	}, [pinMessage, onPinChange]);

	const handleNewChange = (next: string) => {
		if (error) setError(null);
		onPinChange(next);
	};

	const handleConfirmChange = (next: string) => {
		if (error) setError(null);
		setConfirmPin(next);
	};

	const handleNewSubmit = () => {
		setError(null);
		setPhase('confirm');
		setConfirmPin('');
	};

	const handleConfirmSubmit = () => {
		if (confirmPin !== pinInput) {
			setError(t('settings.pinMismatch'));
			setShakeKey((k) => k + 1);
			// 两遍不一致 → 回首遍并清空：停在 confirm 只会反复对不上
			setPhase('new');
			onPinChange('');
			setConfirmPin('');
			return;
		}
		setError(null);
		onSave();
	};

	const value = phase === 'new' ? pinInput : confirmPin;

	return (
		<div className="px-4 py-3">
			<div className="flex items-center gap-3 mb-2">
				<Lock className="h-4 w-4 text-[var(--color-text-secondary)]" />
				<span className="text-sm text-[var(--color-text-primary)]">{t('settings.pin')}</span>
				{hasPin && (
					<span className="ml-auto rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-success-text)]">
						{t('settings.pinEnabled')}
					</span>
				)}
			</div>
			<p className="text-[11px] text-[var(--color-text-muted)] mb-2">
				{hasPin ? t('settings.pinDescEnabled') : t('settings.pinDescDisabled')}
			</p>
			{!hasPin && (
				<p className="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-[11px] text-[var(--color-danger-text)]">
					{t('settings.pinUnprotectedWarning')}
				</p>
			)}
			{pinMessage && (
				<div
					className={`mb-2 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs ${pinMessage.type === 'success' ? 'bg-success/10 text-[var(--color-success-text)]' : 'bg-danger/10 text-[var(--color-danger-text)]'}`}
				>
					{pinMessage.type === 'success' ? (
						<Check className="h-3.5 w-3.5 shrink-0" />
					) : (
						<AlertCircle className="h-3.5 w-3.5 shrink-0" />
					)}
					{pinMessage.text}
				</div>
			)}
			{error && (
				<p
					role="alert"
					className="mb-2 flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-[11px] text-[var(--color-danger-text)]"
				>
					<AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					{error}
				</p>
			)}
			<p className="mb-3 text-center text-[11px] text-[var(--color-text-muted)]">
				{phase === 'new' ? t('settings.pinHintNew') : t('settings.pinHintConfirm')}
			</p>
			<div className="flex justify-center">
				<PinKeypad
					value={value}
					onChange={phase === 'new' ? handleNewChange : handleConfirmChange}
					onSubmit={phase === 'new' ? handleNewSubmit : handleConfirmSubmit}
					minLength={PIN_LENGTH}
					maxLength={PIN_LENGTH}
					autoSubmitAt={PIN_LENGTH}
					showConfirm={false}
					disabled={pinSaving}
					error={!!error}
					shakeKey={shakeKey}
					footer={
						pinSaving ? (
							<p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
								{t('settings.pinSaving')}
							</p>
						) : undefined
					}
				/>
			</div>
		</div>
	);
}
