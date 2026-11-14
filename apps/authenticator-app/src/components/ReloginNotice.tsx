import { useAuth } from '@autional/shared';
import { useTranslation } from 'react-i18next';
import { LogIn, X } from 'lucide-react';
import { useNeedsRelogin } from '../lib/relogin';
import { startSignIn, useSignIn } from '../lib/use-sign-in';
import { readLastTenantSlug } from '../lib/slug';

/**
 * 全局「需要重新登录」提示条（登录后任意页面可见）。
 *
 * 为什么需要它：`write` scope 只在登录时申请 —— 老会话的令牌缺 write，
 * `stream-ticket` 与 `push/subscriptions` 一律 403，而这两个都是**后台静默**能力：
 * 用户看不到任何失败，只觉得「推送不灵 / 审批不刷新」。把信号集中到一条可见的
 * banner，比在每个调用点各写一遍提示更直接，也不会出现两处文案分叉。
 *
 * 交互约束：
 * - 只解释「要做什么」（重新登录），**不**显示 403 / scope / 接口名等技术细节；
 * - 「重新登录」走与页面内相同的登录入口（同一回跳地址、同一 scope 集合）；
 * - 关闭 = 本次会话不再弹（信号清掉；用户可能只想先把手上的事做完）；
 * - 未登录（令牌已彻底失效/已登出）不渲染 —— 那时该由 ServerOnly 的登录门负责。
 */
export default function ReloginNotice() {
	const { t } = useTranslation();
	const { isAuthenticated } = useAuth();
	const { active, dismiss } = useNeedsRelogin();
	const { signIn, dialog } = useSignIn();

	if (!active || !isAuthenticated) return null;

	// 优先用最近一次登录的租户：banner 挂在路由树之外，取不到 `:tenantSlug`。
	// 实在没有（清过 localStorage）才弹选择组织弹窗 —— 与页面内登录行为一致。
	const relogin = () => {
		const slug = readLastTenantSlug();
		if (slug) startSignIn(slug);
		else signIn();
	};

	return (
		<div
			role="status"
			data-testid="relogin-notice"
			className="flex items-start gap-2 border-b border-auth-border bg-warning/10 px-4 py-2.5 text-[var(--color-warning-text)]"
		>
			<LogIn className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
			<p className="flex-1 text-xs leading-5">{t('relogin.message')}</p>
			<button
				type="button"
				onClick={relogin}
				className="shrink-0 rounded-md border border-current px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-warning/15"
			>
				{t('relogin.action')}
			</button>
			<button
				type="button"
				onClick={dismiss}
				aria-label={t('relogin.dismiss')}
				className="shrink-0 rounded-md p-1 transition-colors hover:bg-warning/15"
			>
				<X className="h-4 w-4" aria-hidden="true" />
			</button>
			{dialog}
		</div>
	);
}
