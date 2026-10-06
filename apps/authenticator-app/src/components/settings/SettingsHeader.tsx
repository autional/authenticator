import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { LanguageSwitcher } from '@autional/ui';

export default function SettingsHeader({ onBack }: { onBack: () => void }) {
	const { t } = useTranslation();

	return (
		<header className="sticky top-0 z-10 flex items-center gap-3 border-b border-auth-border bg-auth-bg/80 h-[var(--layout-header-height)] px-4 backdrop-blur-md">
			<button
				onClick={onBack}
				className="rounded-lg p-1.5 text-[var(--color-text-secondary)] hover:bg-auth-elevated hover:text-[var(--color-text-primary)] transition-colors"
				aria-label={t('account.goBack')}
			>
				<ArrowLeft className="h-5 w-5" />
			</button>
			<h1 className="text-lg font-bold text-[var(--color-text-primary)]">{t('settings.title')}</h1>
			<LanguageSwitcher className="ml-auto" />
		</header>
	);
}
