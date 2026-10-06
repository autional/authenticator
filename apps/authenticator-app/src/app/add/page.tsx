import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
	ArrowLeft,
	Keyboard,
	QrCode,
	Check,
	AlertCircle,
	Link2,
	Shield,
	Copy,
	Download,
} from 'lucide-react';
import { useAuth, extractApiErrorMessage } from '@autional/shared';
import QrScanner from '@/components/QrScanner';
import { useAuthenticatorStore } from '@/lib/store';
import { validateSecret, generateTOTP } from '@/lib/totp';
import BottomNav from '@/components/BottomNav';
import { showToast } from '@autional/ui';
import { enableTotp, verifyTotpSetup } from '@/lib/api';
import type { MigratedAccount } from '@/lib/otpauth-migration';
import { toSlugged, useTenantSlug } from '../../lib/slug';

type Tab = 'manual' | 'qr' | 'bind';

export default function AddAccountPage() {
	const navigate = useNavigate();
	const slug = useTenantSlug();
	const { t } = useTranslation();
	const addAccount = useAuthenticatorStore((s) => s.addAccount);
	const accounts = useAuthenticatorStore((s) => s.accounts);
	const { user } = useAuth();

	const [tab, setTab] = useState<Tab>('manual');
	const [migratedAccounts, setMigratedAccounts] = useState<MigratedAccount[] | null>(null);

	// Manual form state
	const [name, setName] = useState('');
	const [username, setUsername] = useState('');
	const [secret, setSecret] = useState('');
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	// Bind from Autional state
	const [bindStep, setBindStep] = useState<'init' | 'qr' | 'verify'>('init');
	const [bindLoading, setBindLoading] = useState(false);
	const [bindError, setBindError] = useState<string | null>(null);
	const [bindSecret, setBindSecret] = useState('');
	const [bindQrCode, setBindQrCode] = useState('');
	const [bindBackupCodes, setBindBackupCodes] = useState<string[]>([]);
	const [verifyCode, setVerifyCode] = useState('');
	const [bindName, setBindName] = useState('Autional');
	const [bindUsername, setBindUsername] = useState(user?.email || user?.username || '');

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		if (!name.trim() || !username.trim() || !secret.trim()) {
			setError(t('add.allRequired'));
			return;
		}

		const normalizedSecret = secret.trim().replace(/\s/g, '').toUpperCase();
		const exists = accounts.some(
			(a) => a.secret === normalizedSecret && a.username === username.trim(),
		);
		if (exists) {
			setError(t('add.accountExists'));
			return;
		}

		setIsSubmitting(true);
		const isValid = await validateSecret(secret.trim());
		if (!isValid) {
			setError(t('add.invalidSecret'));
			setIsSubmitting(false);
			return;
		}

		addAccount({
			name: name.trim(),
			username: username.trim(),
			secret: normalizedSecret,
			type: 'totp',
			algorithm: 'SHA1',
			digits: 6,
			period: 30,
		});

		setSuccess(true);
		setTimeout(() => navigate(toSlugged('/', slug)), 1200);
	};

	const handleBindStart = async () => {
		setBindLoading(true);
		setBindError(null);
		try {
			// enableTotp() 经 @autional/shared interceptor 解包，返回即 data 对象（{secret, qrCode, backupCodes}）
			const data = await enableTotp();
			if (!data?.secret) {
				setBindError(t('add.bindNoSecret'));
				setBindLoading(false);
				return;
			}
			setBindSecret(data.secret);
			setBindQrCode(data.qrCode || '');
			setBindBackupCodes(data.backupCodes || []);
			setBindStep('qr');
		} catch (err: unknown) {
			setBindError(extractApiErrorMessage(err, t('add.bindFetchFailed')));
		} finally {
			setBindLoading(false);
		}
	};

	const handleBindVerify = async () => {
		if (!verifyCode.trim() || verifyCode.length !== 6) {
			setBindError(t('add.bindVerifyWrong'));
			return;
		}
		setBindLoading(true);
		setBindError(null);
		try {
			const userId = user?.id;
			if (!userId) {
				// Fallback: try to verify locally
				const result = await generateTOTP(bindSecret, 30, 6, 'SHA1');
				if (result.code !== verifyCode.trim()) {
					setBindError(t('add.bindVerifyWrong'));
					setBindLoading(false);
					return;
				}
			} else {
				await verifyTotpSetup(verifyCode.trim(), userId);
			}

			// Add account
			const exists = accounts.some(
				(a) => a.secret === bindSecret && a.username === bindUsername.trim(),
			);
			if (exists) {
				setBindError(t('add.bindDuplicate'));
				setBindLoading(false);
				return;
			}

			addAccount({
				name: bindName.trim() || 'Autional',
				username: bindUsername.trim() || 'default',
				secret: bindSecret,
				type: 'totp',
				algorithm: 'SHA1',
				digits: 6,
				period: 30,
			});

			setBindStep('verify');
			showToast(t('add.bindSuccess'), 'success');
			setTimeout(() => navigate(toSlugged('/', slug)), 1500);
		} catch (err: unknown) {
			setBindError(extractApiErrorMessage(err, t('add.bindVerifyFailed')));
		} finally {
			setBindLoading(false);
		}
	};

	const handleCopySecret = async () => {
		await navigator.clipboard.writeText(bindSecret);
		showToast(t('copied'), 'success');
	};

	return (
		<div className="flex h-full flex-col">
			<header className="sticky top-0 z-10 flex items-center gap-3 border-b border-auth-border bg-auth-bg/80 h-[var(--layout-header-height)] px-4 backdrop-blur-md">
				<button
					onClick={() => navigate(toSlugged('/', slug))}
					className="rounded-lg p-1.5 text-[var(--color-text-secondary)] hover:bg-auth-elevated hover:text-[var(--color-text-primary)] transition-colors"
					aria-label={t('account.goBack')}
				>
					<ArrowLeft className="h-5 w-5" />
				</button>
				<h1 className="text-lg font-bold text-[var(--color-text-primary)]">{t('add.title')}</h1>
			</header>

			{/* Tabs */}
			<div className="mx-4 mt-4 flex rounded-xl bg-auth-surface p-1 border border-auth-border">
				{[
					{ key: 'manual' as Tab, label: t('add.manualTab'), icon: Keyboard },
					{ key: 'qr' as Tab, label: t('add.qrTab'), icon: QrCode },
					{ key: 'bind' as Tab, label: t('add.bindTab'), icon: Link2 },
				].map((tabItem) => (
					<button
						key={tabItem.key}
						onClick={() => setTab(tabItem.key)}
						className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium transition-all ${
							tab === tabItem.key
								? 'bg-primary-600 text-white shadow-sm'
								: 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
						}`}
					>
						<tabItem.icon className="h-3.5 w-3.5" />
						{tabItem.label}
					</button>
				))}
			</div>

			{/* Content */}
			<div className="flex-1 px-4 py-4">
				{tab === 'manual' && (
					<form onSubmit={handleSubmit} className="space-y-4">
						{error && (
							<div className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-[var(--color-danger-text)]">
								<AlertCircle className="h-4 w-4 shrink-0" />
								{error}
							</div>
						)}
						{success && (
							<div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm text-[var(--color-success-text)]">
								<Check className="h-4 w-4 shrink-0" />
								{t('add.accountAdded')}
							</div>
						)}
						<div>
							<label
								htmlFor="add-service-name"
								className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]"
							>
								{t('add.serviceName')} <span className="text-[var(--color-danger-text)]">*</span>
							</label>
							<input
								id="add-service-name"
								name="service_name"
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder={t('add.serviceName')}
								className="w-full rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30"
							/>
						</div>
						<div>
							<label
								htmlFor="add-username"
								className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]"
							>
								{t('add.username')} <span className="text-[var(--color-danger-text)]">*</span>
							</label>
							<input
								id="add-username"
								name="username"
								type="text"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								placeholder={t('add.username')}
								className="w-full rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30"
							/>
						</div>
						<div>
							<label
								htmlFor="add-secret"
								className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]"
							>
								{t('add.secret')} <span className="text-[var(--color-danger-text)]">*</span>
							</label>
							<textarea
								id="add-secret"
								name="secret"
								value={secret}
								onChange={(e) => setSecret(e.target.value)}
								placeholder="JBSWY3DPEHPK3PXP"
								rows={3}
								className="w-full resize-none rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2.5 text-sm font-mono text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30"
							/>
							<p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{t('add.secretHint')}</p>
						</div>
						<button
							type="submit"
							disabled={isSubmitting || success}
							className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white hover:bg-primary-500 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 transition-all"
						>
							{isSubmitting ? t('add.validating') : t('add.submit')}
						</button>
					</form>
				)}

				{tab === 'qr' && !migratedAccounts && (
					<QrScanner
						onScan={(result) => {
							const exists = accounts.some(
								(a) => a.secret === result.secret && a.username === result.username,
							);
							if (exists) {
								showToast(t('add.qrDuplicate'), 'error');
								return;
							}
							addAccount({
								name: result.name,
								username: result.username,
								secret: result.secret,
								type: 'totp',
								algorithm: result.algorithm,
								digits: result.digits,
								period: result.period,
							});
							showToast(t('add.qrSuccess'), 'success');
							setTimeout(() => navigate(toSlugged('/', slug)), 1200);
						}}
						onMigration={(accounts) => {
							setMigratedAccounts(accounts);
							showToast(t('add.migrationTitle', { n: accounts.length }), 'success');
						}}
						onError={(err) => showToast(err, 'error')}
						onManualFallback={() => setTab('manual')}
					/>
				)}

				{tab === 'qr' && migratedAccounts && (
					<div className="space-y-4">
						<div className="rounded-xl border border-auth-border bg-auth-surface p-4">
							<div className="flex items-center gap-2 mb-3">
								<Download className="h-4 w-4 text-primary-400" />
								<h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
									{t('add.migrationTitle', { n: migratedAccounts.length })}
								</h2>
							</div>
							<div className="space-y-2 max-h-[320px] overflow-y-auto">
								{migratedAccounts.map((acc, i) => (
									<div
										key={i}
										className="flex items-center gap-2 rounded-lg bg-auth-elevated px-3 py-2"
									>
										<div className="h-8 w-8 shrink-0 rounded-lg bg-primary-500/10 flex items-center justify-center">
											<span className="text-xs font-bold text-primary-400">
												{acc.name[0] || '?'}
											</span>
										</div>
										<div className="min-w-0 flex-1">
											<p className="text-xs font-medium text-[var(--color-text-primary)] truncate">{acc.name}</p>
											<p className="text-[10px] text-[var(--color-text-muted)]">
												{acc.algorithm} · {acc.digits}
											</p>
										</div>
									</div>
								))}
							</div>
						</div>
						<div className="flex gap-2">
							<button
								onClick={() => setMigratedAccounts(null)}
								className="flex-1 rounded-xl bg-auth-elevated py-3 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-auth-border transition-colors"
							>
								{t('add.migrationCancel')}
							</button>
							<button
								onClick={() => {
									let imported = 0;
									for (const acc of migratedAccounts) {
										const exists = accounts.some(
											(a) => a.secret === acc.secret && a.username === acc.name,
										);
										if (!exists) {
											addAccount({
												name: acc.name,
												username: acc.issuer || acc.name,
												secret: acc.secret,
												type: acc.type || 'totp',
												algorithm: acc.algorithm,
												digits: acc.digits,
												period: acc.period,
												counter: acc.counter,
											});
											imported++;
										}
									}
									showToast(t('add.migrationSuccess', { n: imported }), 'success');
									setTimeout(() => navigate(toSlugged('/', slug)), 1200);
								}}
								className="flex-1 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white hover:bg-primary-500 active:scale-[0.98] transition-all"
							>
								{t('add.migrationConfirm')}
							</button>
						</div>
					</div>
				)}

				{tab === 'bind' && (
					<div>
						{bindStep === 'init' && (
							<form
								onSubmit={(e) => {
									e.preventDefault();
									handleBindStart();
								}}
								className="space-y-4"
							>
								<div className="flex flex-col items-center rounded-xl border border-auth-border bg-auth-surface p-6 text-center">
									<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-500/10 mb-3">
										<Shield className="h-7 w-7 text-primary-500" />
									</div>
									<h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('add.bindTitle')}</h2>
									<p className="mt-1 text-xs text-[var(--color-text-secondary)] max-w-[240px]">{t('add.bindDesc')}</p>
								</div>

								<div>
									<label
										htmlFor="bind-name"
										className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]"
									>
										{t('add.serviceName')}
									</label>
									<input
										id="bind-name"
										name="bind_service_name"
										type="text"
										value={bindName}
										onChange={(e) => setBindName(e.target.value)}
										placeholder="Autional"
										className="w-full rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:border-primary-500"
									/>
								</div>
								<div>
									<label
										htmlFor="bind-username"
										className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]"
									>
										{t('add.username')}
									</label>
									<input
										id="bind-username"
										name="bind_username"
										type="text"
										value={bindUsername}
										onChange={(e) => setBindUsername(e.target.value)}
										placeholder={user?.email || user?.username || 'your@email.com'}
										className="w-full rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:border-primary-500"
									/>
								</div>

								{bindError && (
									<div className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-[var(--color-danger-text)]">
										<AlertCircle className="h-4 w-4 shrink-0" />
										{bindError}
									</div>
								)}

								<button
									type="submit"
									disabled={bindLoading}
									className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white hover:bg-primary-500 active:scale-[0.98] disabled:opacity-50 transition-all"
								>
									{bindLoading ? t('add.bindFetching') : t('add.bindGetSecret')}
								</button>
							</form>
						)}

						{bindStep === 'qr' && (
							<form
								onSubmit={(e) => {
									e.preventDefault();
									handleBindVerify();
								}}
								className="space-y-4"
							>
								<div className="flex flex-col items-center rounded-xl border border-auth-border bg-auth-surface p-6 text-center">
									{bindQrCode ? (
										<img src={bindQrCode} alt="TOTP QR Code" className="h-48 w-48 rounded-lg" />
									) : (
										<div className="flex h-48 w-48 items-center justify-center rounded-lg bg-auth-elevated">
											<QrCode className="h-16 w-16 text-[var(--color-text-muted)]" />
										</div>
									)}
									<p className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">{t('add.bindScanQR')}</p>
									<p className="text-xs text-[var(--color-text-secondary)]">{t('add.bindScanQRHint')}</p>
								</div>

								<div className="rounded-xl border border-auth-border bg-auth-surface p-4">
									<div className="flex items-center justify-between">
										<span className="text-xs text-[var(--color-text-secondary)]">{t('add.secret')}</span>
										<button
											onClick={handleCopySecret}
											className="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300"
										>
											<Copy className="h-3 w-3" />
											{t('copy')}
										</button>
									</div>
									<code className="mt-1 block break-all text-sm font-mono text-[var(--color-text-secondary)]">
										{bindSecret}
									</code>
								</div>

								{bindBackupCodes.length > 0 && (
									<div className="rounded-xl border border-warning/20 bg-warning/5 p-4">
										<p className="text-xs font-medium text-[var(--color-warning-text)]">
											{t('add.bindBackupCodesWarning')}
										</p>
										<div className="mt-2 grid grid-cols-2 gap-1.5">
											{bindBackupCodes.map((code, i) => (
												<code key={i} className="text-center text-xs font-mono text-[var(--color-text-secondary)]">
													{code}
												</code>
											))}
										</div>
									</div>
								)}

								<div>
									<label
										htmlFor="bind-verify-code"
										className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]"
									>
										{t('add.bindCodeLabel')}
									</label>
									<input
										id="bind-verify-code"
										name="bind_verify_code"
										type="text"
										inputMode="numeric"
										pattern="[0-9]*"
										maxLength={6}
										value={verifyCode}
										onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
										placeholder="123456"
										className="w-full rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2.5 text-center text-lg font-mono tracking-[0.3em] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:border-primary-500"
									/>
								</div>

								{bindError && (
									<div className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-[var(--color-danger-text)]">
										<AlertCircle className="h-4 w-4 shrink-0" />
										{bindError}
									</div>
								)}

								<button
									type="submit"
									disabled={bindLoading || verifyCode.length !== 6}
									className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white hover:bg-primary-500 active:scale-[0.98] disabled:opacity-50 transition-all"
								>
									{bindLoading ? t('add.bindVerifying') : t('add.bindVerify')}
								</button>
							</form>
						)}
					</div>
				)}
			</div>

			<BottomNav />
		</div>
	);
}
