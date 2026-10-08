/**
 * Push MFA Approval Page
 *
 * Triggered by Service Worker notificationclick or directly opened.
 * Displays the push challenge details and allows approve/deny.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ShieldX, AlertTriangle } from 'lucide-react';
import {
	approvePushChallenge,
	denyPushChallenge,
	getPushChallengeStatus,
	type PushChallengeStatus,
} from '../../lib/push';
import { extractApiErrorMessage } from '@autional/shared';

export default function PushApprovePage() {
	const { t } = useTranslation();
	const [searchParams] = useSearchParams();
	const challengeId = searchParams.get('challengeId') || '';
	const urlNumberMatching = searchParams.get('numberMatching') || '';

	const [challenge, setChallenge] = useState<PushChallengeStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [actionLoading, setActionLoading] = useState(false);
	const [result, setResult] = useState<'approved' | 'denied' | null>(null);

	// AU-26：抽为可重取回调 —— 错误态「重试」= 真实 GET（非假转态）
	const loadChallenge = useCallback(async () => {
		setLoading(true);
		setError(null);

		if (!challengeId) {
			setError(t('pushApprove.missingParams'));
			setLoading(false);
			return;
		}

		try {
			const data = await getPushChallengeStatus(challengeId);
			setChallenge(data);
			if (data.status !== 'pending') {
				setResult(data.status === 'approved' ? 'approved' : 'denied');
			}
		} catch (err) {
			setError(extractApiErrorMessage(err, t('pushApprove.loadFailed')));
		} finally {
			setLoading(false);
		}
	}, [challengeId, t]);

	useEffect(() => {
		void loadChallenge();
	}, [loadChallenge]);

	const handleApprove = async () => {
		if (!challengeId) return;
		setActionLoading(true);
		try {
			await approvePushChallenge(challengeId, urlNumberMatching);
			setResult('approved');
		} catch (err: unknown) {
			setError(extractApiErrorMessage(err, t('pushApprove.approveFailed')));
		} finally {
			setActionLoading(false);
		}
	};

	const handleDeny = async () => {
		if (!challengeId) return;
		setActionLoading(true);
		try {
			await denyPushChallenge(challengeId, urlNumberMatching);
			setResult('denied');
		} catch (err: unknown) {
			setError(extractApiErrorMessage(err, t('pushApprove.denyFailed')));
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
		return (
			<div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-auth-bg p-4">
				<div className="w-full max-w-sm rounded-xl bg-white dark:bg-auth-surface p-6 shadow-card">
					<div className="mb-4 flex justify-center">
						{isApproved ? (
							<ShieldCheck className="h-16 w-16 text-success-text" />
						) : (
							<ShieldX className="h-16 w-16 text-danger-text" />
						)}
					</div>
					<h1 className="mb-2 text-center text-xl font-semibold text-[var(--color-text-primary)] dark:text-[var(--color-text-primary)]">
						{isApproved ? t('pushApprove.approvedTitle') : t('pushApprove.deniedTitle')}
					</h1>
					<p className="text-center text-[var(--color-text-secondary)] dark:text-[var(--color-text-secondary)]">
						{isApproved ? t('pushApprove.approvedDesc') : t('pushApprove.deniedDesc')}
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

				{urlNumberMatching && (
					<div className="mb-6 rounded-lg bg-neutral-100 dark:bg-auth-elevated p-4 text-center">
						<p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] dark:text-[var(--color-text-muted)]">
							{t('pushApprove.verificationNumber')}
						</p>
						<p className="mt-1 text-4xl font-bold text-[var(--color-text-primary)] dark:text-[var(--color-text-primary)]">
							{urlNumberMatching}
						</p>
						<p className="mt-1 text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted)]">
							{t('pushApprove.numberHint')}
						</p>
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
						disabled={actionLoading}
						className="flex-1 rounded-lg border border-neutral-200 dark:border-auth-border bg-white dark:bg-auth-elevated px-4 py-3 font-medium text-[var(--color-text-secondary)] dark:text-[var(--color-text-secondary)] transition hover:bg-neutral-50 dark:hover:bg-auth-border disabled:opacity-50"
					>
						{actionLoading ? '...' : t('pushApprove.deny')}
					</button>
					<button
						onClick={handleApprove}
						disabled={actionLoading}
						className="flex-1 rounded-lg bg-info dark:bg-primary-600 px-4 py-3 font-medium text-white transition hover:bg-info dark:hover:bg-primary-500 disabled:opacity-50"
					>
						{actionLoading ? '...' : t('pushApprove.approve')}
					</button>
				</div>
			</div>
		</div>
	);
}
