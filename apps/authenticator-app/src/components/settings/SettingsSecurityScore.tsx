import { useTranslation } from 'react-i18next';
import { useSecurityScore } from '@/hooks/use-security-score';

export default function SettingsSecurityScore({
	accountsCount,
	inAppNotifications,
	hasPin,
	hasBackupCodes,
}: {
	accountsCount: number;
	inAppNotifications: boolean;
	hasPin: boolean;
	hasBackupCodes: boolean;
}) {
	const { t } = useTranslation();
	const securityScore = useSecurityScore(accountsCount, hasPin, inAppNotifications, hasBackupCodes);

	return (
		<section>
			<div className="rounded-xl border border-auth-border bg-auth-surface p-4">
				<div className="flex items-center gap-3">
					<div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
						<svg className="h-14 w-14 -rotate-90" viewBox="0 0 36 36">
							<path
								className="text-auth-elevated"
								d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
								fill="none"
								stroke="currentColor"
								strokeWidth="3"
							/>
							<path
								className={
									securityScore >= 80
										? 'text-[var(--color-success-text)]'
										: securityScore >= 50
											? 'text-[var(--color-warning-text)]'
											: 'text-[var(--color-danger-text)]'
								}
								strokeDasharray={`${securityScore}, 100`}
								d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
								fill="none"
								stroke="currentColor"
								strokeWidth="3"
								strokeLinecap="round"
							/>
						</svg>
						<span className="absolute text-xs font-bold text-[var(--color-text-primary)]">{securityScore}</span>
					</div>
					<div>
						<h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.securityScore')}</h2>
						<p className="text-xs text-[var(--color-text-secondary)]">
							{securityScore >= 80
								? t('settings.scoreGreat')
								: securityScore >= 50
									? t('settings.scoreOk')
									: t('settings.scoreLow')}
						</p>
					</div>
				</div>
				<div className="mt-3 grid grid-cols-2 gap-2">
					<ScoreItem label={t('settings.scoreTotpAccounts')} value={accountsCount} max={10} />
					<ScoreItem label={t('settings.scoreInApp')} value={inAppNotifications ? 1 : 0} max={1} />
					<ScoreItem label={t('settings.scorePinProtection')} value={hasPin ? 1 : 0} max={1} />
					<ScoreItem
						label={t('settings.scoreBackupCodes')}
						value={hasBackupCodes ? 1 : 0}
						max={1}
					/>
				</div>
			</div>
		</section>
	);
}

function ScoreItem({ label, value, max }: { label: string; value: number; max: number }) {
	const pct = Math.min(100, Math.round((value / max) * 100));
	return (
		<div className="rounded-lg bg-auth-elevated p-2 text-center">
			<p className="text-lg font-bold text-[var(--color-text-primary)]">{value}</p>
			<p className="text-[11px] text-[var(--color-text-muted)]">{label}</p>
			<div className="mt-1 h-1 w-full rounded-full bg-auth-border overflow-hidden">
				<div
					className={`h-full rounded-full ${pct >= 100 ? 'bg-success' : pct >= 50 ? 'bg-warning' : 'bg-danger'}`}
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	);
}
