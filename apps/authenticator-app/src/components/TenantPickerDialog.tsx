import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPortalUrl } from '@autional/shared';

/**
 * 租户选择弹窗：app 无 URL 租户段时，先选组织再发起 OAuth。
 * 只让用户输入组织代码（slug），不拉全量公开租户列表（避免泄露/长列表）；
 * 「查看全部组织」跳品牌站。
 */
export default function TenantPickerDialog({
	open,
	recent,
	onPick,
	onCancel,
}: {
	open: boolean;
	recent?: string;
	onPick: (slug: string) => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation();
	const [slug, setSlug] = useState(recent || '');
	if (!open) return null;

	const normalized = slug.trim().toLowerCase();
	const brandUrl = getPortalUrl('brand');

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		if (normalized) onPick(normalized);
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 p-4 backdrop-blur-sm">
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="tenant-picker-title"
				className="w-full max-w-xs rounded-xl border border-auth-border bg-auth-surface p-5"
			>
				<h3 id="tenant-picker-title" className="mb-1 text-base font-semibold text-[var(--color-text-primary)]">
					{t('signIn.title')}
				</h3>
				<p className="mb-4 text-xs text-[var(--color-text-secondary)]">{t('signIn.desc')}</p>
				<form onSubmit={submit}>
					<label htmlFor="tenant-slug" className="mb-1 block text-xs text-[var(--color-text-secondary)]">
						{t('signIn.label')}
					</label>
					<input
						id="tenant-slug"
						value={slug}
						onChange={(e) => setSlug(e.target.value)}
						placeholder={t('signIn.placeholder')}
						autoComplete="organization"
						autoFocus
						className="w-full rounded-lg border border-auth-border bg-auth-elevated px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-primary-500"
					/>
					<div className="mt-2 flex flex-wrap gap-2">
						{recent && (
							<button
								type="button"
								onClick={() => setSlug(recent)}
								className="rounded-full border border-auth-border px-2.5 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-auth-border"
							>
								{t('signIn.recent', { slug: recent })}
							</button>
						)}
						<button
							type="button"
							onClick={() => setSlug('platform')}
							className="rounded-full border border-auth-border px-2.5 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-auth-border"
						>
							{t('signIn.platform')}
						</button>
					</div>
					<div className="mt-4 flex gap-2">
						<button
							type="button"
							onClick={onCancel}
							className="flex-1 rounded-xl border border-auth-border px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-auth-border"
						>
							{t('common.cancel')}
						</button>
						<button
							type="submit"
							disabled={!normalized}
							className="flex-1 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-primary-500 disabled:opacity-50"
						>
							{t('signIn.continue')}
						</button>
					</div>
				</form>
				{brandUrl && (
					<a href={brandUrl} className="mt-3 block text-center text-xs text-primary-400 hover:text-primary-300">
						{t('signIn.allOrgs')}
					</a>
				)}
			</div>
		</div>
	);
}
