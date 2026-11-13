import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@autional/ui';
import { extractApiError } from '@autional/shared';
import {
	approveByCode,
	denyByCode,
	formatRemaining,
	maskIp,
	truncateUa,
	type PendingApproval,
} from '../lib/login-approval';

/**
 * 单条登录审批卡片 —— 审批码 / 来源 / 剩余时间 / 「不是我」「是我」。
 *
 * 复用点：`/approvals` 列表与 `/a/:code` 短链落地页渲染的是同一个组件，
 * 行为与文案不会在两处漂移。
 *
 * 约束：
 * - 审批码是唯一的判定依据，展示用大字等宽（避免 6/8、0/O 误读）；
 * - 剩余时间本地倒计时，归零即回调 onExpired（父级移除，不再对过期项发请求）；
 * - 批准/拒绝失败按 extractApiError 展示可读文案（不静默、不假重试）。
 */

export interface ApprovalCardProps {
	item: PendingApproval;
	/** 成功批准/拒绝后回调（父级把该项从列表移除 / 落终态） */
	onResolved: (code: string, result: 'approved' | 'denied') => void;
	/** 本地倒计时归零（父级移除该项） */
	onExpired: (code: string) => void;
}

/** 上下文信号徽标的两档语义色（沿用 token，色不单独表意 —— 徽标始终带文字）。 */
const SIGNAL_TONE_CLASS = {
	familiar: 'bg-success/10 text-[var(--color-success-text)]',
	novel: 'bg-warning/10 text-[var(--color-warning-text)]',
} as const;

type SignalTone = keyof typeof SIGNAL_TONE_CLASS;

interface ContextSignal {
	key: 'device' | 'network';
	label: string;
	tone: SignalTone;
}

/**
 * 把后端的 `known_device` / `familiar_network` 折成 0..2 个徽标。
 * `null`（无法判断）与 `undefined`（旧版后端未下发）一律不渲染 —— 不显示「未知」，也不占位。
 */
function toContextSignals(
	item: PendingApproval,
	t: (key: string) => string,
): ContextSignal[] {
	const signals: ContextSignal[] = [];
	if (item.knownDevice === true) {
		signals.push({ key: 'device', label: t('approvals.knownDevice'), tone: 'familiar' });
	} else if (item.knownDevice === false) {
		signals.push({ key: 'device', label: t('approvals.newDevice'), tone: 'novel' });
	}
	if (item.familiarNetwork === true) {
		signals.push({ key: 'network', label: t('approvals.familiarNetwork'), tone: 'familiar' });
	} else if (item.familiarNetwork === false) {
		signals.push({ key: 'network', label: t('approvals.newNetwork'), tone: 'novel' });
	}
	return signals;
}

export default function ApprovalCard({ item, onResolved, onExpired }: ApprovalCardProps) {
	const { t } = useTranslation();
	const [remaining, setRemaining] = useState(() => Math.max(0, Math.floor(item.expiresIn)));
	const [busy, setBusy] = useState<'' | 'approve' | 'deny'>('');
	const [error, setError] = useState('');
	const expiredRef = useRef(false);
	const onExpiredRef = useRef(onExpired);
	useEffect(() => {
		onExpiredRef.current = onExpired;
	}, [onExpired]);

	useEffect(() => {
		setRemaining(Math.max(0, Math.floor(item.expiresIn)));
		expiredRef.current = false;
	}, [item.code, item.expiresIn]);

	useEffect(() => {
		if (remaining <= 0) {
			if (!expiredRef.current) {
				expiredRef.current = true;
				onExpiredRef.current(item.code);
			}
			return;
		}
		const id = setTimeout(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
		return () => clearTimeout(id);
	}, [remaining, item.code]);

	const act = useCallback(
		async (result: 'approved' | 'denied') => {
			if (busy) return;
			setBusy(result === 'approved' ? 'approve' : 'deny');
			setError('');
			try {
				if (result === 'approved') await approveByCode(item.code);
				else await denyByCode(item.code);
				onResolved(item.code, result);
			} catch (err) {
				const fallback =
					result === 'approved'
						? t('approvals.approveFailed')
						: t('approvals.denyFailed');
				setError(extractApiError(err, fallback).message || fallback);
			} finally {
				setBusy('');
			}
		},
		[busy, item.code, onResolved, t],
	);

	const originParts = [truncateUa(item.originUa), maskIp(item.originIp)].filter(Boolean);
	const signals = toContextSignals(item, t);

	return (
		<div
			className="space-y-3 rounded-xl border border-auth-border bg-auth-elevated p-4"
			data-testid={`approval-card-${item.code}`}
		>
			<div className="text-center">
				<p className="mb-1 text-xs text-[var(--color-text-secondary)]">{t('approvals.codeLabel')}</p>
				<p
					aria-live="polite"
					className="font-mono text-3xl font-bold tracking-[0.3em] tabular-nums text-[var(--color-text-primary)]"
					data-testid="approval-code"
				>
					{item.code}
				</p>
			</div>

			<div className="space-y-1 text-xs text-[var(--color-text-secondary)]">
				{originParts.length > 0 && (
					<p className="break-words" data-testid="approval-origin">
						{t('approvals.originLabel')}: {originParts.join(' · ')}
					</p>
				)}
				{signals.length > 0 && (
					<div className="flex flex-wrap items-center gap-1.5" data-testid="approval-signals">
						{signals.map((signal) => (
							<span
								key={signal.key}
								data-testid={`approval-signal-${signal.key}`}
								className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SIGNAL_TONE_CLASS[signal.tone]}`}
							>
								{signal.label}
							</span>
						))}
					</div>
				)}
				<p data-testid="approval-remaining">
					{remaining > 0
						? t('approvals.remaining', { time: formatRemaining(remaining) })
						: t('approvals.expired')}
				</p>
			</div>

			{error && (
				<div role="alert" className="rounded-md bg-danger-soft p-2 text-xs text-danger-text">
					{error}
				</div>
			)}

			<div className="flex gap-3">
				<Button
					variant="danger"
					fullWidth
					disabled={busy !== ''}
					onClick={() => void act('denied')}
				>
					{t('approvals.deny')}
				</Button>
				<Button
					variant="primary"
					fullWidth
					disabled={busy !== ''}
					onClick={() => void act('approved')}
				>
					{t('approvals.approve')}
				</Button>
			</div>
		</div>
	);
}
