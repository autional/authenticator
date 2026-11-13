import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { showToast } from '@autional/ui';
import { extractApiError } from '@autional/shared';
import ApprovalCard from '../../components/ApprovalCard';
import BottomNav from '../../components/BottomNav';
import { listPendingApprovals, type PendingApproval } from '../../lib/login-approval';
import { toSlugged, useTenantSlug } from '../../lib/slug';

/**
 * 待审批的登录请求（App 侧）。
 *
 * 进入即拉一次 + 手动刷新：登录门户「用 App 确认」发起后，请求会出现在这里。
 * 过期项（服务端已判 TTL 到点）不展示 —— 留着只会让用户点一个注定失败的按钮。
 *
 * 页壳约束（与 notifications / devices 等一级页一致）：
 *   - 粘顶标题栏（等高令牌 + 返回 + 右侧刷新），滚动时标题不随之滚走；
 *   - 渲染 BottomNav —— 本页是底栏一级入口，缺底栏会让用户进得来出不去。
 */
export default function ApprovalsPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
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
		<div className="flex min-h-full flex-col">
			<header className="sticky top-0 z-10 flex items-center gap-3 border-b border-auth-border bg-auth-bg/80 h-[var(--layout-header-height)] px-4 backdrop-blur-md">
				<button
					onClick={() => navigate(toSlugged('/', slug))}
					className="rounded-lg p-1.5 text-[var(--color-text-secondary)] hover:bg-auth-elevated hover:text-[var(--color-text-primary)] transition-colors"
					aria-label={t('common.back')}
				>
					<ArrowLeft className="h-5 w-5" />
				</button>
				<h1 className="text-lg font-bold text-[var(--color-text-primary)]">{t('approvals.title')}</h1>
				<div className="ml-auto flex items-center gap-2">
					<button
						onClick={() => void load('refresh')}
						disabled={refreshing}
						className="rounded-lg p-1.5 text-[var(--color-text-secondary)] hover:bg-auth-elevated hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50"
						aria-label={t('approvals.refresh')}
					>
						<RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
					</button>
				</div>
			</header>

			<div className="flex-1 space-y-3 px-4 py-4">
				<p className="text-xs text-[var(--color-text-secondary)]">{t('approvals.subtitle')}</p>

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
			</div>

			<BottomNav />
		</div>
	);
}
