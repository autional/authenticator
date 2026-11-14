import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, ShieldCheck, AlertCircle, Fingerprint } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { showToast } from '@autional/ui';
import { useAuthenticatorStore } from '@/lib/store';
import {
	unlockWithPin,
	hasPinProtection,
	loadWithoutPin,
	unlockWithBiometric,
	hasBiometricProtection,
	setPinProtection,
	setBiometricProtection,
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
import { PIN_PATTERN } from '@/lib/crypto';
import { setCeremonyActive } from '@/lib/app-lock';

type UnlockMode = 'bio' | 'pin';

/** 掩码文本能力探测：Chrome/Safari 支持 -webkit-text-security，可避开密码管理器误判登录表单。 */
function supportsTextMask(): boolean {
	return typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
		? CSS.supports('-webkit-text-security', 'disc')
		: false;
}

function PinInputScreen() {
	const [pin, setPin] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [bioUsable, setBioUsable] = useState(false);
	const [mode, setMode] = useState<UnlockMode>('pin');
	const { t } = useTranslation();
	const loadAccounts = useAuthenticatorStore((s) => s.loadAccounts);
	const setHasPin = useAuthenticatorStore((s) => s.setHasPin);
	const pinRef = useRef<HTMLInputElement>(null);
	const autoTriedRef = useRef(false);
	const maskSupported = supportsTextMask();

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

	// 只有 PIN 视图需要聚焦输入框（生物识别视图不应抢焦点）
	useEffect(() => {
		if (mode === 'pin') pinRef.current?.focus();
	}, [mode]);

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

	const handleUnlock = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		// 存量库可能是 4 位 PIN，这里不能提高下限（读取兼容）
		if (!pin || pin.length < 4) {
			setError(t('unlock.pinTooShort'));
			return;
		}

		setIsSubmitting(true);
		try {
			const accounts = await unlockWithPin(pin);
			loadAccounts(accounts);
			setHasPin(true);
		} catch {
			setError(t('unlock.pinWrong'));
		} finally {
			setIsSubmitting(false);
		}
	};

	if (mode === 'bio') {
		return (
			<main className="flex h-screen flex-col items-center justify-center bg-auth-bg px-6">
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
		<main className="flex h-screen flex-col items-center justify-center bg-auth-bg px-6">
			<div className="mb-8 flex h-20 w-20 items-center justify-center rounded-lg bg-primary-500/10">
				<ShieldCheck className="h-10 w-10 text-primary-500" />
			</div>
			<h1 className="mb-2 text-xl font-bold text-[var(--color-text-primary)]">{t('app.title')}</h1>
			<p className="mb-8 text-sm text-[var(--color-text-secondary)]">
				{bioUsable ? t('unlock.bioOrPin') : t('unlock.enterPin')}
			</p>

			<form
				onSubmit={handleUnlock}
				className="w-full max-w-xs space-y-4"
				aria-label={t('unlock.pinUnlockAria')}
			>
				{/* AU-17：密码类输入需同表单 username 语义（Chromium 可访问性启发式） */}
				<input
					type="text"
					name="username"
					autoComplete="username"
					tabIndex={-1}
					aria-hidden="true"
					className="hidden"
					defaultValue=""
				/>
				{error && (
					<div className="flex items-center gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-sm text-[var(--color-danger-text)]">
						<AlertCircle className="h-4 w-4 shrink-0" />
						{error}
					</div>
				)}
				<div className="relative">
					<Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
					<input
						id="unlock-pin-input"
						ref={pinRef}
						name="pin"
						type={maskSupported ? 'text' : 'password'}
						style={
							maskSupported
								? ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)
								: undefined
						}
						inputMode="numeric"
						pattern="[0-9]*"
						maxLength={8}
						value={pin}
						onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
						placeholder={t('unlock.pinPlaceholder')}
						autoComplete="off"
						data-form-type="other"
						data-lpignore="true"
						data-1p-ignore="true"
						data-bwignore="true"
						aria-label={t('unlock.pinAria')}
						className="w-full rounded-xl border border-auth-border bg-auth-elevated py-3 pl-10 pr-4 text-center text-lg font-mono tracking-widest text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-colors focus:border-primary-500"
					/>
				</div>
				<button
					type="submit"
					disabled={isSubmitting}
					className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white hover:bg-primary-500 active:scale-[0.98] disabled:opacity-50 transition-all"
				>
					{isSubmitting ? t('unlock.unlocking') : t('unlock.unlock')}
				</button>

				{bioUsable && (
					<button
						type="button"
						onClick={() => void unlockWithPrf(true)}
						disabled={isSubmitting}
						className="flex w-full items-center justify-center gap-2 rounded-xl border border-auth-border bg-auth-surface py-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-auth-elevated transition-all disabled:opacity-50"
					>
						<Fingerprint className="h-4 w-4" />
						{t('unlock.useBiometric')}
					</button>
				)}
			</form>
		</main>
	);
}

