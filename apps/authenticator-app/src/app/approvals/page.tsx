import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeft, RefreshCw, ShieldOff } from 'lucide-react';
import { showToast } from '@autional/ui';
import { extractApiError } from '@autional/shared';
import ApprovalCard from '../../components/ApprovalCard';
import BottomNav from '../../components/BottomNav';
import { denyByCode, listPendingApprovals, type PendingApproval } from '../../lib/login-approval';
import { useApprovalNotificationRefresh } from '../../lib/approval-notification';
import { useAdaptivePolling } from '../../lib/adaptive-polling';
import { toSlugged, useTenantSlug } from '../../lib/slug';

/**
 * MFA 疲劳阈值：同一窗口内攒到这么多待审批，就不再是「偶发登录」而是「有人在一遍遍试」。
 * 3 是经验值 —— 正常用户很少同时发起 3 次登录，但真的换了设备/重开浏览器时会短暂出现 2 条。
 */
export const MFA_FATIGUE_THRESHOLD = 3;

/**
 * 待审批的登录请求（App 侧）。
 *
 * 进入即拉一次 + 手动刷新 + **前台自动刷新**：登录门户「用 App 确认」发起后，请求会
 * 出现在这里 —— 用户对延迟的感受几乎全取决于这一页多久能看见新请求。
 *   - 自动刷新（自适应）：通知流已连通（SSE 即时推送）→ 60s 兜底；流不可用 → 15s；
 *   - 流刚连通、或页面回到前台 → 立即静默补拉一次（空窗期可能漏推送）；
 *   - 页面不可见时暂停（不空烧请求）；
 *   - 失败静默：不清空已有列表、不打断已渲染内容，手动刷新按钮始终可用。
 *   - SSE 即时刷新：审批类通知一到就静默刷新（见下），轮询只作兜底。
 * 过期项（服务端已判 TTL 到点）不展示 —— 留着只会让用户点一个注定失败的按钮。
 *
 * 防 MFA 疲劳（MFA fatigue / push bombing）：攻击者拿到密码后会连发登录请求，
 * 指望用户在某一次手滑点「是我」。因此：
 *   - 待审批 ≥ MFA_FATIGUE_THRESHOLD 时置顶警示条，提醒先确认是否本人；
 *   - 提供「全部拒绝」（二次确认，逐条 deny，失败不中断并汇总）—— 用户不必逐张卡片点。
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
	const [denyingAll, setDenyingAll] = useState(false);
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

	// 自适应刷新：流 open → 60s 兜底；非 open → 15s；流刚连通/回前台立即补一次；
	// 页面不可见则完全跳过（规则见 lib/adaptive-polling.ts）。
	const pollRefresh = useCallback(() => void silentRefresh(), [silentRefresh]);
	useAdaptivePolling({ enabled: true, tag: 'approvals', run: pollRefresh });

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

	/**
	 * 陈旧项（409 已被处理/替代、404 已失效）：不是系统故障，也不该留一张点了必失败的卡片。
	 * 移除该条 + 事实性提示 + 静默重拉（以服务端列表为准，避免竞态下显示错状态）。
	 */
	const handleStale = (code: string, failure: 'conflict' | 'not_found') => {
		removeItem(code);
		showToast(
			t(failure === 'conflict' ? 'approvals.conflictResolved' : 'approvals.notFoundDesc'),
			'warning',
		);
		void silentRefresh();
	};

	/**
	 * 全部拒绝：逐条 deny（**串行**，避免瞬间打出一串写请求），单条失败不中断。
	 * 结束后只移除已成功的那几条，并汇总提示 —— 失败项留在列表上，用户看得见也还能再点。
	 */
	const handleDenyAll = async (): Promise<void> => {
		if (denyingAll || items.length === 0) return;
		if (!confirm(t('approvals.denyAllConfirm'))) return;

		const targets = items.map((item) => item.code);
		setDenyingAll(true);
		const denied: string[] = [];
		for (const code of targets) {
			try {
				await denyByCode(code);
				denied.push(code);
			} catch {
				// 单条失败不中断：可能已过期或已被别处处理
			}
		}

		const deniedSet = new Set(denied);
		setItems((prev) => prev.filter((item) => !deniedSet.has(item.code)));
		const failed = targets.length - denied.length;

		if (failed === 0) {
			showToast(t('approvals.deniedAll', { count: denied.length }), 'success');
		} else if (denied.length > 0) {
			showToast(t('approvals.deniedAllPartial', { count: denied.length, failed }), 'warning');
		} else {
			showToast(t('approvals.denyFailed'), 'error');
		}
		setDenyingAll(false);
	};

	const showFatigueWarning = !loading && !error && items.length >= MFA_FATIGUE_THRESHOLD;

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

				{showFatigueWarning && (
					<div
						role="alert"
						data-testid="mfa-fatigue-warning"
						className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2.5 text-xs leading-5 text-[var(--color-warning-text)]"
					>
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
						<p>{t('approvals.fatigueWarning')}</p>
					</div>
				)}

				{!loading && !error && items.length > 0 && (
					<div className="flex justify-end">
						<button
							type="button"
							onClick={() => void handleDenyAll()}
							disabled={denyingAll}
							data-testid="deny-all"
							className="inline-flex items-center gap-1.5 rounded-md border border-danger-text px-3 py-1.5 text-xs font-medium text-danger-text transition-colors hover:bg-danger-soft disabled:opacity-50"
						>
							<ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
							{denyingAll ? t('approvals.denyAllBusy') : t('approvals.denyAll')}
						</button>
					</div>
				)}

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
							onStale={handleStale}
						/>
					))}
			</div>

			<BottomNav />
		</div>
	);
}
