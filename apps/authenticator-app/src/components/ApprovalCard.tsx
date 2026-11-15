import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@autional/ui';
import { extractApiError } from '@autional/shared';
import {
	CONFIRM_CODE_PATTERN,
	approvalIdentity,
	approvePending,
	classifyApprovalFailure,
	classifyStepUpFailure,
	denyPending,
	formatRemaining,
	isStepUpApproval,
	isValidConfirmCode,
	maskIp,
	truncateUa,
	type PendingApproval,
} from '../lib/login-approval';

/**
 * 单条登录审批卡片 —— 审批码 / 来源 / 位置 / 剩余时间 / 「不是我」「是我」。
 *
 * 复用点：`/approvals` 列表与 `/a/:code` 短链落地页渲染的是同一个组件，
 * 行为与文案不会在两处漂移。
 *
 * step_up（`requires_step_up=true`，ADR-025 P1-t1-2）：
 *   - 该行**不下发审批码**（码只在桌面屏幕上），所以卡片**不渲染码**，改为渲染
 *     「输入电脑上显示的 6 位码」输入框 + 「请核对电脑屏幕」提示；
 *   - 未满 6 位时「是我」（以及需要同一个码定位的「不是我」）不可点；
 *   - 提交走 by-request-id + `confirm_code`；403 两种子情形各自出文案，**卡片保留**可重试
 *     （服务端此时 pending 未消耗）。
 *
 * 约束：
 * - 审批码是唯一的判定依据，展示用大字等宽（避免 6/8、0/O 误读）；
 * - 位置（`geoCity`）单独一行小字：不跟 IP 挤同一行，避免窄屏换行错乱；
 *   空串/缺失即不渲染（不显示「未知」，也不留占位）；
 * - 剩余时间本地倒计时，归零即回调 onExpired（父级移除，不再对过期项发请求）；
 * - 批准/拒绝失败按 extractApiError 展示可读文案（不静默、不假重试）；
 * - 「不是我」与「是我」**同级**：同 size（md）、同 variant 家族（filled）、同 fullWidth，
 *   差异只在颜色（danger vs brand）—— 不用降级表达「次要」；反证的代价是「随便点同意」，
 *   所以拒绝必须和批准一样好点。后果提示放按钮下方 11px 小字，并用 aria-describedby
 *   挂在「不是我」上（只在聚焦该按钮时读屏播报，不重复打扰）。
 */

