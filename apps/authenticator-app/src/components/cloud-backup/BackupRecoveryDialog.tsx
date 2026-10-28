import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Download, AlertCircle } from 'lucide-react';

export default function BackupRecoveryDialog({
	open,
	code,
	busy,
	error,
	onConfirm,
	onCancel,
}: {
	open: boolean;
	code: string;
	busy?: boolean;
	error?: string | null;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation();
	const [copied, setCopied] = useState(false);
	const [acknowledged, setAcknowledged] = useState(false);

	if (!open) return null;

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2000);
		} catch {
			/* clipboard 不可用：用户可手抄 */
		}
	};

	const download = () => {
		const body = [
			t('cloudBackup.recoveryFileTitle'),
			'',
			code,
			'',
			t('cloudBackup.recoveryFileHint'),
		].join('\n');
		const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'autional-backup-recovery.txt';
		anchor.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 backdrop-blur-sm p-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="backup-recovery-title"
				className="w-full max-w-sm rounded-xl border border-auth-border bg-auth-surface p-5"
			>
				<h3 id="backup-recovery-title" className="mb-1 text-base font-semibold text-[var(--color-text-primary)]">
					{t('cloudBackup.recoveryTitle')}
				</h3>
				<p className="mb-3 text-xs text-[var(--color-text-secondary)]">{t('cloudBackup.recoveryDesc')}</p>

				<div className="mb-3 select-all break-all rounded-lg border border-auth-border bg-auth-elevated px-3 py-3 font-mono text-sm tracking-wider text-[var(--color-text-primary)]">
					{code}
				</div>

				<div className="mb-3 flex gap-2">
					<button
						type="button"
						onClick={copy}
						className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-auth-elevated py-2 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-auth-border"
					>
						{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
						{copied ? t('cloudBackup.recoveryCopied') : t('cloudBackup.recoveryCopy')}
					</button>
					<button
						type="button"
						onClick={download}
						className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-auth-elevated py-2 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-auth-border"
					>
						<Download className="h-3.5 w-3.5" />
						{t('cloudBackup.recoveryDownload')}
					</button>
				</div>

				<label className="mb-4 flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
					<input
						type="checkbox"
						checked={acknowledged}
						onChange={(e) => setAcknowledged(e.target.checked)}
						className="mt-0.5 h-4 w-4 shrink-0 rounded border-auth-border"
					/>
					<span>{t('cloudBackup.recoverySaved')}</span>
				</label>

				{error && (
					<p role="alert" className="mb-3 flex items-center gap-1.5 text-xs text-[var(--color-danger-text)]">
						<AlertCircle className="h-3.5 w-3.5 shrink-0" />
						{error}
					</p>
				)}

				<div className="flex gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="flex-1 rounded-lg bg-auth-elevated py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-auth-border"
					>
						{t('common.cancel')}
					</button>
					<button
						type="button"
						disabled={!acknowledged || busy}
						onClick={onConfirm}
						className="flex-1 rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-500 disabled:opacity-50"
					>
						{t('cloudBackup.createAction')}
					</button>
				</div>
			</div>
		</div>
	);
}
