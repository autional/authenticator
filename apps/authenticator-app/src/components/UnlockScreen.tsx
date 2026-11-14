import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, ShieldAlert, AlertCircle, Fingerprint } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { showToast } from '@autional/ui';
import { useAuthenticatorStore } from '@/lib/store';
import PinKeypad from '@/components/PinKeypad';
import {
	unlockWithPin,
	hasPinProtection,
	loadWithoutPin,
	unlockWithBiometric,
	hasBiometricProtection,
	setPinProtection,
	setBiometricProtection,
	getPinLength,
	resetLocalVault,
	checkPinCooldown,
	recordFailedPinAttempt,
	resetFailedPinAttempts,
} from '@/lib/storage';
import {
	hasBiometricRegistered,
	isBiometricAvailable,
	verifyBiometric,
	hasPRFEnabled,
	isPRFSupported,
	registerBiometric,
	clearBiometric,
} from '@/lib/webauthn';
import { PIN_PATTERN, PIN_LENGTH, LEGACY_PIN_MIN_LENGTH, LEGACY_PIN_MAX_LENGTH } from '@/lib/crypto';
import { setCeremonyActive } from '@/lib/app-lock';

type UnlockMode = 'bio' | 'pin';
/** 「再点一次确认」的待触发窗口：超时自动复位，避免危险按钮长期挂在可执行态 */
const RESET_CONFIRM_TIMEOUT_MS = 5000;

