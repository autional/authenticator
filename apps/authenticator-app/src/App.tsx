import { lazy, Suspense } from 'react';
import { Routes, Route, Outlet, useParams, Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { toSlugged, useTenantSlug } from './lib/slug';
import {
	RequireAuth,
	OAuthCallbackPage,
	TenantSlugProvider,
	TenantIndexGuard,
	TenantRootRedirect,
	useBranding,
	BrandingInitializer,
} from '@autional/shared';
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
	return (
		<TenantSlugProvider value={tenantSlug}>
			{/* AU-30：已认证未知 slug 全子路由禁渲染真实页（未认证面仍由 RequireAuth 闸门负责） */}
			<TenantSlugGate notFound={<NotFoundRoute />}>
				<Outlet />
			</TenantSlugGate>
		</TenantSlugProvider>
	);
}

export default function App() {
	const { t } = useTranslation();
	useBranding();

	return (
		<ToastProvider>
			<ErrorBoundary>
				<BrandingInitializer />
				<UnlockGate>
					<a
						href="#main-content"
						className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[200] focus:rounded-xl focus:bg-primary-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:no-underline"
					>
						{t('common.skipToContent')}
					</a>
					<PwaInstallPrompt />
					<div className="mx-auto flex h-screen max-w-md flex-col bg-auth-bg">
						<main id="main-content" className="flex-1 overflow-y-auto pb-28">
							<Routes>
								<Route path="/oauth/callback" element={<OAuthCallbackPage />} />

								{/* 裸根漏斗：有会话直达 /<slug>，否则整页跳 brand 选品牌 */}
								<Route path="/" element={<TenantRootRedirect />} />

								<Route
									path="/:tenantSlug"
									element={
										/* notFound：确定性未知 slug（by-slug 404）原地渲染 404，不发弹跳（F-W6） */
										<RequireAuth notFound={<NotFoundRoute />}>
											<LayoutWrapper />
										</RequireAuth>
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
					<TenantIndexGuard notFound={<NotFoundRoute />}>
						<HomePage />
					</TenantIndexGuard>
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
					<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
						<PushApprovePage />
					</Suspense>
				}
			/>
			<Route
				path="activity"
				element={
					<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
						<ActivityPage />
					</Suspense>
				}
			/>
			<Route
				path="devices"
				element={
					<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
						<DevicesPage />
					</Suspense>
				}
			/>
			<Route
				path="cloud-backup"
				element={
					<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
						<CloudBackupPage />
					</Suspense>
				}
			/>
			<Route
				path="device-sync"
				element={
					<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
						<DeviceSyncPage />
					</Suspense>
				}
			/>
			<Route
				path="login-approve"
				element={
					<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
						<LoginApprovePage />
					</Suspense>
				}
			/>
			<Route
				path="notifications"
				element={
					<Suspense fallback={<LoadingScreen message={t('common.loading')} />}>
						<NotificationsPage />
					</Suspense>
				}
			/>
			{/* 旧路径（AuthMS 遗留 /xxx/api/v1/xxx 形态）重定向，勿删：书签与推送深链可能指向它们。
			    首段名单需同步 non-tenant-segments.ts（ui 仓 scripts/check-non-tenant.mjs 有闸门比对）。 */}
			<Route path="notification/api/v1/push-approve" element={<LegacyRedirect to="/push-approve" />} />
			<Route path="notification/api/v1/notifications" element={<LegacyRedirect to="/notifications" />} />

			<Route path="*" element={<NotFoundRoute />} />
		</>
	);
}
