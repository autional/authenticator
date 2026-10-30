import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
	ArrowLeft,
	Cloud,
	Upload,
	Download,
	RefreshCw,
	Trash2,
	Clock,
	Hash,
	Shield,
	AlertCircle,
	Check,
} from 'lucide-react';
import { useAuthenticatorStore } from '@/lib/store';
import {
	useCloudBackup,
	useUploadCloudBackup,
	useDownloadCloudBackup,
	useDeleteCloudBackup,
} from '@/hooks/use-cloud-backup';
import type { BackupEnvelopeV2 } from '@/lib/backup-envelope';
import { showToast } from '@autional/ui';
import BottomNav from '@/components/BottomNav';
import BackupPassphraseDialog, {
	type BackupPassphraseMode,
} from '@/components/cloud-backup/BackupPassphraseDialog';
import BackupRecoveryDialog from '@/components/cloud-backup/BackupRecoveryDialog';
import BackupRotatePassphraseDialog from '@/components/cloud-backup/BackupRotatePassphraseDialog';
import BackupRestoreDialog from '@/components/cloud-backup/BackupRestoreDialog';
import { toSlugged, useTenantSlug } from '../../lib/slug';

export default function CloudBackupPage() {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const slug = useTenantSlug();
	const { accounts } = useAuthenticatorStore();
	const { backup, format, needsRestore, loading, error, refetch } = useCloudBackup();
	const {
		uploading,
		prepareNew,
		uploadPrepared,
		uploadExisting,
		rotatePassphrase,
		prepareRecoveryRotation,
	} = useUploadCloudBackup();
	const { downloading, downloadLegacy, downloadV2 } = useDownloadCloudBackup();
	const { deleting, deleteAllBackups } = useDeleteCloudBackup();
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [importSuccess, setImportSuccess] = useState(false);

	const [passphraseOpen, setPassphraseOpen] = useState(false);
	const [passphraseMode, setPassphraseMode] = useState<BackupPassphraseMode>('create');
	const [recoveryOpen, setRecoveryOpen] = useState(false);
	const [restoreOpen, setRestoreOpen] = useState(false);
	const [pendingEnvelope, setPendingEnvelope] = useState<BackupEnvelopeV2 | null>(null);
	const [pendingDek, setPendingDek] = useState<CryptoKey | null>(null);
	const [recoveryCode, setRecoveryCode] = useState('');
	const [pendingExpectedHash, setPendingExpectedHash] = useState<string | null>(null);
	const [pendingAccountCount, setPendingAccountCount] = useState(0);
	const [passphraseIntent, setPassphraseIntent] = useState<'upload' | 'rotate-recovery'>('upload');
	const [rotateOpen, setRotateOpen] = useState(false);
	const [dialogError, setDialogError] = useState<string | null>(null);

	const resetPending = () => {
		setPendingEnvelope(null);
		setPendingDek(null);
		setRecoveryCode('');
		setPendingExpectedHash(null);
		setPendingAccountCount(0);
	};

	const startUpload = () => {
		if (accounts.length === 0) {
			showToast(t('home.noAccounts'), 'error');
			return;
		}
		setDialogError(null);
		setPassphraseIntent('upload');
		if (!backup || format === 'v1') {
			setPassphraseMode('create');
		} else {
			setPassphraseMode('unlock');
		}
		setPassphraseOpen(true);
	};

	const startRotateRecovery = () => {
		if (format !== 'v2') return;
		setDialogError(null);
		setPassphraseIntent('rotate-recovery');
		setPassphraseMode('unlock');
		setPassphraseOpen(true);
	};

	const handlePassphrase = async (passphrase: string) => {
		setDialogError(null);
		try {
			if (passphraseIntent === 'rotate-recovery') {
				const prepared = await prepareRecoveryRotation(passphrase);
				setPendingEnvelope(prepared.envelope);
				setPendingDek(prepared.dek);
				setRecoveryCode(prepared.recoveryCode);
				setPendingExpectedHash(prepared.expectedLatestHash);
				setPendingAccountCount(prepared.accountCount);
				setPassphraseOpen(false);
				setRecoveryOpen(true);
				return;
			}
			if (passphraseMode === 'create') {
				const created = await prepareNew(accounts, passphrase);
				setPendingEnvelope(created.envelope);
				setPendingDek(created.dek);
				setRecoveryCode(created.recoveryCode);
				setPassphraseOpen(false);
				setRecoveryOpen(true);
				return;
			}
			await uploadExisting(accounts, passphrase);
			setPassphraseOpen(false);
			showToast(t('cloudBackup.uploaded'), 'success');
			refetch();
		} catch (err) {
			setDialogError(errorMessage(err, t('cloudBackup.uploadFailed')));
		}
	};

	const handleRecoveryConfirm = async () => {
		if (!pendingEnvelope || !pendingDek) return;
		setDialogError(null);
		try {
			await uploadPrepared(
				pendingEnvelope,
				pendingDek,
				pendingAccountCount || accounts.length,
				pendingExpectedHash ?? undefined,
			);
			setRecoveryOpen(false);
			resetPending();
			showToast(t('cloudBackup.uploaded'), 'success');
			refetch();
		} catch (err) {
			setDialogError(errorMessage(err, t('cloudBackup.uploadFailed')));
		}
	};

	const handleRotatePassphrase = async (current: string, next: string) => {
		setDialogError(null);
		try {
			await rotatePassphrase(current, next);
			setRotateOpen(false);
			showToast(t('cloudBackup.rotateSuccess'), 'success');
			refetch();
		} catch (err) {
			setDialogError(errorMessage(err, t('cloudBackup.uploadFailed')));
		}
	};

	const handleDelete = async () => {
		if (!backup) return;
		try {
			await deleteAllBackups();
			setDeleteOpen(false);
			showToast(t('cloudBackup.deleteSuccess'), 'success');
			refetch();
		} catch {
			// error 由 hook 暴露；页面通过 toast 提示
			showToast(t('cloudBackup.deleteFailed'), 'error');
		}
	};

	const importRestored = (restored: Awaited<ReturnType<typeof downloadV2>>) => {
		if (!restored) return false;
		if (restored.length === 0) {
			showToast(t('home.noAccounts'), 'info');
			return false;
		}
		const { importAccounts } = useAuthenticatorStore.getState();
		importAccounts(restored);
		setImportSuccess(true);
		showToast(t('cloudBackup.restored'), 'success');
		setTimeout(() => setImportSuccess(false), 3000);
		return true;
	};

	const startDownload = async () => {
		setDialogError(null);
		if (format === 'v2') {
			setRestoreOpen(true);
			return;
		}
		// v1：仅创建它的设备可解
		showToast(t('cloudBackup.legacyHint'), 'info');
		const restored = await downloadLegacy();
		if (!importRestored(restored)) {
			showToast(t('cloudBackup.legacyFailed'), 'error');
		}
	};

	const handleRestore = async (secret: { passphrase?: string; recoveryCode?: string }) => {
		setDialogError(null);
		try {
			const restored = await downloadV2(secret);
			if (!restored) {
				setDialogError(t('cloudBackup.noBackupData'));
				return;
			}
			if (importRestored(restored)) {
				setRestoreOpen(false);
			}
		} catch (err) {
			setDialogError(errorMessage(err, t('cloudBackup.downloadFailed')));
		}
	};

	const formatDate = (iso?: string) => {
		if (!iso) return t('cloudBackup.unknown');
		try {
			return new Date(iso).toLocaleString(i18n.language);
		} catch {
			return iso;
		}
	};

	const formatLabel =
		format === 'v2'
			? t('cloudBackup.formatV2')
			: format === 'v1'
				? t('cloudBackup.formatV1')
				: t('cloudBackup.unknown');

	const displayError = error || dialogError;

	return (
		<div className="flex min-h-full flex-col">
			<header className="sticky top-0 z-10 flex items-center gap-3 border-b border-auth-border bg-auth-bg/80 h-[var(--layout-header-height)] px-4 backdrop-blur-md">
				<button
					onClick={() => navigate(toSlugged('/settings', slug))}
					className="rounded-lg p-1.5 text-[var(--color-text-secondary)] hover:bg-auth-elevated hover:text-[var(--color-text-primary)] transition-colors"
					aria-label={t('common.back')}
				>
					<ArrowLeft className="h-5 w-5" />
				</button>
				<h1 className="text-lg font-bold text-[var(--color-text-primary)]">{t('cloudBackup.title')}</h1>
			</header>

			<div className="flex-1 space-y-4 px-4 py-4">
				{displayError && (
					<div className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-[var(--color-danger-text)]">
						<AlertCircle className="h-4 w-4 shrink-0" />
						{displayError}
					</div>
				)}

				{importSuccess && (
					<div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm text-[var(--color-success-text)]">
						<Check className="h-4 w-4 shrink-0" />
						{t('cloudBackup.restored')}
					</div>
				)}

				<section>
					<h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
						{t('cloudBackup.status')}
					</h2>
					<div className="rounded-xl border border-auth-border bg-auth-surface">
						{loading ? (
							<div className="flex items-center justify-center py-10">
								<div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
							</div>
						) : backup ? (
							<div className="divide-y divide-auth-border">
								<div className="flex items-center gap-3 px-4 py-3">
									<Clock className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
									<span className="text-sm text-[var(--color-text-secondary)]">{t('cloudBackup.lastBackup')}</span>
									<span className="ml-auto text-sm text-[var(--color-text-primary)]">
										{formatDate(backup.createdAt)}
									</span>
								</div>
								<div className="flex items-center gap-3 px-4 py-3">
									<Hash className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
									<span className="text-sm text-[var(--color-text-secondary)]">{t('cloudBackup.accountCount')}</span>
									<span className="ml-auto text-sm text-[var(--color-text-primary)]">{backup.accountCount}</span>
								</div>
								<div className="flex items-center gap-3 px-4 py-3">
									<Shield className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
									<span className="text-sm text-[var(--color-text-secondary)]">{t('cloudBackup.format')}</span>
									<span
										className={`ml-auto text-sm ${
											format === 'v2'
												? 'text-[var(--color-success-text)]'
												: 'text-[var(--color-warning-text)]'
										}`}
									>
										{formatLabel}
									</span>
								</div>
								<div className="flex items-center gap-3 px-4 py-3">
									<Cloud className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
									<span className="text-sm text-[var(--color-text-secondary)]">{t('cloudBackup.device')}</span>
									<span className="ml-auto text-sm text-[var(--color-text-primary)]">
										{backup.deviceName || t('cloudBackup.unknown')}
									</span>
								</div>
								{format === 'v1' && (
									<p className="px-4 py-3 text-xs text-[var(--color-warning-text)]">
										{t('cloudBackup.legacyHint')}
									</p>
								)}
							</div>
						) : (
							<div className="flex flex-col items-center justify-center py-10 text-center px-4">
								<Cloud className="h-10 w-10 text-[var(--color-text-muted)] mb-3" />
								<p className="text-sm text-[var(--color-text-secondary)]">{t('cloudBackup.noBackup')}</p>
								<p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('cloudBackup.noBackupHint')}</p>
							</div>
						)}
					</div>
				</section>

				<section>
					<h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
						{t('cloudBackup.actions')}
					</h2>
					<div className="rounded-xl border border-auth-border bg-auth-surface divide-y divide-auth-border">
						<button
							onClick={startUpload}
							disabled={uploading || accounts.length === 0}
							className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-auth-elevated/50 transition-colors disabled:opacity-50"
						>
							<div className="flex items-center gap-3">
								<Upload className="h-4 w-4 text-primary-400" />
								<div>
									<span className="text-sm text-[var(--color-text-primary)]">{t('cloudBackup.upload')}</span>
									<p className="text-[11px] text-[var(--color-text-muted)]">
										{accounts.length > 0
											? t('settings.accountsCountLabel', { n: accounts.length })
											: t('home.noAccounts')}
									</p>
									{needsRestore && (
										<p className="text-[11px] text-[var(--color-warning-text)]">
											{t('cloudBackup.needsRestoreHint')}
										</p>
									)}
								</div>
							</div>
							{uploading ? (
								<div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
							) : null}
						</button>

						<button
							onClick={startDownload}
							disabled={downloading || !backup}
							className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-auth-elevated/50 transition-colors disabled:opacity-50"
						>
							<div className="flex items-center gap-3">
								<Download className="h-4 w-4 text-primary-400" />
								<div>
									<span className="text-sm text-[var(--color-text-primary)]">{t('cloudBackup.download')}</span>
									<p className="text-[11px] text-[var(--color-text-muted)]">
										{format === 'v2' ? t('cloudBackup.downloadHintV2') : t('cloudBackup.downloadHintV1')}
									</p>
								</div>
							</div>
							{downloading ? (
								<div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
							) : (
								<Download className="h-4 w-4 text-[var(--color-text-muted)]" />
							)}
						</button>

						<button
							onClick={() => refetch()}
							className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-auth-elevated/50 transition-colors"
						>
							<RefreshCw className="h-4 w-4 text-[var(--color-text-secondary)]" />
							<span className="text-sm text-[var(--color-text-secondary)]">{t('cloudBackup.refresh')}</span>
						</button>

						{backup && (
							<>
								<button
									type="button"
									onClick={() => setDeleteOpen(true)}
									disabled={deleting}
									className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-danger/10 transition-colors disabled:opacity-50"
								>
									<Trash2 className="h-4 w-4 text-[var(--color-danger-text)]" />
									<span className="text-sm text-[var(--color-danger-text)]">{t('cloudBackup.delete')}</span>
								</button>
								{deleteOpen && (
									<div className="px-4 py-3">
										<p className="text-xs text-[var(--color-text-muted)]">{t('cloudBackup.deleteDesc')}</p>
										<div className="mt-3 flex gap-2">
											<button
												type="button"
												onClick={handleDelete}
												disabled={deleting}
												className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
											>
												{deleting ? '…' : t('cloudBackup.deleteConfirm')}
											</button>
											<button
												type="button"
												onClick={() => setDeleteOpen(false)}
												disabled={deleting}
												className="rounded-lg border border-auth-border px-3 py-1.5 text-xs text-[var(--color-text-secondary)]"
											>
												{t('cloudBackup.deleteCancel')}
											</button>
										</div>
									</div>
								)}
							</>
						)}
					</div>
				</section>

				{format === 'v2' && (
					<section>
						<h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
							{t('cloudBackup.securityTitle')}
						</h2>
						<div className="rounded-xl border border-auth-border bg-auth-surface divide-y divide-auth-border">
							<button
								type="button"
								onClick={() => {
									setDialogError(null);
									setRotateOpen(true);
								}}
								className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-auth-elevated/50 transition-colors"
							>
								<Shield className="h-4 w-4 text-primary-400" />
								<div>
									<span className="text-sm text-[var(--color-text-primary)]">
										{t('cloudBackup.rotatePassphrase')}
									</span>
									<p className="text-[11px] text-[var(--color-text-muted)]">
										{t('cloudBackup.rotatePassphraseDesc')}
									</p>
								</div>
							</button>
							<button
								type="button"
								onClick={startRotateRecovery}
								className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-auth-elevated/50 transition-colors"
							>
								<Shield className="h-4 w-4 text-primary-400" />
								<div>
									<span className="text-sm text-[var(--color-text-primary)]">
										{t('cloudBackup.rotateRecovery')}
									</span>
									<p className="text-[11px] text-[var(--color-text-muted)]">
										{t('cloudBackup.rotateRecoveryDesc')}
									</p>
								</div>
							</button>
						</div>
					</section>
				)}

				<div className="rounded-lg bg-auth-elevated p-3">
					<div className="flex items-start gap-2">
						<Shield className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
						<div className="text-xs text-[var(--color-text-muted)] space-y-1">
							<p>{t('cloudBackup.encryptionNote1')}</p>
							<p>{t('cloudBackup.encryptionNote2')}</p>
						</div>
					</div>
				</div>
			</div>

			{passphraseOpen && (
				<BackupPassphraseDialog
					open
					mode={passphraseMode}
					busy={uploading}
					error={dialogError}
					onSubmit={handlePassphrase}
					onCancel={() => {
						setPassphraseOpen(false);
						setDialogError(null);
						resetPending();
					}}
				/>
			)}

			{recoveryOpen && (
				<BackupRecoveryDialog
					open
					code={recoveryCode}
					busy={uploading}
					error={dialogError}
					confirmLabel={pendingExpectedHash ? t('cloudBackup.recoveryConfirmLabel') : undefined}
					onConfirm={handleRecoveryConfirm}
					onCancel={() => {
						setRecoveryOpen(false);
						setDialogError(null);
						resetPending();
					}}
				/>
			)}

			{rotateOpen && (
				<BackupRotatePassphraseDialog
					open
					busy={uploading}
					error={dialogError}
					onSubmit={handleRotatePassphrase}
					onCancel={() => {
						setRotateOpen(false);
						setDialogError(null);
					}}
				/>
			)}

			{restoreOpen && (
				<BackupRestoreDialog
					open
					busy={downloading}
					error={dialogError}
					onSubmit={handleRestore}
					onCancel={() => {
						setRestoreOpen(false);
						setDialogError(null);
					}}
				/>
			)}

			<BottomNav />
		</div>
	);
}

function errorMessage(err: unknown, fallback: string): string {
	if (err instanceof Error && err.message) return err.message;
	return fallback;
}
