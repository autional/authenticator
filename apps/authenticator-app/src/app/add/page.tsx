import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
	ArrowLeft,
	Keyboard,
	QrCode,
	Check,
	AlertCircle,
	Shield,
	Download,
} from 'lucide-react';
import { useAuth } from '@autional/shared';
import QrScanner, { type LoginScanResult } from '@/components/QrScanner';
import { useAuthenticatorStore } from '@/lib/store';
import { validateSecret } from '@/lib/totp';
import BottomNav from '@/components/BottomNav';
import { showToast } from '@autional/ui';
import type { MigratedAccount } from '@/lib/otpauth-migration';
import { useSignIn } from '@/lib/use-sign-in';
import {
	clearPendingApproval,
	savePendingApproval,
	takePendingApproval,
} from '@/lib/pending-approval';
import { toSlugged, useTenantSlug } from '../../lib/slug';

type Tab = 'manual' | 'qr';

export default function AddAccountPage() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const slug = useTenantSlug();
	const { t } = useTranslation();
	const addAccount = useAuthenticatorStore((s) => s.addAccount);
	const accounts = useAuthenticatorStore((s) => s.accounts);
	const { isAuthenticated } = useAuth();
	const { signIn, dialog } = useSignIn();

	const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'qr' ? 'qr' : 'manual');
	const [migratedAccounts, setMigratedAccounts] = useState<MigratedAccount[] | null>(null);
	/** 未登录时扫到的登录码：不丢弃，登录后自动续上审批。 */
	const [pendingLogin, setPendingLogin] = useState<LoginScanResult | null>(null);

	/** 进入扫码登录审批页（保留当前租户段）。 */
	const goApprove = (challenge: LoginScanResult) => {
		const nm = challenge.numberMatching
			? `&nm=${encodeURIComponent(challenge.numberMatching)}`
			: '';
		navigate(
			toSlugged(`/login-approve?token=${encodeURIComponent(challenge.token)}${nm}`, slug),
		);
	};

	/**
	 * 登录回跳后（整页 OAuth，React 状态已丢）用 sessionStorage 票据续上审批；
	 * 也覆盖「卡片打开时登录态在原地变为 true」的情况。
	 */
	useEffect(() => {
		if (!isAuthenticated) return;
		const taken = pendingLogin
			? { status: 'ready' as const, challenge: pendingLogin }
			: takePendingApproval();
		if (!taken) return;
		if (taken.status === 'expired') {
			// 登录耗时超过票据 TTL：明确告知而不是静默落到添加页
			showToast(t('add.approvalExpired'), 'error');
			return;
		}
		setPendingLogin(null);
		goApprove(taken.challenge);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isAuthenticated, pendingLogin]);

	// Manual form state
	const [name, setName] = useState('');
	const [username, setUsername] = useState('');
	const [secret, setSecret] = useState('');
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

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

	return (
		<div className="flex min-h-full flex-col">
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
				]
					.map((tabItem) => (
					<button
						key={tabItem.key}
						onClick={() => setTab(tabItem.key)}
						className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium transition-all ${
							tab === tabItem.key
								? 'bg-primary-600 text-white shadow-card'
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
								className="w-full rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-colors focus:border-primary-500"
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
								className="w-full rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-colors focus:border-primary-500"
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
								className="w-full resize-none rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2.5 text-sm font-mono text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-colors focus:border-primary-500"
							/>
							<p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('add.secretHint')}</p>
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

				{tab === 'qr' && !migratedAccounts && !pendingLogin && (
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
						onScanLogin={(challenge) => {
							// 未登录不能只弹 toast：扫描器在这一帧后自停，会留下「黑屏死路」。
							// 改为切到可操作卡片（登录后自动续上审批 / 重新扫码）。
							if (!isAuthenticated) {
								setPendingLogin(challenge);
								return;
							}
							// QR 登录审批（桌面端扫码登录）：扫到 autional://login?... 后进审批页；
							// 租户隔离由服务端 Confirm 的「JWT 租户 == 会话租户」硬校验保证，此处只做导航。
							goApprove(challenge);
						}}
						onError={(err) => showToast(err, 'error')}
						onManualFallback={() => setTab('manual')}
					/>
				)}

				{tab === 'qr' && pendingLogin && !isAuthenticated && (
					<div className="flex flex-col items-center rounded-xl border border-auth-border bg-auth-surface p-6 text-center">
						<div className="mb-3 flex h-14 w-14 items-center justify-center rounded-md bg-primary-500/10">
							<Shield className="h-7 w-7 text-primary-500" />
						</div>
						<h2 className="text-base font-semibold text-[var(--color-text-primary)]">
							{t('add.loginRequiredForApprove')}
						</h2>
						<p className="mt-1 text-xs text-[var(--color-text-secondary)]">
							{t('add.loginApproveDesc')}
						</p>
						<button
							type="button"
							onClick={() => {
								savePendingApproval(pendingLogin);
								signIn();
							}}
							className="mt-4 w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white transition-all hover:bg-primary-500 active:scale-[0.98]"
						>
							{t('add.signInToApprove')}
						</button>
						<button
							type="button"
							onClick={() => {
								clearPendingApproval();
								setPendingLogin(null);
							}}
							className="mt-2 w-full rounded-xl bg-auth-elevated py-3 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-auth-border"
						>
							{t('add.rescan')}
						</button>
						{dialog}
					</div>
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
											<p className="text-[11px] text-[var(--color-text-muted)]">
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

			</div>

			<BottomNav />
		</div>
	);
}
