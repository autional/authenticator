import { useState, useEffect } from 'react';
import { Lock, ShieldCheck, AlertCircle, Fingerprint } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthenticatorStore } from '@/lib/store';
import {
	unlockWithPin,
	hasPinProtection,
	loadWithoutPin,
	unlockWithBiometric,
} from '@/lib/storage';
import {
	hasBiometricRegistered,
	isBiometricAvailable,
	verifyBiometric,
	hasPRFEnabled,
	isPRFSupported,
} from '@/lib/webauthn';

function PinInputScreen() {
	const [pin, setPin] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [bioAvailable, setBioAvailable] = useState(false);
	const { t } = useTranslation();
	const loadAccounts = useAuthenticatorStore((s) => s.loadAccounts);
	const setHasPin = useAuthenticatorStore((s) => s.setHasPin);

	useEffect(() => {
		isBiometricAvailable().then(setBioAvailable);
	}, []);

	const handleUnlock = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

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

	return (
		<main className="flex h-screen flex-col items-center justify-center bg-auth-bg px-6">
			<div className="mb-8 flex h-20 w-20 items-center justify-center rounded-lg bg-primary-500/10">
				<ShieldCheck className="h-10 w-10 text-primary-500" />
			</div>
			<h1 className="mb-2 text-xl font-bold text-[var(--color-text-primary)]">{t('app.title')}</h1>
			<p className="mb-8 text-sm text-[var(--color-text-secondary)]">
				{bioAvailable && hasBiometricRegistered() ? t('unlock.bioOrPin') : t('unlock.enterPin')}
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
						name="pin"
						type="password"
						inputMode="numeric"
						pattern="[0-9]*"
						maxLength={8}
						value={pin}
						onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
						placeholder={t('unlock.pinPlaceholder')}
						autoFocus
						autoComplete="current-password"
						aria-label={t('unlock.pinAria')}
						className="w-full rounded-xl border border-auth-border bg-auth-elevated py-3 pl-10 pr-4 text-center text-lg font-mono tracking-widest text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30"
					/>
				</div>
				<button
					type="submit"
					disabled={isSubmitting}
					className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white hover:bg-primary-500 active:scale-[0.98] disabled:opacity-50 transition-all"
				>
					{isSubmitting ? t('unlock.unlocking') : t('unlock.unlock')}
				</button>

				{bioAvailable && hasBiometricRegistered() && isPRFSupported() && hasPRFEnabled() && (
					<button
						type="button"
						onClick={async () => {
							setIsSubmitting(true);
							setError(null);
							try {
								const prfKey = await verifyBiometric();
								if (prfKey && prfKey.length > 0) {
									const accounts = await unlockWithBiometric(prfKey);
									loadAccounts(accounts);
									setHasPin(true);
								} else {
									setError(t('unlock.bioFailed'));
								}
							} catch {
								setError(t('unlock.bioFailed'));
							} finally {
								setIsSubmitting(false);
							}
						}}
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

export default function UnlockGate({ children }: { children: React.ReactNode }) {
	const isLoading = useAuthenticatorStore((s) => s.isLoading);
	const isUnlocked = useAuthenticatorStore((s) => s.isUnlocked);
	const hasPin = useAuthenticatorStore((s) => s.hasPin);
	const loadAccounts = useAuthenticatorStore((s) => s.loadAccounts);
	const setHasPin = useAuthenticatorStore((s) => s.setHasPin);
	const setLoading = useAuthenticatorStore((s) => s.setLoading);
	const [bootError, setBootError] = useState<string | null>(null);
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

				const accounts = await loadWithoutPin();
				if (!cancelled) {
					loadAccounts(accounts);
					setHasPin(false);
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

	if (!isUnlocked && hasPin) {
		return <PinInputScreen />;
	}

	return <>{children}</>;
}
