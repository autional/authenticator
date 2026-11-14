import { useTranslation } from 'react-i18next';
import { Fingerprint } from 'lucide-react';

export default function SettingsBiometric({
	bioAvailable,
	bioRegistered,
	onToggle,
}: {
	bioAvailable: boolean;
	bioRegistered: boolean;
	onToggle: () => void;
}) {
	const { t } = useTranslation();

	if (!bioAvailable) return null;

	return (
		<div className="px-4 py-3">
			<div className="flex items-center gap-3 mb-2">
				<Fingerprint className="h-4 w-4 text-[var(--color-text-secondary)]" />
				<span className="text-sm text-[var(--color-text-primary)]">{t('settings.biometric')}</span>
				{bioRegistered && (
					<span className="ml-auto rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-[var(--color-success-text)]">
						{t('settings.biometricEnabled')}
					</span>
				)}
			</div>
			<p className="text-xs text-[var(--color-text-muted)] mb-2">
				{bioRegistered ? t('settings.biometricDescEnabled') : t('settings.biometricDescDisabled')}
			</p>
			<button
				onClick={onToggle}
				className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
					bioRegistered
						? 'border border-auth-border bg-auth-elevated text-[var(--color-text-secondary)] hover:text-[var(--color-danger-text)]'
						: 'bg-primary-600 text-white hover:bg-primary-500'
				}`}
			>
				{bioRegistered ? t('settings.biometricDisable') : t('settings.biometricEnable')}
			</button>
		</div>
	);
}
