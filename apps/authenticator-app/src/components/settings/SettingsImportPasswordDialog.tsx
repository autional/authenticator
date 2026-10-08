import { useTranslation } from 'react-i18next';

export default function SettingsImportPasswordDialog({
	open,
	value,
	onChange,
	onDecrypt,
	onCancel,
}: {
	open: boolean;
	value: string;
	onChange: (v: string) => void;
	onDecrypt: () => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation();

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 backdrop-blur-sm p-4">
			<div className="w-full max-w-xs rounded-xl border border-auth-border bg-auth-surface p-5">
				<h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
					{t('settings.importPasswordTitle')}
				</h3>
				<p className="text-xs text-[var(--color-text-secondary)] mb-4">{t('settings.importPasswordDesc')}</p>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (!value.trim()) return;
						onDecrypt();
					}}
				>
					{/* AU-17：密码类输入需同表单 username 语义（Chromium 可访问性启发式） */}
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
						id="import-password"
						name="import_password"
						type="password"
						autoComplete="new-password"
						value={value}
						onChange={(e) => onChange(e.target.value)}
						placeholder={t('settings.importPasswordPlaceholder')}
						className="w-full rounded-lg border border-auth-border bg-auth-elevated px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-primary-500 mb-3"
					/>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={onCancel}
							className="flex-1 rounded-lg bg-auth-elevated py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-auth-border transition-colors"
						>
							{t('common.cancel')}
						</button>
						<button
							type="submit"
							disabled={!value.trim()}
							className="flex-1 rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white hover:bg-primary-500 disabled:opacity-50 transition-colors"
						>
							{t('settings.importDecrypt')}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
