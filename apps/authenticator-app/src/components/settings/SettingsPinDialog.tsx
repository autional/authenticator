import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import PinKeypad from '@/components/PinKeypad';
import { PIN_LENGTH } from '@/lib/crypto';
import { checkPinCooldown } from '@/lib/storage';

type PinStep = 'verify' | 'new' | 'confirm';

interface Props {
	open: boolean;
	onClose: () => void;
	/** 校验当前 PIN（父组件注入 storage.verifyPin） */
	verifyCurrent: (pin: string) => Promise<boolean>;
	/** 提交新 PIN（父组件注入 setPinProtection）；返回 true 表示成功 */
	onSubmitNew: (pin: string) => Promise<boolean>;
}

/**
 * 修改应用锁 PIN 的弹层：先验旧 PIN，再设新 PIN，最后确认。
 *
 * 为什么必须先验旧 PIN：改 PIN 会重写 PIN 包裹（deviceKey 的钥匙），
 * 不验旧值等于任何拿到已解锁页面的人都能把库「换成」自己知道的 PIN。
 * 键盘沿用 PinKeypad（与解锁屏同一套输入面，无输入框、无密码管理器诱因）。
 */
export default function SettingsPinDialog({ open, onClose, verifyCurrent, onSubmitNew }: Props) {
	const { t } = useTranslation();
	const [step, setStep] = useState<PinStep>('verify');
	const [value, setValue] = useState('');
	const [currentPin, setCurrentPin] = useState('');
	const [newPin, setNewPin] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [shakeKey, setShakeKey] = useState(0);
	const [saving, setSaving] = useState(false);
	// 防重入：键盘 autoSubmit 是 effect 触发的，异步校验期间再敲一位会重放提交
	const busyRef = useRef(false);

	// 每次打开都从头开始（旧 PIN → 新 PIN → 确认），不复用上次的半截输入
	useEffect(() => {
		if (!open) return;
		setStep('verify');
		setValue('');
		setCurrentPin('');
		setNewPin('');
		setError(null);
		setShakeKey(0);
		setSaving(false);
		busyRef.current = false;
	}, [open]);

	if (!open) return null;

	/** 统一错误反馈：报错 + 抖动 + 清空当前步输入（停在原位而不是回退） */
	const fail = (message: string) => {
		setError(message);
		setShakeKey((k) => k + 1);
		setValue('');
	};

	const handleChange = (next: string) => {
		if (error) setError(null);
		setValue(next);
	};

	const handleSubmit = async () => {
		if (busyRef.current) return;
		busyRef.current = true;
		try {
			if (step === 'verify') {
				const ok = await verifyCurrent(value);
				if (!ok) {
					// 失败原因二选一：冷却中（尝试次数用满）优先于「PIN 不对」，否则用户会一直以为是自己记错
					const cooldown = checkPinCooldown();
					fail(
						cooldown.isLocked
							? t('settings.pinLocked', { seconds: cooldown.remainingSeconds })
							: t('settings.pinWrongCurrent'),
					);
					return;
				}
				setCurrentPin(value);
				setError(null);
				setValue('');
				setStep('new');
				return;
			}

			if (step === 'new') {
				if (value === currentPin) {
					fail(t('settings.pinSameAsOld'));
					return;
				}
				setNewPin(value);
				setError(null);
				setValue('');
				setStep('confirm');
				return;
			}

			if (value !== newPin) {
				// 两遍不一致：回到「输入新 PIN」并清空，停在确认步只会反复对不上
				fail(t('settings.pinMismatch'));
				setNewPin('');
				setStep('new');
				return;
			}

			setSaving(true);
			const ok = await onSubmitNew(newPin);
			if (ok) {
				onClose();
				return;
			}
			setSaving(false);
			fail(t('settings.pinFailed'));
		} finally {
			busyRef.current = false;
		}
	};

	const hint =
		step === 'verify'
			? t('settings.pinStepCurrent')
			: step === 'new'
				? t('settings.pinStepNew')
				: t('settings.pinStepConfirm');

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="pin-dialog-title"
			className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 backdrop-blur-sm p-4"
		>
			<div className="w-full max-w-xs rounded-xl border border-auth-border bg-auth-surface p-5">
				<h3
					id="pin-dialog-title"
					className="mb-1 text-base font-semibold text-[var(--color-text-primary)]"
				>
					{t('settings.pinDialogTitle')}
				</h3>
				<p className="mb-4 text-xs text-[var(--color-text-secondary)]">{hint}</p>

				{error && (
					<p
						role="alert"
						className="mb-3 flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-xs text-[var(--color-danger-text)]"
					>
						<AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
						{error}
					</p>
				)}

				<div className="flex justify-center">
					<PinKeypad
						value={value}
						onChange={handleChange}
						onSubmit={handleSubmit}
						minLength={PIN_LENGTH}
						maxLength={PIN_LENGTH}
						autoSubmitAt={PIN_LENGTH}
						showConfirm={false}
						disabled={saving}
						error={!!error}
						shakeKey={shakeKey}
					/>
				</div>

				<button
					type="button"
					onClick={onClose}
					disabled={saving}
					className="mt-4 w-full rounded-lg bg-auth-elevated py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-auth-border transition-colors disabled:opacity-50"
				>
					{t('common.cancel')}
				</button>
			</div>
		</div>
	);
}
