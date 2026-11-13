import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { showToast } from '@autional/ui';
import { extractApiError } from '@autional/shared';
import ApprovalCard from '../../components/ApprovalCard';
import BottomNav from '../../components/BottomNav';
import { listPendingApprovals, type PendingApproval } from '../../lib/login-approval';
import { useApprovalNotificationRefresh } from '../../lib/approval-notification';
import { toSlugged, useTenantSlug } from '../../lib/slug';

/**
 * 待审批的登录请求（App 侧）。
 *
 * 进入即拉一次 + 手动刷新 + **前台自动刷新**：登录门户「用 App 确认」发起后，请求会
 * 出现在这里 —— 用户对延迟的感受几乎全取决于这一页多久能看见新请求。
 *   - 自动刷新：页面可见时 15s 一次，**静默**（不闪 loading、不重置滚动、不弹全局错误）；
 *   - 页面不可见时暂停（不空烧请求），回到前台立即补拉一次并恢复节奏；
 *   - 失败静默：不清空已有列表、不打断已渲染内容，手动刷新按钮始终可用。
 *   - SSE 即时刷新：审批类通知一到就静默刷新（见下），15s 轮询降级为兜底。
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
	const silentInFlight = useRef(false);

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

	// 静默刷新：只换数据，不碰 loading；失败不提示、不清空列表（手动刷新始终可用）
	const silentRefresh = useCallback(async () => {
		if (silentInFlight.current) return;
		silentInFlight.current = true;
		try {
			const list = await listPendingApprovals();
			setItems(list.filter((item) => Math.floor(item.expiresIn) > 0));
			setError('');
		} catch {
			// 静默：保留已有列表与错误态
		} finally {
			silentInFlight.current = false;
		}
	}, []);

	useEffect(() => {
		const tick = () => {
			if (document.visibilityState === 'visible') void silentRefresh();
		};
		const interval = setInterval(tick, 15000);
		const onVisibilityChange = () => {
			// 回前台立即补拉一次，不等下一个 15s 周期
			if (document.visibilityState === 'visible') void silentRefresh();
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		return () => {
			clearInterval(interval);
			document.removeEventListener('visibilitychange', onVisibilityChange);
		};
	}, [silentRefresh]);

	// SSE 即时刷新：审批类通知一到就拉一次，不等 15s 周期（15s 轮询保留作兜底）。
	// 连接由 App.tsx 持有并广播 → 这里只订阅广播，不再自开 EventSource（避免多连接/多票据）。
	// 本页在 ServerOnly 门禁内，登录态恒真；非审批类通知被过滤，不触发任何请求。
	useApprovalNotificationRefresh(true, () => void silentRefresh());

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
