import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import ApprovalCard from '../../components/ApprovalCard';
import { listPendingApprovals, type PendingApproval } from '../../lib/login-approval';
import { toSlugged, useTenantSlug } from '../../lib/slug';

/**
 * 短链落地页 `/a/:code[?rid=<request_id>]` —— 从推送直达那一条待审批请求。
 *
 * 语义边界（重要）：
 *   这个页面**不信任 URL 里的码/rid**做任何判定。它只是「帮我从我的待审批列表里挑出这一条」，
 *   真正的判定与放行由服务端按当前登录身份完成 —— 所以码不属于当前账号时，
 *   结果只能是「已失效或不属于当前账号」，绝不能退化成一条可点批准的卡片。
 *
 * 两种查找方式（顺序即优先级）：
 *   1. 带 `rid`（推送 `data.request_id`）→ 按 `requestId` **精确匹配**。这是 step_up 行唯一的
 *      入口：该类行 pending 里**没有 code**（码只在桌面屏幕，见 lib/login-approval.ts 文件头），
 *      按 code 找必然落空 → 老深链会把它们显示成「已失效」= 断头。
 *   2. 无 `rid`（老推送）→ 维持原样：按 `code` 精确匹配，且要求 6 位数字形状。
 *   命中后统一渲染 `ApprovalCard`：step_up 的「手输桌面码 + by-request-id」逻辑在该组件内复用，
 *   本页不重复实现。
 *
 * 状态机：checking → ready | invalid | notfound | approved | denied
 *   - 无 rid 且码不是 6 位数字 → 终态 invalid（零请求）
 *   - 拉取失败 → 终态 error（可重试，真重试）
 */

type Phase =
	| { status: 'checking' }
	| { status: 'ready'; item: PendingApproval }
	| { status: 'invalid' }
	| { status: 'notfound' }
	/** 动作时被判 409/404：该条已不是本账号的有效待审批（已被处理/替代/失效） */
	| { status: 'stale'; failure: 'conflict' | 'not_found' }
	| { status: 'approved' }
	| { status: 'denied' }
	| { status: 'error'; message: string };

const CODE_PATTERN = /^\d{6}$/;

export default function ApprovalLinkPage() {
	const { t } = useTranslation();
	const slug = useTenantSlug();
	const { code = '' } = useParams<{ code: string }>();
	const [searchParams] = useSearchParams();
	/**
	 * 推送深链的 `rid` = 载荷里的 `data.request_id`（服务端主键）。
	 * 只作为「挑哪一条」的定位键，不构成判定依据 —— 与服务端的归属校验配合。
	 */
	const rid = (searchParams.get('rid') || '').trim();
	const [phase, setPhase] = useState<Phase>({ status: 'checking' });

	const check = useCallback(async () => {
		// 有 rid → 不看 code 形状（step_up 行的 code 只是深链的可读装饰）；
		// 无 rid → 老行为：码必须是 6 位数字，否则零请求直接终态。
		if (!rid && !CODE_PATTERN.test(code)) {
			setPhase({ status: 'invalid' });
			return;
		}
		setPhase({ status: 'checking' });
		try {
			const list = await listPendingApprovals();
			const hit = rid
				? list.find(
						(item) => (item.requestId || '').trim() === rid && Math.floor(item.expiresIn) > 0,
					)
				: list.find((item) => item.code === code && Math.floor(item.expiresIn) > 0);
			setPhase(hit ? { status: 'ready', item: hit } : { status: 'notfound' });
		} catch (err) {
			const message = (err as { message?: string })?.message || t('approvals.loadFailed');
			setPhase({ status: 'error', message });
		}
	}, [code, rid, t]);

	useEffect(() => {
		void check();
	}, [check]);

	const backHome = (
		<Link
			to={toSlugged('/', slug)}
			className="inline-flex h-10 w-full items-center justify-center rounded-md border border-[var(--color-border-subtle)] bg-transparent px-4 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-muted)]"
		>
			{t('notFound.backHome')}
		</Link>
	);

	const terminal = (title: string, desc: string) => (
		<div className="flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-sm space-y-4 text-center">
				<div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger-soft text-xl text-danger-text">
					!
				</div>
				<h1 className="text-xl font-bold">{title}</h1>
				<p className="text-sm text-[var(--color-text-muted)]">{desc}</p>
				{backHome}
			</div>
		</div>
	);

	if (phase.status === 'checking') {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center gap-3">
				<div className="h-8 w-8 animate-spin rounded-full border-4 border-info-soft border-t-transparent" />
				<p className="text-sm text-[var(--color-text-muted)]">{t('approvals.loading')}</p>
			</div>
		);
	}

	if (phase.status === 'invalid') {
		return terminal(t('approvals.linkInvalidTitle'), t('approvals.linkInvalidDesc'));
	}

	if (phase.status === 'notfound') {
		return terminal(t('approvals.notFoundTitle'), t('approvals.notFoundDesc'));
	}

	// 409 已被处理/替代 与 404 已失效 是两种事实，文案不同；都不退化成可点批准的卡片
	if (phase.status === 'stale') {
		return phase.failure === 'conflict'
			? terminal(t('approvals.conflictTitle'), t('approvals.conflictDesc'))
			: terminal(t('approvals.notFoundTitle'), t('approvals.notFoundDesc'));
	}

	if (phase.status === 'error') {
		return (
			<div className="flex min-h-screen items-center justify-center px-4">
				<div className="w-full max-w-sm space-y-4 text-center">
					<div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warning-soft text-xl text-warning-text">
						!
					</div>
					<h1 className="text-xl font-bold">{t('approvals.loadFailedTitle')}</h1>
					<p className="text-sm text-[var(--color-text-muted)]">{phase.message}</p>
					<button
						type="button"
						onClick={() => void check()}
						className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary-600 px-4 text-sm font-semibold text-white transition-all hover:bg-primary-500 active:scale-[0.98]"
					>
						{t('common.retry')}
					</button>
					{backHome}
				</div>
			</div>
		);
	}

	if (phase.status === 'approved' || phase.status === 'denied') {
		const approved = phase.status === 'approved';
		return (
			<div className="flex min-h-screen items-center justify-center px-4">
				<div className="w-full max-w-sm space-y-4 text-center">
					<div
						className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full text-xl ${
							approved ? 'bg-success-soft text-success-text' : 'bg-danger-soft text-danger-text'
						}`}
					>
						{approved ? '✓' : '×'}
					</div>
					<h1 className="text-xl font-bold">
						{approved ? t('approvals.approvedTitle') : t('approvals.deniedTitle')}
					</h1>
					<p className="text-sm text-[var(--color-text-muted)]">
						{approved ? t('approvals.approvedDesc') : t('approvals.deniedDesc')}
					</p>
					{backHome}
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen items-start justify-center px-4 pt-6">
			<div className="w-full max-w-sm space-y-4">
				<h1 className="text-center text-lg font-semibold text-[var(--color-text-primary)]">
					{t('approvals.title')}
				</h1>
				<ApprovalCard
					item={phase.item}
					onResolved={(_code, result) =>
						setPhase({ status: result === 'approved' ? 'approved' : 'denied' })
					}
					onExpired={() => setPhase({ status: 'notfound' })}
					onStale={(_code, failure) => setPhase({ status: 'stale', failure })}
				/>
			</div>
		</div>
	);
}
