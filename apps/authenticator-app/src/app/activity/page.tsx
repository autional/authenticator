import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ShieldCheck, ShieldX, Clock, AlertCircle, CalendarX } from 'lucide-react';
import { LoadingScreen, ErrorState } from '@autional/ui';
import { GeneratedTypes, toPageParams, fromPageResult } from '@autional/shared';
import { getPushHistory } from '@/lib/api';
import BottomNav from '@/components/BottomNav';
import { toSlugged, useTenantSlug } from '../../lib/slug';

const PAGE_SIZE = 50;

const STATUS_MAP: Record<string, { labelKey: string }> = {
	approved: { labelKey: 'activity.approved' },
	denied: { labelKey: 'activity.denied' },
	pending: { labelKey: 'activity.pending' },
	expired: { labelKey: 'activity.expired' },
};

const FILTER_TABS = [
	{ key: 'all', labelKey: 'activity.all' },
	{ key: 'approved', labelKey: 'activity.approved' },
	{ key: 'denied', labelKey: 'activity.denied' },
	{ key: 'pending', labelKey: 'activity.pending' },
	{ key: 'expired', labelKey: 'activity.expired' },
];

export default function ActivityPage() {
	const navigate = useNavigate();
	const slug = useTenantSlug();
	const { t, i18n } = useTranslation();
	const [items, setItems] = useState<GeneratedTypes.PushHistoryItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState<string>('all');
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);

	// AU-23/24：tab 驱动服务端 status 过滤（all=不过滤）；分页/形状走 shared 单点
	const fetchPage = useCallback(
		async (targetPage: number, status: string, mode: 'replace' | 'append') => {
			try {
				const res = await getPushHistory({
					...(status === 'all' ? {} : { status }),
					...toPageParams({ page: targetPage, pageSize: PAGE_SIZE }),
				});
				const result = fromPageResult<GeneratedTypes.PushHistoryItem>(res);
				setItems((prev) => {
					if (mode === 'replace') return result.items;
					const seen = new Set(prev.map((i) => i.challengeId));
					return [...prev, ...result.items.filter((i) => !seen.has(i.challengeId))];
				});
				setTotal(result.total);
				setPage(targetPage);
			} catch (err) {
				// 追加失败保留已加载列表（按钮仍在，可重试）；替换失败进错误态
				if (mode === 'replace') setError(t('activity.loadFailed'));
				console.error(err);
			}
		},
		[t],
	);

	useEffect(() => {
		// 切 tab 重置回第 1 页并以新 status 重取
		setLoading(true);
		setError(null);
		fetchPage(1, filter, 'replace').finally(() => setLoading(false));
	}, [filter, fetchPage]);

	const hasMore = page * PAGE_SIZE < total;

	const handleLoadMore = async () => {
		if (loadingMore || !hasMore) return;
		setLoadingMore(true);
		try {
			await fetchPage(page + 1, filter, 'append');
		} finally {
			setLoadingMore(false);
		}
	};

	const getStatusIcon = (status?: string) => {
		switch (status) {
			case 'approved':
				return <ShieldCheck className="h-5 w-5 text-[var(--color-success-text)]" />;
			case 'denied':
				return <ShieldX className="h-5 w-5 text-[var(--color-danger-text)]" />;
			case 'pending':
				return <Clock className="h-5 w-5 text-[var(--color-warning-text)]" />;
			case 'expired':
				return <CalendarX className="h-5 w-5 text-[var(--color-text-muted)]" />;
			default:
				return <AlertCircle className="h-5 w-5 text-[var(--color-text-secondary)]" />;
		}
	};

	const getStatusLabel = (status?: string) => {
		return t(STATUS_MAP[status ?? '']?.labelKey ?? status ?? '');
	};

	const formatTime = (iso?: string) => {
		if (!iso) return '';
		try {
			const d = new Date(iso);
			return d.toLocaleString(i18n.language, {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			});
		} catch {
			return iso;
		}
	};

	return (
		<div className="flex h-full flex-col">
			<header className="sticky top-0 z-10 flex items-center gap-3 border-b border-auth-border bg-auth-bg/80 h-[var(--layout-header-height)] px-4 backdrop-blur-md">
				<button
					onClick={() => navigate(toSlugged('/settings', slug))}
					className="rounded-lg p-1.5 text-[var(--color-text-secondary)] hover:bg-auth-elevated hover:text-[var(--color-text-primary)] transition-colors"
					aria-label={t('common.back')}
				>
					<ArrowLeft className="h-5 w-5" />
				</button>
				<h1 className="text-lg font-bold text-[var(--color-text-primary)]">{t('activity.title')}</h1>
			</header>

			{/* Filter Tabs */}
			<div className="flex gap-1.5 overflow-x-auto border-b border-auth-border px-4 py-2 scrollbar-hide">
				{FILTER_TABS.map((f) => (
					<button
						key={f.key}
						onClick={() => setFilter(f.key)}
						className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
							filter === f.key
								? 'bg-primary-600 text-white'
								: 'bg-auth-elevated text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
						}`}
					>
						{t(f.labelKey)}
					</button>
				))}
			</div>

			<div className="flex-1 px-4 py-4">
				{loading ? (
					<LoadingScreen />
				) : error ? (
					<ErrorState description={error} />
				) : items.length === 0 ? (
					<div className="py-12 text-center text-sm text-[var(--color-text-secondary)]">{t('activity.empty')}</div>
				) : (
					<div className="space-y-2">
						{items.map((item) => (
							<div
								key={item.challengeId}
								className="flex items-start gap-3 rounded-xl border border-auth-border bg-auth-surface p-3"
							>
								<div className="mt-0.5">{getStatusIcon(item.status)}</div>
								<div className="min-w-0 flex-1">
									<div className="flex items-center justify-between">
										<span className="text-sm font-medium text-[var(--color-text-primary)]">
											{getStatusLabel(item.status)}
										</span>
										<span className="text-[11px] text-[var(--color-text-muted)]">
											{formatTime(item.createdAt)}
										</span>
									</div>
									{item.loginContext && (
										<p className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">{item.loginContext}</p>
									)}
								</div>
							</div>
						))}
						{items.length > 0 && (
							<div className="pt-2 text-center">
								{/* AU-24：页尾常显进度，防静默截断自证 */}
								<p className="text-[11px] text-[var(--color-text-muted)]">
									{t('common.listProgress', { shown: items.length, total })}
								</p>
								{hasMore ? (
									<button
										onClick={handleLoadMore}
										disabled={loadingMore}
										className="mt-2 w-full rounded-lg border border-auth-border bg-auth-surface py-2 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-auth-elevated hover:text-[var(--color-text-primary)] disabled:opacity-50"
									>
										{loadingMore ? t('common.loadingMore') : t('common.loadMore')}
									</button>
								) : (
									<p className="mt-2 text-[11px] text-[var(--color-text-muted)]">{t('common.noMore')}</p>
								)}
							</div>
						)}
					</div>
				)}
			</div>

			<BottomNav />
		</div>
	);
}
