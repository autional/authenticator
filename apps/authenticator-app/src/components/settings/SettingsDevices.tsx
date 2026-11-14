import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Smartphone } from 'lucide-react';
import { toSlugged, useTenantSlug } from '../../lib/slug';

export default function SettingsDevices() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const slug = useTenantSlug();

	return (
		<section>
			<h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
				{t('settings.devices')}
			</h2>
			<div className="rounded-xl border border-auth-border bg-auth-surface">
				<div className="flex items-center gap-3 px-4 py-3">
					<Smartphone className="h-4 w-4 text-[var(--color-text-secondary)]" />
					<div className="flex-1">
						<span className="text-sm text-[var(--color-text-primary)]">{t('settings.registeredDevices')}</span>
						<p className="text-xs text-[var(--color-text-secondary)]">{t('settings.devicesSubtitle')}</p>
					</div>
					<button
						onClick={() => navigate(toSlugged('/devices', slug))}
						className="rounded-lg bg-auth-elevated px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
					>
						{t('settings.devicesView')}
					</button>
				</div>
			</div>
		</section>
	);
}
