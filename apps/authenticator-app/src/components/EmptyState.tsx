import { ShieldPlus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { toSlugged, useTenantSlug } from '../lib/slug';

export default function EmptyState() {
	const navigate = useNavigate();
	const slug = useTenantSlug();
	const { t } = useTranslation();

	return (
		<div className="flex flex-col items-center justify-center px-6 py-16 text-center">
			<div className="mb-4 flex h-16 w-16 items-center justify-center rounded-md bg-primary-500/10">
				<ShieldPlus className="h-8 w-8 text-primary-500" />
			</div>
			<h2 className="mb-1 text-lg font-semibold text-[var(--color-text-primary)]">{t('home.noAccounts')}</h2>
			<p className="mb-6 text-sm text-[var(--color-text-secondary)]">{t('home.emptyDesc')}</p>
			<button
				onClick={() => navigate(toSlugged('/add', slug))}
				className="rounded-xl bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-500 active:scale-95 transition-all"
			>
				{t('home.addAccount')}
			</button>
		</div>
	);
}
