import { useTranslation } from 'react-i18next';
import { Lock, Check, AlertCircle } from 'lucide-react';
import { getPinLength } from '@/lib/storage';
import { PIN_LENGTH } from '@/lib/crypto';

export default function SettingsPinProtection({
	hasPin,
	pinInput,
	onPinChange,
	pinSaving,
	pinMessage,
	onSave,
}: {
	hasPin: boolean;
	pinInput: string;
	onPinChange: (v: string) => void;
	pinSaving: boolean;
	pinMessage: { type: 'success' | 'error'; text: string } | null;
	onSave: (e?: React.FormEvent) => void;
}) {
	const { t } = useTranslation();
	// 存量 7/8 位库：引导用户重设为 6 位（PIN_LENGTH）。同步读 localStorage，成本可忽略
	const pinLength = getPinLength();
	// 掩码文本（-webkit-text-security）优先：type=password 会被密码管理器误判为登录表单
	const maskSupported =
		typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
			? CSS.supports('-webkit-text-security', 'disc')
			: false;

	return (
		<div className="px-4 py-3">
			<div className="flex items-center gap-3 mb-2">
				<Lock className="h-4 w-4 text-[var(--color-text-secondary)]" />
				<span className="text-sm text-[var(--color-text-primary)]">{t('settings.pin')}</span>
				{hasPin && (
					<span className="ml-auto rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-success-text)]">
						{t('settings.pinEnabled')}
					</span>
				)}
			</div>
			<p className="text-[11px] text-[var(--color-text-muted)] mb-2">
				{hasPin ? t('settings.pinDescEnabled') : t('settings.pinDescDisabled')}
			</p>
			{hasPin && pinLength !== null && pinLength !== PIN_LENGTH && (
				<p className="mb-2 text-[11px] text-[var(--color-text-muted)]">
					{t('settings.pinLegacyHint')}
				</p>
			)}
			{!hasPin && (
				<p className="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-[11px] text-[var(--color-danger-text)]">
					{t('settings.pinUnprotectedWarning')}
				</p>
			)}
			{pinMessage && (
				<div
					className={`mb-2 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs ${pinMessage.type === 'success' ? 'bg-success/10 text-[var(--color-success-text)]' : 'bg-danger/10 text-[var(--color-danger-text)]'}`}
				>
					{pinMessage.type === 'success' ? (
						<Check className="h-3.5 w-3.5 shrink-0" />
					) : (
						<AlertCircle className="h-3.5 w-3.5 shrink-0" />
					)}
					{pinMessage.text}
				</div>
			)}
			<form onSubmit={onSave} className="flex gap-2">
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
				<div className="flex-1">
					<label
						htmlFor="settings-pin-input"
						className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]"
					>
						{t('settings.pin')}
					</label>
					<input
						id="settings-pin-input"
						name="pin"
						type={maskSupported ? 'text' : 'password'}
						style={
							maskSupported
								? ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)
								: undefined
						}
						inputMode="numeric"
						pattern="[0-9]*"
						maxLength={6}
						value={pinInput}
						onChange={(e) => onPinChange(e.target.value.replace(/\D/g, ''))}
						placeholder={hasPin ? t('settings.pinPlaceholder') : t('settings.pinNewPlaceholder')}
						autoComplete="off"
						data-form-type="other"
						data-lpignore="true"
						data-1p-ignore="true"
						data-bwignore="true"
						className="w-full rounded-lg border border-auth-border bg-auth-elevated px-3 py-2 text-sm font-mono text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-primary-500"
					/>
				</div>
				<button
					type="submit"
					disabled={pinSaving}
					className="mt-auto rounded-lg bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-500 transition-colors disabled:opacity-50"
				>
					{pinSaving ? t('settings.pinSaving') : t('settings.pinSave')}
				</button>
			</form>
		</div>
	);
}