export interface ApprovalCardProps {
	item: PendingApproval;
	/**
	 * 成功批准/拒绝后回调（父级把该项从列表移除 / 落终态）。
	 * 传的是**稳定身份**（普通行 = 审批码，step_up 行 = request_id，见 `approvalIdentity`）。
	 */
	onResolved: (id: string, result: 'approved' | 'denied') => void;
	/** 本地倒计时归零（父级移除该项） */
	onExpired: (id: string) => void;
	/**
	 * 动作失败但该条已**不再是本账号的有效待审批**（409 已被处理/替代、404 已失效）→ 父级移除该条并刷新列表。
	 * 不传时退回卡片内联提示（行为与旧版一致）。
	 */
	onStale?: (id: string, failure: 'conflict' | 'not_found') => void;
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

export default function ApprovalCard({
	item,
	onResolved,
	onExpired,
	onStale,
}: ApprovalCardProps) {
	const { t } = useTranslation();
	const confirmInputId = useId();
	const denyHintId = useId();
	const [remaining, setRemaining] = useState(() => Math.max(0, Math.floor(item.expiresIn)));
	const [busy, setBusy] = useState<'' | 'approve' | 'deny'>('');
	const [error, setError] = useState('');
	/** step_up：用户在手机上**手输**的桌面码（不落盘、不缓存、提交后仍留在输入框以便改错重试） */
	const [confirmCode, setConfirmCode] = useState('');
	const expiredRef = useRef(false);
	const onExpiredRef = useRef(onExpired);
	const identity = approvalIdentity(item);
	const stepUp = isStepUpApproval(item);
	const confirmReady = !stepUp || isValidConfirmCode(confirmCode);
	useEffect(() => {
		onExpiredRef.current = onExpired;
	}, [onExpired]);

	useEffect(() => {
		setRemaining(Math.max(0, Math.floor(item.expiresIn)));
		expiredRef.current = false;
	}, [item.requestId, item.expiresIn]);

	useEffect(() => {
		if (remaining <= 0) {
			if (!expiredRef.current) {
				expiredRef.current = true;
				onExpiredRef.current(identity);
			}
			return;
		}
		const id = setTimeout(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
		return () => clearTimeout(id);
	}, [remaining, identity]);

	const act = useCallback(
		async (result: 'approved' | 'denied') => {
			if (busy) return;
			// step_up：未满 6 位不发请求（按双保险；按钮本身已 disabled）
			const typedCode = confirmCode.trim();
			if (stepUp && !CONFIRM_CODE_PATTERN.test(typedCode)) return;
			setBusy(result === 'approved' ? 'approve' : 'deny');
			setError('');
			try {
				if (result === 'approved') await approvePending(item, typedCode);
				else await denyPending(item, typedCode);
				onResolved(identity, result);
			} catch (err) {
				// step_up 403（缺码 / 错码）：pending 未被消耗 —— 出对应文案，**卡片保留**让用户改码重试。
				const stepUpFailure = classifyStepUpFailure(err);
				if (stepUpFailure) {
					setError(
						t(
							stepUpFailure === 'step_up_required'
								? 'approvals.stepUpRequired'
								: 'approvals.stepUpMismatch',
						),
					);
					return;
				}
				// 409（已被处理/替代）与 404（已失效/不属于当前账号）不是「系统错误」：
				// 给事实性文案，并让父级把这条从待审批里清掉（否则用户对着死卡片反复点）。
				const failure = classifyApprovalFailure(err);
				if (failure === 'conflict') {
					setError(t('approvals.conflictResolved'));
					onStale?.(identity, 'conflict');
				} else if (failure === 'not_found') {
					setError(t('approvals.notFoundDesc'));
					onStale?.(identity, 'not_found');
				} else {
					const fallback =
						result === 'approved'
							? t('approvals.approveFailed')
							: t('approvals.denyFailed');
					setError(extractApiError(err, fallback).message || fallback);
				}
			} finally {
				setBusy('');
			}
		},
		[busy, confirmCode, identity, item, onResolved, onStale, stepUp, t],
	);

	const originParts = [truncateUa(item.originUa), maskIp(item.originIp)].filter(Boolean);
	const signals = toContextSignals(item, t);
	// 位置：只展示服务端解析出的城市（如「广东 深圳」）；空串/缺失 → 整行不渲染
	const geoCity = (item.geoCity || '').trim();

	return (
		<div
			className="space-y-3 rounded-xl border border-auth-border bg-auth-elevated p-4"
			data-testid={`approval-card-${identity}`}
		>
			{stepUp ? (
				<div className="space-y-2" data-testid="approval-stepup">
					<label
						htmlFor={confirmInputId}
						className="block text-center text-xs text-[var(--color-text-secondary)]"
					>
						{t('approvals.stepUpLabel')}
					</label>
					<Input
						id={confirmInputId}
						name="approval-confirm-code"
						type="text"
						inputMode="numeric"
						autoComplete="one-time-code"
						maxLength={6}
						value={confirmCode}
						onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
						placeholder={t('approvals.stepUpPlaceholder')}
						aria-describedby={`${confirmInputId}-hint`}
						data-testid="approval-confirm-input"
						className="text-center font-mono text-lg tracking-[0.3em]"
					/>
					<p
						id={`${confirmInputId}-hint`}
						data-testid="approval-stepup-hint"
						className="text-center text-xs text-[var(--color-text-secondary)]"
					>
						{t('approvals.stepUpHint')}
					</p>
				</div>
			) : (
				<div className="text-center">
					<p className="mb-1 text-xs text-[var(--color-text-secondary)]">
						{t('approvals.codeLabel')}
					</p>
					<p
						aria-live="polite"
						className="font-mono text-3xl font-bold tracking-[0.3em] tabular-nums text-[var(--color-text-primary)]"
						data-testid="approval-code"
					>
						{item.code}
					</p>
				</div>
			)}

			<div className="space-y-1 text-xs text-[var(--color-text-secondary)]">
				{originParts.length > 0 && (
					<p className="break-words" data-testid="approval-origin">
						{t('approvals.originLabel')}: {originParts.join(' · ')}
					</p>
				)}
				{geoCity !== '' && (
					<p className="break-words" data-testid="approval-location">
						{t('approvals.locationLabel')}: {geoCity}
					</p>
				)}
				{signals.length > 0 && (
					<div className="flex flex-wrap items-center gap-1.5" data-testid="approval-signals">
						{signals.map((signal) => (
							<span
								key={signal.key}
								data-testid={`approval-signal-${signal.key}`}
								className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SIGNAL_TONE_CLASS[signal.tone]}`}
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
					aria-describedby={denyHintId}
					disabled={busy !== '' || !confirmReady}
					onClick={() => void act('denied')}
				>
					{t('approvals.deny')}
				</Button>
				<Button
					variant="primary"
					fullWidth
					disabled={busy !== '' || !confirmReady}
					onClick={() => void act('approved')}
				>
					{t('approvals.approve')}
				</Button>
			</div>

			{/*
			 * 「不是我」的判定提示：放在按钮下方、字号最小 —— 不抢审批码与按钮的视觉层级，
			 * 但点名「批准 = 对方电脑登录你的账号」这个后果，抑制盲点批准。
			 * 只用 aria-describedby 挂到「不是我」上（读屏用户点到该按钮时听到），不重复播报。
			 */}
			<p
				id={denyHintId}
				data-testid="approval-deny-hint"
				className="text-center text-[11px] text-[var(--color-text-secondary)]"
			>
				{t('approvals.denyHint')}
			</p>
		</div>
	);
}
