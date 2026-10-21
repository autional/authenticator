import i18n from './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ThemeProvider } from '@autional/ui';
import { isRetryableError } from '@autional/shared';
import App from './App';
import './non-tenant-segments';
import './app/globals.css';
import { initializeStorage } from './lib/storage';
import { setupPwaLifecycle } from './lib/pwa-lifecycle';
import ErrorBoundary from './components/ErrorBoundary';

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// 重试策略唯一实现：只重试「重试可能改变结果」的错误（@autional/shared/utils/query-state
			// 的 isRetryableError：无状态码 / 5xx / 408 / 429）；4xx（含 404/401/403）一律不重试。
			retry: (failureCount, error) => isRetryableError(error) && failureCount < 1,
			refetchOnWindowFocus: false,
		},
	},
});

async function bootstrap() {
	try {
		// 检查 crypto.subtle 是否可用（需要 HTTPS 或 localhost）
		if (typeof crypto === 'undefined' || !crypto.subtle) {
			throw new Error(
				i18n.t('bootstrap.httpsRequired') +
					i18n.t('bootstrap.cryptoUnsupported') +
					'\n\n' +
					i18n.t('bootstrap.useHttps'),
			);
		}
		await initializeStorage();
	} catch (err) {
		const rootEl = document.getElementById('root');
		if (rootEl) {
			rootEl.innerHTML =
				'<div style="display:flex;align-items:center;justify-content:center;height:100vh;padding:2rem;text-align:center;font-family:system-ui;color:#fff;background:#0a0a0a"><div><h1 style="font-size:1.25rem;margin-bottom:0.5rem">' +
				i18n.t('bootstrap.storageInitFailed') +
				'</h1><p style="font-size:0.875rem;color:#999">' +
				String(err instanceof Error ? err.message : err) +
				'</p></div></div>';
		}
		return;
	}

	const root = document.getElementById('root');
	if (root) {
		createRoot(root).render(
			<StrictMode>
				<QueryClientProvider client={queryClient}>
					<BrowserRouter basename="/">
						<ThemeProvider
							storageKey="authenticator-app-theme"
							darkThemeName="authenticator"
							defaultTheme="dark"
						>
							<ErrorBoundary>
								<App />
							</ErrorBoundary>
						</ThemeProvider>
					</BrowserRouter>
				</QueryClientProvider>
			</StrictMode>,
		);
	}
}

setupPwaLifecycle();
bootstrap();
