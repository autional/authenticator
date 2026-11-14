/**
 * Push MFA Approval Page
 *
 * Triggered by Service Worker notificationclick or directly opened.
 * Displays the push challenge details and allows approve/deny.
 *
 * 安全约束（P0）：核验数字（numberMatching）**只从服务端 `getPushChallengeStatus()` 读取**，
 * 绝不从 URL 查询参数取。审批链接可被伪造 —— 攻击者能把自己挑战的码塞进链接，
 * 诱导受害者点「批准」从而放行攻击者自己的登录/操作；URL 参数不构成任何信任依据。
 *
 * 但服务端 `PushApproveRequest.NumberMatching` 是必填且逐值比对，所以批准/拒绝
 * **必须回传服务端下发的那个码**（`challenge.numberMatching`），否则一律 400。
 * 若服务端没给码 → 无法完成双向比对 → 按钮禁用（fail-closed），不回落到 URL 参数。
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ShieldX, AlertTriangle, Clock } from 'lucide-react';
import {
	approvePushChallenge,
	denyPushChallenge,
	getPushChallengeStatus,
	type PushChallengeStatus,
} from '../../lib/push';
import { extractApiError } from '@autional/shared';
import { classifyApprovalFailure } from '../../lib/login-approval';

export default function PushApprovePage() {
	const { t } = useTranslation();
	const [searchParams] = useSearchParams();
	const challengeId = searchParams.get('challengeId') || '';

	const [challenge, setChallenge] = useState<PushChallengeStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [actionLoading, setActionLoading] = useState(false);
	const [result, setResult] = useState<'approved' | 'denied' | 'expired' | null>(null);

	// AU2-02：Problem 信封的 title 是英文服务端文案；优先消费语言中立的 i18n_key，
	// 本地无该键时回落既有键链结果（message → title → detail → default）。
	const localizeApiError = useCallback(
		(err: unknown, fallback: string) => {
			const { message, i18nKey } = extractApiError(err, fallback);
			return i18nKey ? t(i18nKey, { defaultValue: message }) : message;
		},
		[t],
	);

	// AU-26：抽为可重取回调 —— 错误态「重试」= 真实 GET（非假转态）
	// silent：动作判死（409/404）后的后台复核 —— 不闪 loading、不清掉刚给的事实性提示
	const loadChallenge = useCallback(
		async (opts?: { silent?: boolean }) => {
			const silent = opts?.silent === true;
			if (!silent) {
				setLoading(true);
				setError(null);
			}

			if (!challengeId) {
				setError(t('pushApprove.missingParams'));
				if (!silent) setLoading(false);
				return;
			}

			try {
				const data = await getPushChallengeStatus(challengeId);
				setChallenge(data);
				// 只认三种终态；未知状态不伪造「已拒绝」（留在审批面等真实状态）
				if (data.status === 'approved' || data.status === 'denied' || data.status === 'expired') {
					setResult(data.status);
				}
			} catch (err) {
				if (!silent) setError(localizeApiError(err, t('pushApprove.loadFailed')));
			} finally {
				if (!silent) setLoading(false);
			}
		},
		[challengeId, t, localizeApiError],
	);

	useEffect(() => {
		void loadChallenge();
	}, [loadChallenge]);

	// 只认服务端下发的那份码；URL 的 numberMatching 一律不参与（既不上屏也不回传）
	const serverNumberMatching = challenge?.numberMatching ?? '';
	// fail-closed：加载中 / 服务端未给码 → 无法完成双向比对，批准与拒绝都禁用
	const canDecide = Boolean(challengeId) && serverNumberMatching.length > 0 && !actionLoading;

	/**
	 * 动作失败分流：409（已被处理/替代）与 404（已失效/不属于当前账号）**不是系统错误** ——
	 * 给事实性文案，并静默复核服务端真实状态（若已是终态直接落终态屏）。
	 */
	const handleDecisionFailure = (err: unknown, fallback: string) => {
		const failure = classifyApprovalFailure(err);
		if (failure === 'conflict') {
			setError(t('approvals.conflictResolved'));
			void loadChallenge({ silent: true });
			return;
		}
		if (failure === 'not_found') {
			setError(t('approvals.notFoundDesc'));
			void loadChallenge({ silent: true });
			return;
		}
		setError(localizeApiError(err, fallback));
	};

	const handleApprove = async () => {
		if (!challengeId || !serverNumberMatching) return;
		setActionLoading(true);
		try {
			await approvePushChallenge(challengeId, serverNumberMatching);
			setResult('approved');
		} catch (err: unknown) {
			handleDecisionFailure(err, t('pushApprove.approveFailed'));
		} finally {
			setActionLoading(false);
		}
	};

	const handleDeny = async () => {
		if (!challengeId || !serverNumberMatching) return;
		setActionLoading(true);
		try {
			await denyPushChallenge(challengeId, serverNumberMatching);
			setResult('denied');
		} catch (err: unknown) {
			handleDecisionFailure(err, t('pushApprove.denyFailed'));
		} finally {
			setActionLoading(false);
		}
	};

	if (loading) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-auth-bg">
				<div className="text-center">
					<div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-neutral-200 border-t-blue-600 dark:border-neutral-700 dark:border-t-primary-500" />
					<p className="text-[var(--color-text-secondary)] dark:text-[var(--color-text-secondary)]">{t('pushApprove.loading')}</p>
				</div>
			</div>
		);
	}

	if (error && !challenge) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-auth-bg p-4">
				<div className="w-full max-w-sm rounded-xl bg-white dark:bg-auth-surface p-6 shadow-card">
					<div className="mb-4 flex justify-center">
						<AlertTriangle className="h-12 w-12 text-danger-text" />
					</div>
					<h1 className="mb-2 text-center text-xl font-semibold text-[var(--color-text-primary)] dark:text-[var(--color-text-primary)]">
						{t('pushApprove.errorTitle')}
					</h1>
					<p className="text-center text-[var(--color-text-secondary)] dark:text-[var(--color-text-secondary)]">{error}</p>
					{/* AU-26：两枚真实出路 —— 有 challengeId 才给真重试（不可重试的「重试」不造假） */}
					<div className="mt-6 flex flex-col gap-3">
						{challengeId && (
							<button
								onClick={() => void loadChallenge()}
								className="rounded-lg bg-info dark:bg-primary-600 px-4 py-3 font-medium text-white transition hover:bg-info dark:hover:bg-primary-500"
							>
								{t('common.retry')}
							</button>
						)}
						<Link
							to="/"
							className="rounded-lg border border-neutral-200 dark:border-auth-border bg-white dark:bg-auth-elevated px-4 py-3 font-medium text-[var(--color-text-secondary)] dark:text-[var(--color-text-secondary)] transition hover:bg-neutral-50 dark:hover:bg-auth-border"
						>
							{t('notFound.backHome')}
						</Link>
					</div>
				</div>
			</div>
		);
	}

	if (result) {
		const isApproved = result === 'approved';
		const isExpired = result === 'expired';
		return (
			<div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-auth-bg p-4">
				<div className="w-full max-w-sm rounded-xl bg-white dark:bg-auth-surface p-6 shadow-card">
					<div className="mb-4 flex justify-center">
						{isApproved ? (
							<ShieldCheck className="h-16 w-16 text-success-text" />
						) : isExpired ? (
							<Clock className="h-16 w-16 text-[var(--color-warning-text)]" />
						) : (
							<ShieldX className="h-16 w-16 text-danger-text" />
						)}
					</div>
					<h1 className="mb-2 text-center text-xl font-semibold text-[var(--color-text-primary)] dark:text-[var(--color-text-primary)]">
						{isApproved
							? t('pushApprove.approvedTitle')
							: isExpired
								? t('pushApprove.expiredTitle')
								: t('pushApprove.deniedTitle')}
					</h1>
					<p className="text-center text-[var(--color-text-secondary)] dark:text-[var(--color-text-secondary)]">
						{isApproved
							? t('pushApprove.approvedDesc')
							: isExpired
								? t('pushApprove.expiredDesc')
								: t('pushApprove.deniedDesc')}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-auth-bg p-4">
			<div className="w-full max-w-sm rounded-xl bg-white dark:bg-auth-surface p-6 shadow-card">
				<div className="mb-4 flex justify-center">
					<div className="flex h-16 w-16 items-center justify-center rounded-full bg-info-soft dark:bg-primary-500/10">
						<ShieldCheck className="h-8 w-8 text-info-text dark:text-primary-400" />
					</div>
				</div>

				<h1 className="mb-2 text-center text-xl font-semibold text-[var(--color-text-primary)] dark:text-[var(--color-text-primary)]">
					{t('pushApprove.requestTitle')}
				</h1>

				{challenge?.loginContext && (
					<p className="mb-4 text-center text-sm text-[var(--color-text-secondary)] dark:text-[var(--color-text-secondary)]">
						{t('pushApprove.contextLabel')} {challenge.loginContext}
					</p>
				)}

				{challenge?.numberMatching && (
					<div className="mb-6 rounded-lg bg-neutral-100 dark:bg-auth-elevated p-4 text-center">
						<p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] dark:text-[var(--color-text-muted)]">
							{t('pushApprove.verificationNumber')}
						</p>
						<p className="mt-1 text-4xl font-bold text-[var(--color-text-primary)] dark:text-[var(--color-text-primary)]">
							{challenge.numberMatching}
						</p>
						<p className="mt-1 text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted)]">
							{t('pushApprove.numberHint')}
						</p>
					</div>
				)}

				{/* fail-closed：服务端未下发核验数字时明确告知，并禁用两枚按钮（绝不回落到 URL 参数） */}
				{challenge && !serverNumberMatching && (
					<div className="mb-4 rounded-lg bg-warning/10 p-3 text-center text-sm text-[var(--color-warning-text)]">
						{t('pushApprove.missingServerNumber')}
					</div>
				)}

				{error && (
					<div className="mb-4 rounded-lg bg-danger-soft dark:bg-danger/10 p-3 text-sm text-danger-text dark:text-[var(--color-danger-text)]">
						{error}
					</div>
				)}

				<div className="flex gap-3">
					<button
						onClick={handleDeny}
						disabled={!canDecide}
						className="flex-1 rounded-lg border border-neutral-200 dark:border-auth-border bg-white dark:bg-auth-elevated px-4 py-3 font-medium text-[var(--color-text-secondary)] dark:text-[var(--color-text-secondary)] transition hover:bg-neutral-50 dark:hover:bg-auth-border disabled:opacity-50"
					>
						{actionLoading ? '...' : t('pushApprove.deny')}
					</button>
					<button
						onClick={handleApprove}
						disabled={!canDecide}
						className="flex-1 rounded-lg bg-info dark:bg-primary-600 px-4 py-3 font-medium text-white transition hover:bg-info dark:hover:bg-primary-500 disabled:opacity-50"
					>
						{actionLoading ? '...' : t('pushApprove.approve')}
					</button>
				</div>
			</div>
		</div>
	);
}
