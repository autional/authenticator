import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { Routes, Route, Outlet, useParams, Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { toSlugged, useTenantSlug } from './lib/slug';
import {
	RequireAuth,
	OAuthCallbackPage,
	TenantSlugProvider,
	TenantIndexGuard,
	TenantRootRedirect,
	useAuth,
	useBranding,
	BrandingInitializer,
} from '@autional/shared';
import { LOCAL_MODE_SLUG, useIsLocalMode } from './lib/slug';
import ErrorBoundary from './components/ErrorBoundary';
import TenantSlugGate from './components/TenantSlugGate';
import UnlockGate from './components/UnlockScreen';
import { ToastProvider, LoadingScreen } from '@autional/ui';
import PwaInstallPrompt from './components/PwaInstallPrompt';

import HomePage from './app/page';

const AddAccountPage = lazy(() => import('./app/add/page'));
const SettingsPage = lazy(() => import('./app/settings/page'));
const AccountDetailPage = lazy(() => import('./app/account/page'));
const PushApprovePage = lazy(() => import('./app/push-approve/page'));
const ActivityPage = lazy(() => import('./app/activity/page'));
const DevicesPage = lazy(() => import('./app/devices/page'));
const CloudBackupPage = lazy(() => import('./app/cloud-backup/page'));
const DeviceSyncPage = lazy(() => import('./app/device-sync/page'));
const LoginApprovePage = lazy(() => import('./app/login-approve/page'));
const NotificationsPage = lazy(() => import('./app/notifications/page'));
const NotFoundPage = lazy(() => import('./app/not-found/page'));

/** 404 页渲染（lazy 需 Suspense 边界；404 模块极小，fallback null 无闪烁） */
function NotFoundRoute() {
	return (
		<Suspense fallback={null}>
			<NotFoundPage />
		</Suspense>
	);
}

/** 旧路径客户端重定向：按 tenantSlug 组装新绝对路径，保留 query/hash，replace 历史记录。 */
function LegacyRedirect({ to }: { to: string }) {
	const slug = useTenantSlug();
	const { search, hash } = useLocation();
	return <Navigate to={`${toSlugged(to, slug)}${search}${hash}`} replace />;
}

function LayoutWrapper() {
	const { tenantSlug } = useParams();
	const { isAuthenticated } = useAuth();
	const local = tenantSlug === LOCAL_MODE_SLUG;
	// 已登录用户在 /local：回根漏斗（会进租户首页），避免与租户路由并存造成困惑
	if (local && isAuthenticated) return <Navigate to="/" replace />;
	return (
		<TenantSlugProvider value={tenantSlug}>
			{/* 本地模式无租户可校验：跳过公开租户名单闸门（保险库本就与租户无关） */}
			{local ? (
				<Outlet />
			) : (
				/* AU-30：已认证未知 slug 全子路由禁渲染真实页（未认证面仍由 RequireAuth 闸门负责） */
				<TenantSlugGate notFound={<NotFoundRoute />}>
					<Outlet />
				</TenantSlugGate>
			)}
		</TenantSlugProvider>
	);
}

/** 本地模式（/local）免登录；其余租户段仍强制 RequireAuth。 */
function VaultGate({ children }: { children: ReactNode }) {
	const { tenantSlug } = useParams();
	if (tenantSlug === LOCAL_MODE_SLUG) return <>{children}</>;
	return <RequireAuth notFound={<NotFoundRoute />}>{children}</RequireAuth>;
}

/** 裸根：未登录直接落本地保险库；已登录沿用共享租户漏斗。 */
function RootRedirect() {
	const { isAuthenticated } = useAuth();
	if (!isAuthenticated) return <Navigate to={`/${LOCAL_MODE_SLUG}/`} replace />;
	return <TenantRootRedirect />;
}

/** 仅服务端页面（通知/活动/设备/云备份/设备同步/审批）：本地模式回首页。 */
function ServerOnly({ children }: { children: ReactNode }) {
	const { isAuthenticated } = useAuth();
	if (!isAuthenticated) return <Navigate to={`/${LOCAL_MODE_SLUG}/`} replace />;
	return <>{children}</>;
}

/** 首页租户索引闸门：本地模式跳过（没有可校验的公开租户）。 */
function IndexGuard({ children }: { children: ReactNode }) {
	const local = useIsLocalMode();
	if (local) return <>{children}</>;
	return <TenantIndexGuard notFound={<NotFoundRoute />}>{children}</TenantIndexGuard>;
}

/** 品牌初始化：本地模式（/local）没有租户可查，显式传空 slug 关掉公开租户请求。 */
function BrandingGate() {
	const { pathname } = useLocation();
	const local = pathname.split('/').filter(Boolean)[0] === LOCAL_MODE_SLUG;
	return <BrandingInitializer slug={local ? '' : undefined} />;
}

export default function App() {
	const { t } = useTranslation();
	useBranding();

	return (
		<ToastProvider>
			<ErrorBoundary>
				<BrandingGate />
				<UnlockGate>
					<a
						href="#main-content"
						className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[200] focus:rounded-xl focus:bg-primary-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:no-underline"
					>
						{t('common.skipToContent')}
					</a>
					<PwaInstallPrompt />
					<div className="mx-auto flex h-screen max-w-md flex-col bg-auth-bg">
						{/* 底部让位：值 = 底栏高度令牌 + 一段常规间距（112px = 64 + 48）。
						    原先写的是一个魔法数字 pb-28 —— 而它本来就是两个令牌的和，只是没写出来。
						    写成算式之后：值逐字相同（零视觉变化），但从此可算、可调、可查；
						    底栏高度改一次，这里跟着改，不会再有人去数像素。 */}
						<main
							id="main-content"
							className="flex-1 overflow-y-auto pb-[calc(var(--layout-bottom-nav-height)+var(--space-12))]"
						>
							<Routes>
								<Route path="/oauth/callback" element={<OAuthCallbackPage />} />

								{/* 裸根漏斗：有会话直达 /<slug>，否则落本地保险库 /local */}
								<Route path="/" element={<RootRedirect />} />

								<Route
									path="/:tenantSlug"
									element={
										<VaultGate>
											<LayoutWrapper />
										</VaultGate>
									}
								>
									{appRoutes(t)}
								</Route>

								<Route path="*" element={<NotFoundRoute />} />
							</Routes>
						</main>
					</div>
				</UnlockGate>
			</ErrorBoundary>
		</ToastProvider>
	);
}

function appRoutes(t: (key: string) => string) {
	return (
		<>
			<Route
				index
				element={
					<IndexGuard>
						<HomePage />
					</IndexGuard>
				}
			/>
			<Route
				path="add"
				element={
					<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
						<AddAccountPage />
					</Suspense>
				}
			/>
			<Route
				path="settings"
				element={
					<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
						<SettingsPage />
					</Suspense>
				}
			/>
			<Route
				path="account"
				element={
					<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
						<AccountDetailPage />
					</Suspense>
				}
			/>
			<Route
				path="push-approve"
				element={
					<ServerOnly>
						<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
							<PushApprovePage />
						</Suspense>
					</ServerOnly>
				}
			/>
			<Route
				path="activity"
				element={
					<ServerOnly>
						<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
							<ActivityPage />
						</Suspense>
					</ServerOnly>
				}
			/>
			<Route
				path="devices"
				element={
					<ServerOnly>
						<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
							<DevicesPage />
						</Suspense>
					</ServerOnly>
				}
			/>
			<Route
				path="cloud-backup"
				element={
					<ServerOnly>
						<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
							<CloudBackupPage />
						</Suspense>
					</ServerOnly>
				}
			/>
			<Route
				path="device-sync"
				element={
					<ServerOnly>
						<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
							<DeviceSyncPage />
						</Suspense>
					</ServerOnly>
				}
			/>
			<Route
				path="login-approve"
				element={
					<ServerOnly>
						<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
							<LoginApprovePage />
						</Suspense>
					</ServerOnly>
				}
			/>
			<Route
				path="notifications"
				element={
					<ServerOnly>
						<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
							<NotificationsPage />
						</Suspense>
					</ServerOnly>
				}
			/>
			{/* 旧路径（旧版遗留 /xxx/api/v1/xxx 形态）重定向，勿删：书签与推送深链可能指向它们。
			    首段名单需同步 non-tenant-segments.ts（ui 仓 scripts/check-non-tenant.mjs 有闸门比对）。 */}
			<Route path="notification/api/v1/push-approve" element={<LegacyRedirect to="/push-approve" />} />
			<Route path="notification/api/v1/notifications" element={<LegacyRedirect to="/notifications" />} />

			<Route path="*" element={<NotFoundRoute />} />
		</>
	);
}
