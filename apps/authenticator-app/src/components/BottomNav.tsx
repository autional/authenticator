import { Home, PlusCircle, Settings, Bell, ShieldCheck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { useAuth } from '@autional/shared';
import { GeneratedApi } from '@autional/shared';
import { toSlugged, useTenantSlug } from '../lib/slug';
import { listPendingApprovals } from '../lib/login-approval';

const navItemKeys = [
	'nav.accounts',
	'nav.notifications',
	'nav.approvals',
	'nav.add',
	'nav.settings',
] as const;
const navItemIcons = [Home, Bell, ShieldCheck, PlusCircle, Settings] as const;

export default function BottomNav() {
	const { t } = useTranslation();
	const location = useLocation();
	const navigate = useNavigate();
	const slug = useTenantSlug();
	const [unreadCount, setUnreadCount] = useState(0);
	const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
	const { user, isAuthenticated } = useAuth();
	const userId = user?.id;

	useEffect(() => {
		if (!userId) return;
		const fetchUnread = () => {
			// 运行时响应键 = unreadCount（拦截器解包 + camelCase；shared 生成物字段陈旧）
			GeneratedApi.notificationsUnreadCount()
				.then((res: { unreadCount?: number }) => {
					setUnreadCount(res?.unreadCount ?? 0);
				})
				.catch(() => {});
		};
		fetchUnread();
		const interval = setInterval(fetchUnread, 60000);
		return () => clearInterval(interval);
	}, [userId]);

	useEffect(() => {
		// 待审批计数同款：登录后才请求（未登录必 401），60s 轮询；失败静默不打断导航
		if (!isAuthenticated) return;
		let alive = true;
		const fetchPending = () => {
			listPendingApprovals()
				.then((items) => {
					if (alive) setPendingApprovalCount(items.length);
				})
				.catch(() => {});
		};
		fetchPending();
		const interval = setInterval(fetchPending, 60000);
		return () => {
			alive = false;
			clearInterval(interval);
		};
	}, [isAuthenticated]);

	// 本地模式（未登录）隐藏通知/待审批：两者都是服务端数据，未登录必 401
	const navItems: Array<{
		path: string;
		key: (typeof navItemKeys)[number];
		icon: (typeof navItemIcons)[number];
		badge?: number;
	}> = [
		{ path: '/', key: navItemKeys[0], icon: navItemIcons[0] },
		...(isAuthenticated
			? [
					{ path: '/notifications', key: navItemKeys[1], icon: navItemIcons[1], badge: unreadCount },
					{
						path: '/approvals',
						key: navItemKeys[2],
						icon: navItemIcons[2],
						badge: pendingApprovalCount,
					},
				]
			: []),
		{ path: '/add', key: navItemKeys[3], icon: navItemIcons[3] },
		{ path: '/settings', key: navItemKeys[4], icon: navItemIcons[4] },
	];

	return (
		<nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-auth-border bg-auth-surface/90 backdrop-blur-md">
			<div className="mx-auto flex max-w-md items-center justify-around py-2">
				{navItems.map((item) => {
					// basename 恒 / 后 pathname 含 slug（如 /acme-corp/settings）→ 与带 slug 目标路径比较；
					// 尾斜杠归一：toSlugged('/', slug) = /{slug}/，实际 pathname 可能为 /{slug}（React Router index 归一）
					const target = toSlugged(item.path, slug);
					const isActive =
						location.pathname === target ||
						location.pathname.replace(/\/$/, '') === target.replace(/\/$/, '');
					const Icon = item.icon;
					return (
						<button
							key={item.path}
							onClick={() => navigate(target)}
							aria-current={isActive ? 'page' : undefined}
							className={`relative flex flex-col items-center gap-0.5 rounded-lg px-6 py-1 transition-all duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
								isActive ? 'text-primary-500 dark:text-primary-400' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
							}`}
						>
							{/* 激活态用「非色彩信号」：加粗描边 + 标签加粗（灰度/色觉障碍下同样可辨） */}
							<Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
							{item.badge != null && item.badge > 0 && (
								<span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger-soft px-1 text-[9px] font-bold text-[var(--color-danger-text)]">
									{item.badge > 99 ? '99+' : item.badge}
								</span>
							)}
							<span className={`text-[10px] ${isActive ? 'font-semibold' : 'font-medium'}`}>{t(item.key)}</span>
						</button>
					);
				})}
			</div>
			<div className="h-[env(safe-area-inset-bottom)]" />
		</nav>
	);
}
