import { ShieldPlus, QrCode } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { buildLoginUrl, useAuth } from '@autional/shared';
import { toSlugged, useTenantSlug } from '../lib/slug';

export default function EmptyState() {
	const navigate = useNavigate();
	const slug = useTenantSlug();
	const { t } = useTranslation();
	const { isAuthenticated } = useAuth();

	return (
		<div className="flex flex-col items-center justify-center px-6 py-16 text-center">
			<div className="mb-4 flex h-16 w-16 items-center justify-center rounded-md bg-primary-500/10">
				<ShieldPlus className="h-8 w-8 text-primary-500" />
			</div>
			<h2 className="mb-1 text-lg font-semibold text-[var(--color-text-primary)]">{t('home.noAccounts')}</h2>
			<p className="mb-6 text-sm text-[var(--color-text-secondary)]">{t('home.emptyDesc')}</p>
			<div className="flex w-full max-w-[240px] flex-col gap-2">
				<button
					onClick={() => navigate(toSlugged('/add', slug))}
					className="rounded-xl bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-500 active:scale-95 transition-all"
				>
					{t('home.addAccount')}
				</button>
				<button
					onClick={() => navigate(toSlugged('/add?tab=qr', slug))}
					className="flex items-center justify-center gap-2 rounded-xl border border-auth-border bg-auth-elevated px-6 py-2.5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-auth-border transition-all"
				>
					<QrCode className="h-4 w-4" />
					{t('home.scan')}
				</button>
			</div>
			{!isAuthenticated && (
				<button
					type="button"
					onClick={() => {
						window.location.href = buildLoginUrl(window.location.origin + '/');
					}}
					className="mt-3 text-xs text-primary-400 hover:text-primary-300"
				>
					{t('home.signIn')}
				</button>
			)}
		</div>
	);
}
