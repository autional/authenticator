import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Check, AlertCircle } from 'lucide-react';
import SettingsPinDialog from './SettingsPinDialog';
import { getPinLength } from '@/lib/storage';
import { PIN_LENGTH } from '@/lib/crypto';

/**
 * 应用锁 PIN（设置页）：**一行状态 + 「修改 PIN」按钮**，键盘收进弹层。
 *
 * 为什么不把键盘内嵌在设置列表里：键盘是整块交互面（圆点 + 3×4 网格），
 * 塞进设置行会让「安全」分组出现一块比其它行高 5 倍的区域，滚动时也不便误触。
 *
 * 为什么不支持「留空禁用」：冷启动是硬强制设锁（无 PIN 的库必须先设 PIN），
 * 禁用后下次打开又会被强制设回，属自相矛盾的入口，故移除。
 */
export default function SettingsPinProtection({
	hasPin,
	pinMessage,
	verifyCurrent,
	onSubmitNew,
}: {
	hasPin: boolean;
	pinMessage: { type: 'success' | 'error'; text: string } | null;
	verifyCurrent: (pin: string) => Promise<boolean>;
	onSubmitNew: (pin: string) => Promise<boolean>;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	// 存量库可能是旧长度（4-8 位）：仍能解锁，但建议重设为 6 位 —— 只提示不拦截
	const legacyLength = hasPin && getPinLength() !== PIN_LENGTH;

	return (
		<div className="px-4 py-3">
			<div className="flex items-center gap-3 mb-2">
				<Lock className="h-4 w-4 text-[var(--color-text-secondary)]" />
				<span className="text-sm text-[var(--color-text-primary)]">{t('settings.pin')}</span>
				{hasPin && (
					<span className="ml-auto rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-[var(--color-success-text)]">
						{t('settings.pinEnabled')}
					</span>
				)}
			</div>
			<p className="text-xs text-[var(--color-text-muted)] mb-2">
				{hasPin ? t('settings.pinDescEnabled') : t('settings.pinDescDisabled')}
			</p>
			{legacyLength && (
				<p className="mb-2 text-xs text-[var(--color-warning-text)]">
					{t('settings.pinLegacyHint')}
				</p>
			)}
			{!hasPin && (
				<p className="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-[var(--color-danger-text)]">
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
			{hasPin && (
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="mt-1 w-full rounded-lg border border-auth-border bg-auth-surface py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-auth-elevated"
				>
					{t('settings.pinChange')}
				</button>
			)}
			<SettingsPinDialog
				open={open}
				onClose={() => setOpen(false)}
				verifyCurrent={verifyCurrent}
				onSubmitNew={onSubmitNew}
			/>
		</div>
	);
}
