import { useTranslation } from 'react-i18next';
import { Bell, BellOff, AlertCircle } from 'lucide-react';

export default function SettingsPushMfa({
	pushEnabled,
	pushLoading,
	pushError,
	onToggle,
}: {
	pushEnabled: boolean;
	pushLoading: boolean;
	pushError: string | null;
	onToggle: () => void;
}) {
	const { t } = useTranslation();

	return (
		<div className="px-4 py-3">
			<div className="flex items-center gap-3 mb-2">
				{pushEnabled ? (
					<Bell className="h-4 w-4 text-primary-400" />
				) : (
					<BellOff className="h-4 w-4 text-[var(--color-text-secondary)]" />
				)}
				<span className="text-sm text-[var(--color-text-primary)]">{t('settings.pushApproval')}</span>
				{pushEnabled && (
					<span className="ml-auto rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-[var(--color-success-text)]">
						{t('settings.pushEnabled')}
					</span>
				)}
			</div>
			<p className="text-xs text-[var(--color-text-muted)] mb-2">
				{pushEnabled ? t('settings.pushDescEnabled') : t('settings.pushDescDisabled')}
			</p>
			{pushError && (
				<div className="mb-2 flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-xs text-[var(--color-danger-text)]">
					<AlertCircle className="h-3.5 w-3.5 shrink-0" />
					{pushError}
				</div>
			)}
			<button
				onClick={onToggle}
				disabled={pushLoading}
				className={`w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${pushEnabled ? 'border border-auth-border bg-auth-elevated text-[var(--color-text-primary)] hover:bg-danger/10 hover:text-[var(--color-danger-text)]' : 'bg-primary-600 text-white hover:bg-primary-500'}`}
			>
				{pushLoading
					? t('settings.pushProcessing')
					: pushEnabled
						? t('settings.pushDisable')
						: t('settings.pushEnable')}
			</button>
		</div>
	);
}
