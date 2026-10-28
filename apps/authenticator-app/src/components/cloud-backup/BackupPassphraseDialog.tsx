import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';

export type BackupPassphraseMode = 'create' | 'unlock';

export default function BackupPassphraseDialog({
	open,
	mode,
	busy,
	error,
	onSubmit,
	onCancel,
}: {
	open: boolean;
	mode: BackupPassphraseMode;
	busy?: boolean;
	error?: string | null;
	onSubmit: (passphrase: string) => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation();
	const [passphrase, setPassphrase] = useState('');
	const [confirm, setConfirm] = useState('');
	const [localError, setLocalError] = useState<string | null>(null);

	if (!open) return null;

	const isCreate = mode === 'create';

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		setLocalError(null);
		if (passphrase.length < 10) {
			setLocalError(t('cloudBackup.passphraseTooShort'));
			return;
		}
		if (isCreate && passphrase !== confirm) {
			setLocalError(t('cloudBackup.passphraseMismatch'));
			return;
		}
		onSubmit(passphrase);
	};

	const close = () => {
		setPassphrase('');
		setConfirm('');
		setLocalError(null);
		onCancel();
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 backdrop-blur-sm p-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="backup-passphrase-title"
				className="w-full max-w-xs rounded-xl border border-auth-border bg-auth-surface p-5"
			>
				<h3 id="backup-passphrase-title" className="mb-1 text-base font-semibold text-[var(--color-text-primary)]">
					{isCreate ? t('cloudBackup.passphraseTitle') : t('cloudBackup.unlockTitle')}
				</h3>
				<p className="mb-4 text-xs text-[var(--color-text-secondary)]">
					{isCreate ? t('cloudBackup.passphraseDesc') : t('cloudBackup.unlockDesc')}
				</p>
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
					<label htmlFor="backup-passphrase" className="sr-only">
						{t('cloudBackup.passphraseLabel')}
					</label>
					<input
						id="backup-passphrase"
						name="backup_passphrase"
						type="password"
						autoComplete={isCreate ? 'new-password' : 'current-password'}
						value={passphrase}
						onChange={(e) => setPassphrase(e.target.value)}
						placeholder={t('cloudBackup.passphrasePlaceholder')}
						className="mb-2 w-full rounded-lg border border-auth-border bg-auth-elevated px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-primary-500"
					/>
					{isCreate && (
						<>
							<label htmlFor="backup-passphrase-confirm" className="sr-only">
								{t('cloudBackup.passphraseConfirm')}
							</label>
							<input
								id="backup-passphrase-confirm"
								name="backup_passphrase_confirm"
								type="password"
								autoComplete="new-password"
								value={confirm}
								onChange={(e) => setConfirm(e.target.value)}
								placeholder={t('cloudBackup.passphraseConfirmPlaceholder')}
								className="mb-2 w-full rounded-lg border border-auth-border bg-auth-elevated px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-primary-500"
							/>
						</>
					)}
					{(localError || error) && (
						<p role="alert" className="mb-3 flex items-center gap-1.5 text-xs text-[var(--color-danger-text)]">
							<AlertCircle className="h-3.5 w-3.5 shrink-0" />
							{localError || error}
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
							disabled={busy}
							className="flex-1 rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-500 disabled:opacity-50"
						>
							{isCreate ? t('cloudBackup.passphraseContinue') : t('cloudBackup.unlockAction')}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
