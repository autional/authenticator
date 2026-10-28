import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';

type RestoreMethod = 'passphrase' | 'recovery';

export default function BackupRestoreDialog({
	open,
	busy,
	error,
	onSubmit,
	onCancel,
}: {
	open: boolean;
	busy?: boolean;
	error?: string | null;
	onSubmit: (secret: { passphrase?: string; recoveryCode?: string }) => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation();
	const [method, setMethod] = useState<RestoreMethod>('passphrase');
	const [value, setValue] = useState('');

	if (!open) return null;

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!value.trim()) return;
		onSubmit(method === 'passphrase' ? { passphrase: value } : { recoveryCode: value });
	};

	const close = () => {
		setValue('');
		setMethod('passphrase');
		onCancel();
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 backdrop-blur-sm p-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="backup-restore-title"
				className="w-full max-w-xs rounded-xl border border-auth-border bg-auth-surface p-5"
			>
				<h3 id="backup-restore-title" className="mb-1 text-base font-semibold text-[var(--color-text-primary)]">
					{t('cloudBackup.restoreTitle')}
				</h3>
				<p className="mb-4 text-xs text-[var(--color-text-secondary)]">{t('cloudBackup.restoreDesc')}</p>

				<div role="tablist" aria-label={t('cloudBackup.restoreTitle')} className="mb-3 flex rounded-lg bg-auth-elevated p-1">
					{(['passphrase', 'recovery'] as const).map((item) => (
						<button
							key={item}
							role="tab"
							type="button"
							aria-selected={method === item}
							onClick={() => {
								setMethod(item);
								setValue('');
							}}
							className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
								method === item
									? 'bg-auth-surface text-[var(--color-text-primary)] shadow-sm'
									: 'text-[var(--color-text-secondary)]'
							}`}
						>
							{item === 'passphrase'
								? t('cloudBackup.restorePassphrase')
								: t('cloudBackup.restoreRecovery')}
						</button>
					))}
				</div>

				<form onSubmit={handleSubmit}>
					<input
						type="text"
						name="username"
						autoComplete="username"
						tabIndex={-1}
						aria-hidden="true"
						className="hidden"
						defaultValue=""
					/>
					<label htmlFor="backup-restore-secret" className="sr-only">
						{method === 'passphrase'
							? t('cloudBackup.restorePassphrase')
							: t('cloudBackup.restoreRecovery')}
					</label>
					<input
						id="backup-restore-secret"
						name="backup_restore_secret"
						type={method === 'passphrase' ? 'password' : 'text'}
						autoComplete={method === 'passphrase' ? 'current-password' : 'off'}
						spellCheck={false}
						autoCapitalize="characters"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						placeholder={
							method === 'passphrase'
								? t('cloudBackup.passphrasePlaceholder')
								: t('cloudBackup.recoveryPlaceholder')
						}
						className="mb-2 w-full rounded-lg border border-auth-border bg-auth-elevated px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-primary-500"
					/>
					{error && (
						<p role="alert" className="mb-3 flex items-center gap-1.5 text-xs text-[var(--color-danger-text)]">
							<AlertCircle className="h-3.5 w-3.5 shrink-0" />
							{error}
						</p>
					)}
					<div className="mt-3 flex gap-2">
						<button
							type="button"
							onClick={close}
							className="flex-1 rounded-lg bg-auth-elevated py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-auth-border"
						>
							{t('common.cancel')}
						</button>
						<button
							type="submit"
							disabled={busy || !value.trim()}
							className="flex-1 rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-500 disabled:opacity-50"
						>
							{t('cloudBackup.restoreAction')}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
