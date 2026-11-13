import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { showToast } from '@autional/ui';
import { extractApiError } from '@autional/shared';
import ApprovalCard from '../../components/ApprovalCard';
import { listPendingApprovals, type PendingApproval } from '../../lib/login-approval';
import { toSlugged, useTenantSlug } from '../../lib/slug';

/**
 * 待审批的登录请求（App 侧）。
 *
 * 进入即拉一次 + 手动刷新：登录门户「用 App 确认」发起后，请求会出现在这里。
 * 过期项（服务端已判 TTL 到点）不展示 —— 留着只会让用户点一个注定失败的按钮。
 */
export default function ApprovalsPage() {
	const { t } = useTranslation();
	const slug = useTenantSlug();
	const [items, setItems] = useState<PendingApproval[]>([]);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState('');

	const load = useCallback(async (mode: 'initial' | 'refresh') => {
		if (mode === 'refresh') setRefreshing(true);
		else setLoading(true);
		setError('');
		try {
			const list = await listPendingApprovals();
			setItems(list.filter((item) => Math.floor(item.expiresIn) > 0));
		} catch (err) {
			setError(extractApiError(err, t('approvals.loadFailed')).message || t('approvals.loadFailed'));
			setItems([]);
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	}, [t]);

	useEffect(() => {
		void load('initial');
	}, [load]);

	const removeItem = (code: string) => {
		setItems((prev) => prev.filter((item) => item.code !== code));
	};

	const handleResolved = (code: string, result: 'approved' | 'denied') => {
		removeItem(code);
		showToast(
			result === 'approved' ? t('approvals.approved') : t('approvals.denied'),
			'success',
		);
	};

	return (
		<div className="mx-auto w-full max-w-md space-y-4 px-4 py-6">
			<header className="flex items-start justify-between gap-3">
				<div>
					<h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
						{t('approvals.title')}
					</h1>
					<p className="mt-1 text-xs text-[var(--color-text-secondary)]">{t('approvals.subtitle')}</p>
				</div>
				<button
					type="button"
					onClick={() => void load('refresh')}
					disabled={refreshing}
					aria-label={t('approvals.refresh')}
					className="mt-1 flex items-center gap-1 rounded-md border border-auth-border px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-50"
				>
					<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
					{t('approvals.refresh')}
				</button>
			</header>

			{loading && (
				<p className="py-8 text-center text-sm text-[var(--color-text-muted)]">
					{t('common.loading')}
				</p>
			)}

			{!loading && error && (
				<div role="alert" className="space-y-3 rounded-md bg-danger-soft p-3 text-sm text-danger-text">
					<p>{error}</p>
					<button
						type="button"
						onClick={() => void load('refresh')}
						className="rounded-md border border-danger-text px-3 py-1.5 text-xs font-medium"
					>
						{t('common.retry')}
					</button>
				</div>
			)}

			{!loading && !error && items.length === 0 && (
				<div className="rounded-xl border border-auth-border bg-auth-elevated px-6 py-10 text-center">
					<p className="text-sm font-medium text-[var(--color-text-primary)]">
						{t('approvals.empty')}
					</p>
					<p className="mt-2 text-xs text-[var(--color-text-secondary)]">
						{t('approvals.emptyHint')}
					</p>
				</div>
			)}

			{!loading &&
				!error &&
				items.map((item) => (
					<ApprovalCard
						key={item.code}
						item={item}
						onResolved={handleResolved}
						onExpired={removeItem}
					/>
				))}

			<div className="pt-2 text-center">
				<Link
					to={toSlugged('/', slug)}
					className="text-xs text-[var(--color-text-secondary)] hover:underline"
				>
					{t('notFound.backHome')}
				</Link>
			</div>
		</div>
	);
}
