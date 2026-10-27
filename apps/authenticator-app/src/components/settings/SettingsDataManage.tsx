import { useTranslation } from 'react-i18next';
import { Download, Upload } from 'lucide-react';

export default function SettingsDataManage({
	accountsCount,
	onExport,
	onImportChange,
	importError,
	importSuccess,
}: {
	accountsCount: number;
	onExport: () => void;
	onImportChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
	importError: string | null;
	importSuccess: boolean;
}) {
	const { t } = useTranslation();

	return (
		<section>
			<h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
				{t('settings.data')}
			</h2>
			<div className="rounded-xl border border-auth-border bg-auth-surface divide-y divide-auth-border">
				<button
					onClick={onExport}
					className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-auth-elevated/50 transition-colors"
				>
					<div className="flex items-center gap-3">
						<Download className="h-4 w-4 text-[var(--color-text-secondary)]" />
						<span className="text-sm text-[var(--color-text-primary)]">{t('settings.exportBackup')}</span>
					</div>
					<span className="text-xs text-[var(--color-text-muted)]">
						{t('settings.accountsCountLabel', { n: accountsCount })}
					</span>
				</button>
				<label className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left hover:bg-auth-elevated/50 transition-colors">
					<div className="flex items-center gap-3">
						<Upload className="h-4 w-4 text-[var(--color-text-secondary)]" />
						<span className="text-sm text-[var(--color-text-primary)]">{t('settings.importBackup')}</span>
					</div>
					<input
						id="backup-import"
						name="backup-import"
						type="file"
						accept="application/json"
						onChange={onImportChange}
						className="hidden"
					/>
				</label>
			</div>
			{importError && <p className="mt-2 text-xs text-[var(--color-danger-text)]">{importError}</p>}
			{importSuccess && <p className="mt-2 text-xs text-[var(--color-success-text)]">{t('settings.importSuccess')}</p>}
		</section>
	);
}
