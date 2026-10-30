import { lazy, Suspense, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Routes, Route, Outlet, useParams, Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { rememberTenantSlug, useSessionTenantSlug } from './lib/slug';
import { useSignIn } from './lib/use-sign-in';
import {
	OAuthCallbackPage,
	TenantSlugProvider,
	useAuth,
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

/** 旧路径客户端重定向：去租户后目标就是根路径，保留 query/hash。 */
function LegacyRedirect({ to }: { to: string }) {
	const { search, hash } = useLocation();
	return <Navigate to={`${to}${search}${hash}`} replace />;
}

/** 旧本地模式链接：/local/xxx → /xxx（一个发布周期兼容）。 */
function LocalRedirect() {
	const { pathname, search, hash } = useLocation();
	const next = pathname.replace(/^\/local(?=\/|$)/, '') || '/';
	return <Navigate to={`${next}${search}${hash}`} replace />;
}

/** 品牌：旧别名 slug 优先；否则用会话租户；都没有则空（默认品牌）。 */
function BrandingFor({ slug }: { slug: string }) {
	const sessionSlug = useSessionTenantSlug();
	useEffect(() => {
		if (sessionSlug) rememberTenantSlug(sessionSlug);
	}, [sessionSlug]);
	return <BrandingInitializer slug={slug || sessionSlug} />;
}

function LayoutWrapper() {
	const { tenantSlug } = useParams();
	const slug = tenantSlug ?? '';
	useEffect(() => {
		if (slug) rememberTenantSlug(slug);
	}, [slug]);
	return (
		<TenantSlugProvider value={slug}>
			<BrandingFor slug={slug} />
			{slug ? (
				<TenantSlugGate notFound={<NotFoundRoute />}>
					<Outlet />
				</TenantSlugGate>
			) : (
				<Outlet />
			)}
		</TenantSlugProvider>
	);
}

/** 服务端页面：未登录 → 应用内选择组织并登录（不再自动整页跳转）。 */
function ServerOnly({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const { isAuthenticated } = useAuth();
	const { signIn, dialog } = useSignIn();

	if (isAuthenticated) return <>{children}</>;

	return (
		<div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
			<p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('signIn.required')}</p>
			<button
				type="button"
				onClick={signIn}
				className="rounded-xl bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-primary-500 active:scale-[0.98]"
			>
				{t('signIn.action')}
			</button>
			{dialog}
		</div>
	);
}

export default function App() {
	const { t } = useTranslation();
	useBranding({ applyCustomCss: false });

	return (
		<ToastProvider>
			<ErrorBoundary>
				<UnlockGate>
					<a
						href="#main-content"
						className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[200] focus:rounded-xl focus:bg-primary-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:no-underline"
					>
						{t('common.skipToContent')}
					</a>
					<PwaInstallPrompt />
					<div className="mx-auto flex h-screen max-w-md flex-col bg-auth-bg pt-[env(safe-area-inset-top)]">
						{/* 底部让位：值 = 底栏高度令牌 + 一段常规间距（112px = 64 + 48）。
						    原先写的是一个魔法数字 pb-28 —— 而它本来就是两个令牌的和，只是没写出来。
						    写成算式之后：值逐字相同（零视觉变化），但从此可算、可调、可查；
						    底栏高度改一次，这里跟着改，不会再有人去数像素。 */}
						<main
							id="main-content"
							className="flex-1 overflow-y-auto overflow-x-hidden overscroll-x-none pb-[calc(var(--layout-bottom-nav-height)+var(--space-12))]"
						>
							<Routes>
								<Route path="/oauth/callback" element={<OAuthCallbackPage />} />

								{/* 旧 /local/*：一个发布周期内 302 到根路径（客户端重定向） */}
								<Route path="/local/*" element={<LocalRedirect />} />

								{/* 保险库在根路径：未登录也可用；服务端页各自 ServerOnly 门禁 */}
								<Route path="/" element={<LayoutWrapper />}>
									{appRoutes(t)}
								</Route>

								{/* 旧 /{slug}/* 链接兼容：同一路由树，slug 只用于品牌/登录上下文 */}
								<Route path="/:tenantSlug/*" element={<LayoutWrapper />}>
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
			<Route index element={<HomePage />} />
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
