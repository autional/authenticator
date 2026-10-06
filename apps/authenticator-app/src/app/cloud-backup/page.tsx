import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
	ArrowLeft,
	Cloud,
	Upload,
	Download,
	RefreshCw,
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
} from '@/hooks/use-cloud-backup';
import { showToast } from '@autional/ui';
import BottomNav from '@/components/BottomNav';
import { toSlugged, useTenantSlug } from '../../lib/slug';

export default function CloudBackupPage() {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const slug = useTenantSlug();
	const { accounts } = useAuthenticatorStore();
	const { backup, loading, error, refetch } = useCloudBackup();
	const { upload, uploading, error: uploadError } = useUploadCloudBackup();
	const { download, downloading, error: downloadError } = useDownloadCloudBackup();
	const [importError, setImportError] = useState<string | null>(null);
	const [importSuccess, setImportSuccess] = useState(false);

	const handleUpload = async () => {
		if (accounts.length === 0) {
			showToast(t('home.noAccounts'), 'error');
			return;
		}
		try {
			await upload(accounts);
			showToast(t('cloudBackup.upload'), 'success');
			refetch();
		} catch {
			showToast(uploadError || t('settings.pushFailed'), 'error');
		}
	};

	const handleDownload = async () => {
		setImportError(null);
		setImportSuccess(false);
		try {
			const accounts = await download();
			if (!accounts) {
				showToast(downloadError || t('settings.pushFailed'), 'error');
				return;
			}
			if (accounts.length === 0) {
				showToast(t('home.noAccounts'), 'info');
				return;
			}
			const { importAccounts } = useAuthenticatorStore.getState();
			importAccounts(accounts);
			setImportSuccess(true);
			showToast(t('cloudBackup.restored'), 'success');
			setTimeout(() => setImportSuccess(false), 3000);
		} catch {
			showToast(downloadError || t('settings.pushFailed'), 'error');
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

	const displayError = error || uploadError || downloadError || importError;

	return (
		<div className="flex h-full flex-col">
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
									<span className="text-sm text-[var(--color-text-secondary)]">{t('cloudBackup.version')}</span>
									<span className="ml-auto text-sm text-[var(--color-text-primary)]">v{backup.version}</span>
								</div>
								<div className="flex items-center gap-3 px-4 py-3">
									<Cloud className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
									<span className="text-sm text-[var(--color-text-secondary)]">{t('cloudBackup.device')}</span>
									<span className="ml-auto text-sm text-[var(--color-text-primary)]">
										{backup.deviceName || t('cloudBackup.unknown')}
									</span>
								</div>
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
							onClick={handleUpload}
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
								</div>
							</div>
							{uploading ? (
								<div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
							) : null}
						</button>

						<button
							onClick={handleDownload}
							disabled={downloading || !backup}
							className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-auth-elevated/50 transition-colors disabled:opacity-50"
						>
							<div className="flex items-center gap-3">
								<Download className="h-4 w-4 text-primary-400" />
								<div>
									<span className="text-sm text-[var(--color-text-primary)]">{t('cloudBackup.download')}</span>
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
					</div>
				</section>

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

			<BottomNav />
		</div>
	);
}
