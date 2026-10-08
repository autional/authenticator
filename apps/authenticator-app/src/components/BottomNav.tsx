import { Home, PlusCircle, Settings, Bell } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { useAuth } from '@autional/shared';
import { GeneratedApi } from '@autional/shared';
import { toSlugged, useTenantSlug } from '../lib/slug';

const navItemKeys = ['nav.accounts', 'nav.notifications', 'nav.add', 'nav.settings'] as const;
const navItemIcons = [Home, Bell, PlusCircle, Settings] as const;

export default function BottomNav() {
	const { t } = useTranslation();
	const location = useLocation();
	const navigate = useNavigate();
	const slug = useTenantSlug();
	const [unreadCount, setUnreadCount] = useState(0);
	const { user } = useAuth();
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

	const navItems = [
		{ path: '/', key: navItemKeys[0], icon: navItemIcons[0] },
		{
			path: '/notifications',
			key: navItemKeys[1],
			icon: navItemIcons[1],
			badge: unreadCount,
		},
		{ path: '/add', key: navItemKeys[2], icon: navItemIcons[2] },
		{ path: '/settings', key: navItemKeys[3], icon: navItemIcons[3] },
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
							className={`relative flex flex-col items-center gap-0.5 rounded-lg px-6 py-1 transition-colors ${
								isActive ? 'text-primary-500 dark:text-primary-400' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
							}`}
						>
							<Icon className="h-5 w-5" strokeWidth={2} />
							{item.badge != null && item.badge > 0 && (
								<span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger-soft px-1 text-[9px] font-bold text-[var(--color-danger-text)]">
									{item.badge > 99 ? '99+' : item.badge}
								</span>
							)}
							<span className="text-[10px] font-medium">{t(item.key)}</span>
						</button>
					);
				})}
			</div>
			<div className="h-[env(safe-area-inset-bottom)]" />
		</nav>
	);
}
