import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
	ArrowLeft,
	Smartphone,
	RefreshCw,
	Shield,
	AlertCircle,
	Check,
	Wifi,
	Clock,
	Trash2,
} from 'lucide-react';
import { extractApiError } from '@autional/shared';
import { useAuthenticatorStore } from '@/lib/store';
import { useDeviceSyncList, useSyncDevice, useDeleteSyncDevice } from '@/hooks/use-cloud-backup';
import { showToast } from '@autional/ui';
import BottomNav from '@/components/BottomNav';
import { toSlugged, useTenantSlug } from '../../lib/slug';

export default function DeviceSyncPage() {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const slug = useTenantSlug();
	const { accounts } = useAuthenticatorStore();
	const { devices, loading, error, refetch } = useDeviceSyncList();
	const { sync, syncing, error: syncError } = useSyncDevice();
	const { remove, error: removeError } = useDeleteSyncDevice();
	const [syncSuccess, setSyncSuccess] = useState(false);

	const handleSync = async () => {
		if (accounts.length === 0) {
			showToast(t('home.noAccounts'), 'error');
			return;
		}
		setSyncSuccess(false);
		try {
			const deviceName = getDeviceName(t('deviceSync.unknownDevice'));
			await sync(deviceName, accounts);
			setSyncSuccess(true);
			showToast(t('deviceSync.success'), 'success');
			refetch();
			setTimeout(() => setSyncSuccess(false), 3000);
		} catch (err: unknown) {
			// AU-21：直读本次错误（修 stale-read —— 首败时旧闭包 syncError 恒 null）
			const { code, message } = extractApiError(err, t('deviceSync.syncFailed'));
			showToast(String(code) === '61040100' ? t('deviceSync.limitReachedHint') : message, 'error');
		}
	};

	const handleRemove = async (id?: string) => {
		if (!id) return;
		if (!confirm(t('deviceSync.removeConfirm'))) return;
		try {
			await remove(id);
			showToast(t('deviceSync.removed'), 'success');
			refetch();
		} catch {
			showToast(removeError || t('deviceSync.removeFailed'), 'error');
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

	const truncateFingerprint = (fp?: string) => {
		if (!fp) return '—';
		if (fp.length <= 12) return fp;
		return `${fp.slice(0, 6)}...${fp.slice(-6)}`;
	};

	const displayError = error || syncError;

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
				<h1 className="text-lg font-bold text-[var(--color-text-primary)]">{t('deviceSync.title')}</h1>
			</header>

			<div className="flex-1 space-y-4 px-4 py-4">
				{displayError && (
					<div className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-[var(--color-danger-text)]">
						<AlertCircle className="h-4 w-4 shrink-0" />
						{displayError}
					</div>
				)}

				{syncSuccess && (
					<div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm text-[var(--color-success-text)]">
						<Check className="h-4 w-4 shrink-0" />
						{t('deviceSync.success')}
					</div>
				)}

				<section>
					<h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
						{t('deviceSync.list')}
					</h2>
					<p className="mb-2 text-[11px] text-[var(--color-text-muted)]">{t('deviceSync.capNote')}</p>
					<div className="rounded-xl border border-auth-border bg-auth-surface">
						{loading ? (
							<div className="flex items-center justify-center py-12">
								<div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
							</div>
						) : devices.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-12 text-center px-4">
								<Smartphone className="h-10 w-10 text-[var(--color-text-muted)] mb-3" />
								<p className="text-sm text-[var(--color-text-secondary)]">{t('deviceSync.noDevices')}</p>
								<p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('deviceSync.noDevicesHint')}</p>
							</div>
						) : (
							<div className="divide-y divide-auth-border">
								{devices.map((device, i) => (
									<div key={device.id || i} className="flex items-center gap-3 px-4 py-3">
										<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500/10">
											<Smartphone className="h-5 w-5 text-primary-400" />
										</div>
										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
												{device.deviceName || t('deviceSync.unnamedDevice')}
											</p>
											<div className="flex items-center gap-2 mt-0.5">
												<span
													className="text-[10px] font-mono text-[var(--color-text-muted)]"
													title={device.deviceFingerprint}
												>
													{truncateFingerprint(device.deviceFingerprint)}
												</span>
											</div>
											<div className="flex items-center gap-1 mt-0.5">
												<Clock className="h-3 w-3 text-[var(--color-text-muted)]" />
												<span className="text-[10px] text-[var(--color-text-muted)]">
													{formatDate(device.lastSyncAt)}
												</span>
												{device.accountCount != null && (
													<span className="text-[10px] text-[var(--color-text-muted)]">
														· {t('settings.accountsCountLabel', { n: device.accountCount })}
													</span>
												)}
											</div>
										</div>
										{device.id && (
											<button
												type="button"
												onClick={() => handleRemove(device.id)}
												aria-label={t('deviceSync.remove')}
												className="rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-danger-text)]"
											>
												<Trash2 className="h-4 w-4" />
											</button>
										)}
										<div
											className="flex h-2 w-2 shrink-0 rounded-full bg-success"
											title={t('deviceSync.synced')}
										/>
									</div>
								))}
							</div>
						)}
					</div>
				</section>

				<section>
					<h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
						{t('deviceSync.actions')}
					</h2>
					<div className="rounded-xl border border-auth-border bg-auth-surface divide-y divide-auth-border">
						<button
							onClick={handleSync}
							disabled={syncing || accounts.length === 0}
							className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-auth-elevated/50 transition-colors disabled:opacity-50"
						>
							<div className="flex items-center gap-3">
								<Wifi className="h-4 w-4 text-primary-400" />
								<div>
									<span className="text-sm text-[var(--color-text-primary)]">{t('deviceSync.syncThis')}</span>
									<p className="text-[11px] text-[var(--color-text-muted)]">
										{accounts.length > 0
											? t('settings.accountsCountLabel', { n: accounts.length })
											: t('home.noAccounts')}
									</p>
								</div>
							</div>
							{syncing ? (
								<div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
							) : null}
						</button>

						<button
							onClick={() => refetch()}
							className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-auth-elevated/50 transition-colors"
						>
							<RefreshCw className="h-4 w-4 text-[var(--color-text-secondary)]" />
							<span className="text-sm text-[var(--color-text-secondary)]">{t('deviceSync.refreshList')}</span>
						</button>
					</div>
				</section>

				<div className="rounded-lg bg-auth-elevated p-3">
					<div className="flex items-start gap-2">
						<Shield className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
						<div className="text-xs text-[var(--color-text-muted)] space-y-1">
							<p>{t('deviceSync.encryptionNote1')}</p>
							<p>{t('deviceSync.encryptionNote2')}</p>
						</div>
					</div>
				</div>
			</div>

			<BottomNav />
		</div>
	);
}

function getDeviceName(unknownLabel = 'Unknown device'): string {
	const ua = navigator.userAgent;
	if (ua.includes('iPhone')) return 'iPhone';
	if (ua.includes('iPad')) return 'iPad';
	if (ua.includes('Android')) return 'Android';
	if (ua.includes('Windows')) return 'Windows PC';
	if (ua.includes('Mac')) return 'Mac';
	if (ua.includes('Linux')) return 'Linux';
	return unknownLabel;
}
