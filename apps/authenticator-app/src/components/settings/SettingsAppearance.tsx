import { useTranslation } from 'react-i18next';
import { Moon, Sun } from 'lucide-react';

export default function SettingsAppearance({
	theme,
	onToggle,
}: {
	theme: string;
	onToggle: () => void;
}) {
	const { t } = useTranslation();

	return (
		<section>
			<h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
				{t('settings.appearance')}
			</h2>
			<div className="rounded-xl border border-auth-border bg-auth-surface">
				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex items-center gap-3">
						{theme === 'dark' ? (
							<Moon className="h-4 w-4 text-[var(--color-text-secondary)]" />
						) : (
							<Sun className="h-4 w-4 text-[var(--color-text-secondary)]" />
						)}
						<span className="text-sm text-[var(--color-text-primary)]">{t('settings.darkMode')}</span>
					</div>
					<button
						type="button"
						role="switch"
						aria-checked={theme === 'dark'}
						onClick={onToggle}
						className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${theme === 'dark' ? 'bg-primary-600' : 'bg-auth-border'}`}
					>
						<span
							className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-soft ring-0 transition duration-200 ease-in-out ${theme === 'dark' ? 'translate-x-5' : 'translate-x-0'}`}
						/>
					</button>
				</div>
			</div>
		</section>
	);
}
