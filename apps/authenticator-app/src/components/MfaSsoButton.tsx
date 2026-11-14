import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import { useAuthenticatorStore } from '@/lib/store';
import { readLastTenantSlug } from '@/lib/slug';
import { startMfaSsoLogin, navigateToLoginPage, usableMfaAccounts } from '@/lib/mfa-sso';
import { reportMfaSsoFailure } from '@/lib/mfa-sso-report';
import TenantPickerDialog from './TenantPickerDialog';

/**
 * 「用本机验证器登录」入口（挂在未登录闸门里）。
 *
 * 用户已在 auth 站点有会话时，不必再手输密码：拿本机保险库里的 TOTP secret 向
 * identity 换一张一次性票据，跳到 auth 登录页（ticket 走 fragment），用户只需输密码。
 *
 * 失败一律回落调用方给的 `onFallback`（现有手动登录），不弹错误详情：
 * 这条路径是**加速器**，不能成为登录的必经环节。
 */
export default function MfaSsoButton({
	slug,
	onFallback,
}: {
	/** 当前租户（URL 段或最近租户）；空串表示未知 → 打开租户选择弹窗 */
	slug?: string;
	onFallback: () => void;
}) {
	const { t } = useTranslation();
	const accounts = useAuthenticatorStore((s) => s.accounts);
	const usable = usableMfaAccounts(accounts);
	const [accountId, setAccountId] = useState('');
	const [busy, setBusy] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);

	// 只有一个可用账户 → 自动选中；多个 → 下拉（选中的 id 为空时同样落回首个）。
	const selected = usable.find((account) => account.id === accountId) ?? usable[0] ?? null;

	const run = async (tenant: string) => {
		if (!selected || busy) return;
		setBusy(true);
		try {
			const loginUrl = await startMfaSsoLogin(selected, tenant);
			navigateToLoginPage(loginUrl);
		} catch (error) {
			// 与 useSignIn 同口径：静默回落但留痕（已脱敏，不含 secret / proof / ticket），
			// 否则「点了没反应」在生产上没有任何可查线索。
			reportMfaSsoFailure('ticket-exchange', error);
			setBusy(false);
			onFallback();
		}
	};

	const handleClick = () => {
		if (!selected || busy) return;
		const tenant = (slug ?? '').trim().toLowerCase() || readLastTenantSlug();
		if (tenant) {
			void run(tenant);
			return;
		}
		setPickerOpen(true);
	};

	if (usable.length === 0) {
		return (
			<div className="mt-4 flex w-full max-w-xs flex-col items-stretch gap-2">
				<button
					type="button"
					disabled
					className="flex items-center justify-center gap-2 rounded-xl border border-auth-border bg-auth-surface px-6 py-2.5 text-sm font-semibold text-[var(--color-text-secondary)] opacity-60 transition-all"
				>
					<KeyRound className="h-4 w-4" />
					{t('signIn.mfaSso')}
				</button>
				<p className="text-xs text-[var(--color-text-muted)]">{t('signIn.mfaSsoNoAccount')}</p>
			</div>
		);
	}

	return (
		<div className="mt-4 flex w-full max-w-xs flex-col items-stretch gap-2">
			{usable.length > 1 && (
				<select
					aria-label={t('signIn.mfaSsoAccount')}
					value={selected?.id ?? ''}
					onChange={(event) => setAccountId(event.target.value)}
					disabled={busy}
					className="w-full rounded-xl border border-auth-border bg-auth-elevated px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-primary-500 disabled:opacity-50"
				>
					{usable.map((account) => (
						<option key={account.id} value={account.id}>
							{account.name ? `${account.name} · ${account.username}` : account.username}
						</option>
					))}
				</select>
			)}
			<button
				type="button"
				onClick={handleClick}
				disabled={busy || !selected}
				className="flex items-center justify-center gap-2 rounded-xl border border-auth-border bg-auth-elevated px-6 py-2.5 text-sm font-semibold text-[var(--color-text-primary)] transition-all hover:bg-auth-border active:scale-[0.98] disabled:opacity-50"
			>
				<KeyRound className="h-4 w-4" />
				{busy ? t('signIn.mfaSsoBusy') : t('signIn.mfaSso')}
			</button>
			<TenantPickerDialog
				open={pickerOpen}
				recent={readLastTenantSlug()}
				onPick={(picked) => {
					setPickerOpen(false);
					void run(picked);
				}}
				onCancel={() => setPickerOpen(false)}
			/>
		</div>
	);
}
