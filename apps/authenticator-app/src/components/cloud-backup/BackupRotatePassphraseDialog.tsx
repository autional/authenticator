import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';

export default function BackupRotatePassphraseDialog({
	open,
	busy,
	error,
	onSubmit,
	onCancel,
}: {
	open: boolean;
	busy?: boolean;
	error?: string | null;
	onSubmit: (current: string, next: string) => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation();
	const [current, setCurrent] = useState('');
	const [next, setNext] = useState('');
	const [confirm, setConfirm] = useState('');
	const [localError, setLocalError] = useState<string | null>(null);

	if (!open) return null;

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		setLocalError(null);
		if (next.length < 10) {
			setLocalError(t('cloudBackup.passphraseTooShort'));
			return;
		}
		if (next !== confirm) {
			setLocalError(t('cloudBackup.passphraseMismatch'));
			return;
		}
		onSubmit(current, next);
	};

	const close = () => {
		setCurrent('');
		setNext('');
		setConfirm('');
		setLocalError(null);
		onCancel();
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 backdrop-blur-sm p-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="backup-rotate-title"
				className="w-full max-w-xs rounded-xl border border-auth-border bg-auth-surface p-5"
			>
				<h3 id="backup-rotate-title" className="mb-1 text-base font-semibold text-[var(--color-text-primary)]">
					{t('cloudBackup.rotatePassphrase')}
				</h3>
				<p className="mb-4 text-xs text-[var(--color-text-secondary)]">
					{t('cloudBackup.rotatePassphraseDesc')}
				</p>
				<form onSubmit={submit}>
					<input
						type="text"
						name="username"
						autoComplete="username"
						tabIndex={-1}
						aria-hidden="true"
						className="hidden"
						defaultValue=""
					/>
					<input
						id="backup-current-passphrase"
						name="current_passphrase"
						type="password"
						autoComplete="current-password"
						value={current}
						onChange={(e) => setCurrent(e.target.value)}
						placeholder={t('cloudBackup.currentPassphrase')}
						className="mb-2 w-full rounded-lg border border-auth-border bg-auth-elevated px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-primary-500"
					/>
					<input
						id="backup-next-passphrase"
						name="next_passphrase"
						type="password"
						autoComplete="new-password"
						value={next}
						onChange={(e) => setNext(e.target.value)}
						placeholder={t('cloudBackup.newPassphrase')}
						className="mb-2 w-full rounded-lg border border-auth-border bg-auth-elevated px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-primary-500"
					/>
					<input
						id="backup-next-passphrase-confirm"
						name="next_passphrase_confirm"
						type="password"
						autoComplete="new-password"
						value={confirm}
						onChange={(e) => setConfirm(e.target.value)}
						placeholder={t('cloudBackup.newPassphraseConfirm')}
						className="mb-2 w-full rounded-lg border border-auth-border bg-auth-elevated px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-primary-500"
					/>
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
							{t('cloudBackup.rotateAction')}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