/**
 * 强制设锁：无 PIN 的库（新装 / 老版本升级）冷启动时必须先设置 PIN 才能使用。
 * 没有跳过入口 —— PIN 是生物识别凭据丢失后唯一的恢复通道。
 */
function SetupLockScreen({ onDone }: { onDone: () => void }) {
	const { t } = useTranslation();
	const setHasPin = useAuthenticatorStore((s) => s.setHasPin);
	const [pin, setPin] = useState('');
	const [confirmPin, setConfirmPin] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [bioAvailable, setBioAvailable] = useState(false);
	const [enableBio, setEnableBio] = useState(false);
	const pinRef = useRef<HTMLInputElement>(null);
	const maskSupported = supportsTextMask();

	useEffect(() => {
		pinRef.current?.focus();
		let cancelled = false;
		isBiometricAvailable().then((avail) => {
			if (!cancelled) setBioAvailable(avail);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		if (!PIN_PATTERN.test(pin)) {
			setError(t('setup.weak'));
			return;
		}
		if (pin !== confirmPin) {
			setError(t('setup.mismatch'));
			return;
		}

		setIsSubmitting(true);
		try {
			await setPinProtection(pin);
			setHasPin(true);
		} catch {
			setError(t('setup.failed'));
			setIsSubmitting(false);
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

	const maskStyle = maskSupported
		? ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)
		: undefined;

	return (
		<main className="flex h-screen flex-col items-center justify-center bg-auth-bg px-6">
			<div className="mb-8 flex h-20 w-20 items-center justify-center rounded-lg bg-primary-500/10">
				<ShieldCheck className="h-10 w-10 text-primary-500" />
			</div>
			<h1 className="mb-2 text-center text-xl font-bold text-[var(--color-text-primary)]">
				{t('setup.title')}
			</h1>
			<p className="mb-8 text-center text-sm text-[var(--color-text-secondary)]">
				{t('setup.desc')}
			</p>

			<form
				onSubmit={handleSubmit}
				className="w-full max-w-xs space-y-4"
				aria-label={t('setup.title')}
			>
				{error && (
					<div className="flex items-center gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-sm text-[var(--color-danger-text)]">
						<AlertCircle className="h-4 w-4 shrink-0" />
						{error}
					</div>
				)}

				<div>
					<label
						htmlFor="setup-pin-input"
						className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]"
					>
						{t('setup.pinLabel')}
					</label>
					<input
						id="setup-pin-input"
						ref={pinRef}
						name="pin"
						type={maskSupported ? 'text' : 'password'}
						style={maskStyle}
						inputMode="numeric"
						pattern="[0-9]*"
						maxLength={8}
						value={pin}
						onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
						placeholder={t('setup.pinLabel')}
						autoComplete="off"
						data-form-type="other"
						data-lpignore="true"
						data-1p-ignore="true"
						data-bwignore="true"
						className="w-full rounded-xl border border-auth-border bg-auth-elevated px-4 py-3 text-center text-lg font-mono tracking-widest text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-colors focus:border-primary-500"
					/>
				</div>

				<div>
					<label
						htmlFor="setup-pin-confirm"
						className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]"
					>
						{t('setup.confirmLabel')}
					</label>
					<input
						id="setup-pin-confirm"
						name="pin_confirm"
						type={maskSupported ? 'text' : 'password'}
						style={maskStyle}
						inputMode="numeric"
						pattern="[0-9]*"
						maxLength={8}
						value={confirmPin}
						onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
						placeholder={t('setup.confirmLabel')}
						autoComplete="off"
						data-form-type="other"
						data-lpignore="true"
						data-1p-ignore="true"
						data-bwignore="true"
						className="w-full rounded-xl border border-auth-border bg-auth-elevated px-4 py-3 text-center text-lg font-mono tracking-widest text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-colors focus:border-primary-500"
					/>
				</div>

				{bioAvailable && (
					<label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
						<input
							type="checkbox"
							checked={enableBio}
							onChange={(e) => setEnableBio(e.target.checked)}
							className="h-4 w-4 rounded border-auth-border"
						/>
						{t('setup.bioOption')}
					</label>
				)}

				<button
					type="submit"
					disabled={isSubmitting}
					className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white hover:bg-primary-500 active:scale-[0.98] disabled:opacity-50 transition-all"
				>
					{isSubmitting ? t('settings.pinSaving') : t('setup.submit')}
				</button>
			</form>
		</main>
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
				className="flex h-screen items-center justify-center bg-auth-bg"
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
				className="flex h-screen flex-col items-center justify-center bg-auth-bg px-6 text-center"
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