function PinInputScreen() {
	const [pin, setPin] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [shakeKey, setShakeKey] = useState(0);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [bioUsable, setBioUsable] = useState(false);
	const [mode, setMode] = useState<UnlockMode>('pin');
	const [resetOpen, setResetOpen] = useState(false);
	// 存量库可能是 4-8 位：按库里记录的实际长度放开键盘。
	// null = 旧库未记录长度 → 走宽松区间（4-8）+ 确认键，解锁成功后 storage 会补写 pinLength。
	const [pinLength] = useState<number | null>(() => getPinLength());
	// 连续错满 MAX_PIN_ATTEMPTS 次后的冷却剩余秒数；> 0 时键盘不可用（生物识别不受影响）
	const [cooldownLeft, setCooldownLeft] = useState(0);
	const { t } = useTranslation();
	const loadAccounts = useAuthenticatorStore((s) => s.loadAccounts);
	const setHasPin = useAuthenticatorStore((s) => s.setHasPin);
	const autoTriedRef = useRef(false);

	// 失败后延迟清空输入（等抖动播完）：timer 存 ref 以免卸载后 setState
	const clearPinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const schedulePinClear = useCallback(() => {
		if (clearPinTimer.current) clearTimeout(clearPinTimer.current);
		clearPinTimer.current = setTimeout(() => {
			clearPinTimer.current = null;
			setPin('');
		}, 420);
	}, []);
	useEffect(
		() => () => {
			if (clearPinTimer.current) clearTimeout(clearPinTimer.current);
		},
		[],
	);

	// 冷却倒计时：挂载先同步一次（上一轮失败后刷新页面仍受节流），之后每秒刷新，
	// 归零即自动恢复键盘。与 storage.verifyPin 共用同一份尝试计数。
	useEffect(() => {
		const tick = () => {
			const { isLocked, remainingSeconds } = checkPinCooldown();
			setCooldownLeft(isLocked ? remainingSeconds : 0);
		};
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, []);

	// 探测生物识别能力：可用即把默认视图切到「生物识别优先」
	useEffect(() => {
		let cancelled = false;
		isBiometricAvailable().then((avail) => {
			if (cancelled) return;
			const usable =
				avail &&
				hasBiometricRegistered() &&
				isPRFSupported() &&
				hasPRFEnabled() &&
				hasBiometricProtection();
			setBioUsable(usable);
			if (usable) setMode('bio');
		});
		return () => {
			cancelled = true;
		};
	}, []);

	/** fromUser=false 表示自动尝试：失败文案用中性提示，不吓人 */
	const unlockWithPrf = useCallback(
		async (fromUser: boolean) => {
			setError(null);
			setIsSubmitting(true);
			// 系统生物识别弹窗会引发 visibility 抖动，期间抑制自动锁定（否则自锁循环）
			setCeremonyActive(true);
			try {
				const prfKey = await verifyBiometric();
				if (!prfKey || prfKey.length === 0) {
					// 用户取消 / 浏览器要求手势 / 凭据失效 → 落回 PIN，不重复弹窗
					setError(fromUser ? t('unlock.bioFailed') : t('unlock.bioFallback'));
					setMode('pin');
					return;
				}
				const accounts = await unlockWithBiometric(prfKey);
				loadAccounts(accounts);
				setHasPin(true);
			} catch {
				setError(fromUser ? t('unlock.bioFailed') : t('unlock.bioFallback'));
				setMode('pin');
			} finally {
				setCeremonyActive(false);
				setIsSubmitting(false);
			}
		},
		[loadAccounts, setHasPin, t],
	);

	// 生物识别优先：能力就绪后自动尝试一次；失败即落 PIN（autoTriedRef 防 StrictMode 双跑）
	useEffect(() => {
		if (mode !== 'bio' || !bioUsable || autoTriedRef.current) return;
		autoTriedRef.current = true;
		void unlockWithPrf(false);
	}, [mode, bioUsable, unlockWithPrf]);

	const handleUnlock = useCallback(async () => {
		if (isSubmitting) return;
		setError(null);

		// 冷却期直接拒绝：与 storage.verifyPin 同口径，不白跑一次 KDF
		const cooldown = checkPinCooldown();
		if (cooldown.isLocked) {
			setCooldownLeft(cooldown.remainingSeconds);
			return;
		}

		// 解锁按存量库的实际长度校验下限（新建/修改仍是 6 位；物理键盘回车等边缘入口靠这一层兜底）
		if (pin.length < (pinLength ?? LEGACY_PIN_MIN_LENGTH)) {
			setError(t('unlock.pinTooShort'));
			setShakeKey((k) => k + 1);
			return;
		}

		setIsSubmitting(true);
		try {
			const accounts = await unlockWithPin(pin);
			resetFailedPinAttempts();
			setCooldownLeft(0);
			loadAccounts(accounts);
			setHasPin(true);
		} catch {
			// 失败计入节流：第 MAX_PIN_ATTEMPTS 次失败进入冷却，冷却期显示倒计时而不是「PIN 错误」
			const state = recordFailedPinAttempt();
			if (state.lockedUntil !== null && state.lockedUntil > Date.now()) {
				setCooldownLeft(Math.ceil((state.lockedUntil - Date.now()) / 1000));
			} else {
				setError(t('unlock.pinWrong'));
			}
			setShakeKey((k) => k + 1);
			schedulePinClear();
		} finally {
			setIsSubmitting(false);
		}
	}, [
		isSubmitting,
		loadAccounts,
		pin,
		pinLength,
		schedulePinClear,
		setHasPin,
		t,
	]);

	if (mode === 'bio') {
		return (
			<main className="flex app-shell flex-col items-center justify-center bg-auth-bg px-6">
				<div className="mb-8 flex h-20 w-20 items-center justify-center rounded-lg bg-primary-500/10">
					<Fingerprint className="h-10 w-10 text-primary-500" />
				</div>
				<h1 className="mb-2 text-xl font-bold text-[var(--color-text-primary)]">
					{t('app.title')}
				</h1>
				<p className="mb-8 text-sm text-[var(--color-text-secondary)]">{t('unlock.bioPrompt')}</p>
				{error && (
					<div className="mb-4 flex w-full max-w-xs items-center gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-sm text-[var(--color-danger-text)]">
						<AlertCircle className="h-4 w-4 shrink-0" />
						{error}
					</div>
				)}
				<button
					type="button"
					onClick={() => void unlockWithPrf(true)}
					disabled={isSubmitting}
					className="flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white hover:bg-primary-500 active:scale-[0.98] disabled:opacity-50 transition-all"
				>
					<Fingerprint className="h-4 w-4" />
					{isSubmitting ? t('unlock.unlocking') : t('unlock.useBiometric')}
				</button>
				<button
					type="button"
					onClick={() => setMode('pin')}
					className="mt-4 text-xs text-[var(--color-text-secondary)] underline-offset-2 hover:underline"
				>
					{t('unlock.usePinInstead')}
				</button>
			</main>
		);
	}

	return (
		<main className="flex app-shell flex-col items-center justify-center bg-auth-bg px-6">
			<div className="mb-8 flex h-20 w-20 items-center justify-center rounded-lg bg-primary-500/10">
				<ShieldCheck className="h-10 w-10 text-primary-500" />
			</div>
			<h1 className="mb-2 text-xl font-bold text-[var(--color-text-primary)]">{t('app.title')}</h1>
			<p className="mb-6 text-sm text-[var(--color-text-secondary)]">
				{bioUsable ? t('unlock.bioOrPin') : t('unlock.enterPin')}
			</p>

			{error && (
				<div
					role="alert"
					className="mb-4 flex w-full max-w-xs items-center gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-sm text-[var(--color-danger-text)]"
				>
					<AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
					{error}
				</div>
			)}

			{cooldownLeft > 0 && (
				<div
					role="status"
					className="mb-4 flex w-full max-w-xs items-center gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-sm text-[var(--color-danger-text)]"
				>
					<AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
					{t('unlock.pinLocked', { seconds: cooldownLeft })}
				</div>
			)}

			<PinKeypad
				value={pin}
				onChange={setPin}
				onSubmit={() => void handleUnlock()}
				// 存量库按实际长度放开；新库仍是 6 位输满即自动提交（无确认键）
				minLength={pinLength ?? LEGACY_PIN_MIN_LENGTH}
				maxLength={pinLength ?? LEGACY_PIN_MAX_LENGTH}
				autoSubmitAt={pinLength ?? undefined}
				showConfirm={pinLength === null}
				disabled={isSubmitting || cooldownLeft > 0}
				error={!!error}
				shakeKey={shakeKey}
				footer={
					<>
						{isSubmitting ? (
							<p className="mt-6 text-xs text-[var(--color-text-secondary)]">
								{t('unlock.unlocking')}
							</p>
						) : bioUsable ? (
							<button
								type="button"
								onClick={() => void unlockWithPrf(true)}
								className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-auth-border bg-auth-surface py-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-auth-elevated transition-all"
							>
								<Fingerprint className="h-4 w-4" aria-hidden="true" />
								{t('unlock.useBiometric')}
							</button>
						) : null}
						{/* 逃生口：旧长度库现在能直接解锁，只有真的忘记 PIN 才需要清空重来 */}
						<button
							type="button"
							onClick={() => setResetOpen(true)}
							className="mt-4 text-xs text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-text-secondary)] hover:underline"
						>
							{t('settings.pinForgot')}
						</button>
					</>
				}
			/>

			<VaultResetDialog open={resetOpen} onClose={() => setResetOpen(false)} />
		</main>
	);
}

type SetupPhase = 'enter' | 'confirm';

/**
 * 强制设锁：无 PIN 的库（新装 / 老版本升级）冷启动时必须先设置 PIN 才能使用。
 * 没有跳过入口 —— PIN 是生物识别凭据丢失后唯一的恢复通道。
 * 两阶段（enter → confirm）用同一个自绘键盘，避免两个输入框 + 系统键盘。
 */
function SetupLockScreen({ onDone }: { onDone: () => void }) {
	const { t } = useTranslation();
	const setHasPin = useAuthenticatorStore((s) => s.setHasPin);
	const [phase, setPhase] = useState<SetupPhase>('enter');
	const [pin, setPin] = useState('');
	const [confirmPin, setConfirmPin] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [shakeKey, setShakeKey] = useState(0);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [bioAvailable, setBioAvailable] = useState(false);
	const [enableBio, setEnableBio] = useState(false);

	// 失败后延迟清空当前输入（等抖动播完）：timer 存 ref 以免卸载后 setState
	const clearPinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const cancelPinClear = useCallback(() => {
		if (clearPinTimer.current) clearTimeout(clearPinTimer.current);
		clearPinTimer.current = null;
	}, []);
	const schedulePinClear = useCallback(() => {
		cancelPinClear();
		clearPinTimer.current = setTimeout(() => {
			clearPinTimer.current = null;
			if (phase === 'enter') setPin('');
			else setConfirmPin('');
		}, 420);
	}, [cancelPinClear, phase]);
	useEffect(() => cancelPinClear, [cancelPinClear]);

	useEffect(() => {
		let cancelled = false;
		isBiometricAvailable().then((avail) => {
			if (!cancelled) setBioAvailable(avail);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const value = phase === 'enter' ? pin : confirmPin;

	const handleChange = (next: string) => {
		// 用户已重新输入：取消挂起的清空，否则定时器会把刚敲的数字一起抹掉
		cancelPinClear();
		if (phase === 'enter') setPin(next);
		else setConfirmPin(next);
		// 重新输入即清错：提示与抖动只针对上一次提交
		if (error) setError(null);
	};

	/** 确认阶段退回重输：首遍输错时不给出口，用户会被困在无法跳过的设锁屏里 */
	const restart = () => {
		cancelPinClear();
		setPin('');
		setConfirmPin('');
		setError(null);
		setPhase('enter');
	};

	const finish = async (finalPin: string) => {
		setError(null);
		setIsSubmitting(true);
		try {
			await setPinProtection(finalPin);
			setHasPin(true);
		} catch {
			setError(t('setup.failed'));
			setShakeKey((k) => k + 1);
			setIsSubmitting(false);
			// 输入仍是满 6 位且键盘已 autoFired：不手动清空的话用户只能先删一位才能重提
			schedulePinClear();
			return;
		}

		// 生物识别是叠加项：注册/包裹失败不回滚 PIN（PIN 才是恢复通道）
		if (enableBio && bioAvailable) {
			try {
				const registered = await registerBiometric();
				const prfKey = registered ? await verifyBiometric() : null;
				if (prfKey && prfKey.length > 0) {
					await setBiometricProtection(prfKey);
				} else {
					// 注册了凭据却没拿到 PRF 输出（用户在二次弹窗取消）→ 清掉凭据，
					// 否则设置页会显示「已启用」但解锁屏没有生物识别入口。
					clearBiometric();
					showToast(t('settings.biometricFailed'), 'error');
				}
			} catch {
				clearBiometric();
				showToast(t('settings.biometricFailed'), 'error');
			}
		}

		setIsSubmitting(false);
		onDone();
	};

	const handleStageDone = () => {
		if (isSubmitting) return;

		if (phase === 'enter') {
			// 自动提交只在满 6 位时触发，长度已由键盘保证；形态校验保留作防御
			if (!PIN_PATTERN.test(pin)) {
				setError(t('setup.weak'));
				setShakeKey((k) => k + 1);
				setPin('');
				return;
			}
			setError(null);
			setPhase('confirm');
			return;
		}

		if (confirmPin !== pin) {
			setError(t('setup.mismatch'));
			setShakeKey((k) => k + 1);
			// 回到首遍并清空两值：用户可能第一遍就输错了，停在 confirm 只会反复对不上
			setPin('');
			setConfirmPin('');
			setPhase('enter');
			return;
		}

		void finish(pin);
	};

	return (
		<main className="flex app-shell flex-col items-center justify-center bg-auth-bg px-6">
			<div className="mb-8 flex h-20 w-20 items-center justify-center rounded-lg bg-primary-500/10">
				<ShieldCheck className="h-10 w-10 text-primary-500" />
			</div>
			<h1 className="mb-2 text-center text-xl font-bold text-[var(--color-text-primary)]">
				{t('setup.title')}
			</h1>
			<p className="mb-2 text-center text-sm text-[var(--color-text-secondary)]">{t('setup.desc')}</p>
			<p className="mb-4 flex items-center gap-2 text-center text-xs text-[var(--color-text-muted)]">
				{phase === 'enter' ? t('setup.hintEnter') : t('setup.hintConfirm')}
				{phase === 'confirm' && (
					<button
						type="button"
						onClick={restart}
						disabled={isSubmitting}
						className="underline underline-offset-2 hover:text-[var(--color-text-secondary)] disabled:opacity-50"
					>
						{t('setup.hintRestart')}
					</button>
				)}
			</p>

			{error && (
				<div
					role="alert"
					className="mb-4 flex w-full max-w-xs items-center gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-sm text-[var(--color-danger-text)]"
				>
					<AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
					{error}
				</div>
			)}

			<PinKeypad
				value={value}
				onChange={handleChange}
				onSubmit={handleStageDone}
				minLength={PIN_LENGTH}
				maxLength={PIN_LENGTH}
				autoSubmitAt={PIN_LENGTH}
				showConfirm={false}
				disabled={isSubmitting}
				error={!!error}
				shakeKey={shakeKey}
				footer={
					bioAvailable ? (
						<label className="mt-6 flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
							<input
								type="checkbox"
								checked={enableBio}
								onChange={(e) => setEnableBio(e.target.checked)}
								className="h-4 w-4 rounded border-auth-border"
							/>
							{t('setup.bioOption')}
						</label>
					) : undefined
				}
			/>

			{isSubmitting && (
				<p className="mt-4 text-xs text-[var(--color-text-secondary)]">{t('settings.pinSaving')}</p>
			)}
		</main>
	);
}

/**
 * 忘记 PIN 的逃生口（手动入口，不再自动出现）：清空本机保险库后重走强制设锁。
 *
 * 为什么不再做「冷启动自上而下」的重置闸门：那等于替用户丢掉全部验证码；
 * 旧长度库其实能直接解锁（见 PinInputScreen 的 pinLength 放开），只有真的忘记 PIN 才需要清空。
 * 危险动作要两步确认（第二次点击才执行），并在 5 秒无操作后复位，防误触。
 */
function VaultResetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
	const { t } = useTranslation();
	const [confirming, setConfirming] = useState(false);

	// 每次关闭都复位：下次打开从「首次点击」态开始，不继承上次点半截的状态
	useEffect(() => {
		if (!open) setConfirming(false);
	}, [open]);

	// 待确认态超时复位：危险按钮不会一直挂在「再点就执行」上
	useEffect(() => {
		if (!open || !confirming) return;
		const id = setTimeout(() => setConfirming(false), RESET_CONFIRM_TIMEOUT_MS);
		return () => clearTimeout(id);
	}, [confirming, open]);

	if (!open) return null;

	const handleReset = () => {
		if (!confirming) {
			setConfirming(true);
			return;
		}
		resetLocalVault();
		window.location.reload();
	};

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="vault-reset-title"
			className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 backdrop-blur-sm p-4"
		>
			<div className="w-full max-w-xs rounded-xl border border-auth-border bg-auth-surface p-5">
				<h3
					id="vault-reset-title"
					className="mb-1 flex items-center gap-2 text-base font-semibold text-[var(--color-text-primary)]"
				>
					<ShieldAlert
						className="h-4 w-4 shrink-0 text-[var(--color-danger-text)]"
						aria-hidden="true"
					/>
					{t('reset.title')}
				</h3>
				<p className="mb-4 text-xs text-[var(--color-text-secondary)]">{t('reset.desc')}</p>
				<div className="flex flex-col gap-2">
					<button
						type="button"
						onClick={onClose}
						className="w-full rounded-lg bg-auth-elevated py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-auth-border transition-colors"
					>
						{t('common.cancel')}
					</button>
					<button
						type="button"
						onClick={handleReset}
						className="w-full rounded-lg bg-danger-soft py-2 text-sm font-semibold text-[var(--color-danger-text)] hover:bg-danger/10 transition-colors"
					>
						{confirming ? t('reset.confirmAgain') : t('reset.action')}
					</button>
				</div>
			</div>
		</div>
	);
}

export default function UnlockGate({ children }: { children: React.ReactNode }) {
	const isLoading = useAuthenticatorStore((s) => s.isLoading);
	const isUnlocked = useAuthenticatorStore((s) => s.isUnlocked);
	const hasPin = useAuthenticatorStore((s) => s.hasPin);
	const loadAccounts = useAuthenticatorStore((s) => s.loadAccounts);
	const setHasPin = useAuthenticatorStore((s) => s.setHasPin);
	const setLoading = useAuthenticatorStore((s) => s.setLoading);
	const [bootError, setBootError] = useState<string | null>(null);
	const [needsSetup, setNeedsSetup] = useState(false);
	const { t } = useTranslation();

	useEffect(() => {
		let cancelled = false;

		async function boot() {
			try {
				const pinProtected = hasPinProtection();
				if (pinProtected) {
					// 存量库（4-8 位 PIN）同样能解锁：长度只在键盘层放开，闸门不再拦
					if (!cancelled) {
						setHasPin(true);
						setLoading(false);
					}
					return;
				}

				// 无 PIN 的存量库：先取出账户（拿到 deviceKey），再强制建立应用锁
				const accounts = await loadWithoutPin();
				if (!cancelled) {
					loadAccounts(accounts);
					setHasPin(false);
					setNeedsSetup(true);
					setLoading(false);
				}
			} catch (err) {
				if (!cancelled) {
					setBootError(err instanceof Error ? err.message : t('unlock.bootFailed'));
					setLoading(false);
				}
			}
		}

		boot();
		return () => {
			cancelled = true;
		};
	}, [loadAccounts, setHasPin, setLoading, t]);

	if (isLoading) {
		return (
			<main
				className="flex app-shell items-center justify-center bg-auth-bg"
				role="status"
				aria-label={t('unlock.loadingAria')}
			>
				<div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
			</main>
		);
	}

	if (bootError) {
		return (
			<main
				className="flex app-shell flex-col items-center justify-center bg-auth-bg px-6 text-center"
				role="alert"
			>
				<AlertCircle className="mb-4 h-10 w-10 text-[var(--color-danger-text)]" />
				<h2 className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">{t('unlock.bootFailed')}</h2>
				<p className="text-sm text-[var(--color-text-secondary)]">{bootError}</p>
			</main>
		);
	}

	if (needsSetup) {
		return <SetupLockScreen onDone={() => setNeedsSetup(false)} />;
	}

	if (!isUnlocked && hasPin) {
		return <PinInputScreen />;
	}

	return <>{children}</>;
}
