import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

let deferredPrompt: Event | null = null;

export default function PwaInstallPrompt() {
	const [show, setShow] = useState(false);
	const { t } = useTranslation();

	useEffect(() => {
		const handler = (e: Event) => {
			e.preventDefault();
			deferredPrompt = e;
			// Show prompt only if not already installed (standalone)
			if (window.matchMedia('(display-mode: standalone)').matches) return;
			// Don't show if user dismissed before
			if (localStorage.getItem('autional-pwa-dismissed') === '1') return;
			setShow(true);
		};

		window.addEventListener('beforeinstallprompt', handler);
		return () => window.removeEventListener('beforeinstallprompt', handler);
	}, []);

	const handleInstall = async () => {
		if (!deferredPrompt) return;
		// beforeinstallprompt 事件是浏览器非标准事件，Event 类型无 prompt/userChoice
		// @ts-expect-error 非标准 PWA 事件方法
		deferredPrompt.prompt();
		// @ts-expect-error 非标准 PWA 事件方法
		const { outcome } = await deferredPrompt.userChoice;
		if (outcome === 'accepted') {
			setShow(false);
		}
		deferredPrompt = null;
	};

	const handleDismiss = () => {
		setShow(false);
		localStorage.setItem('autional-pwa-dismissed', '1');
	};

	if (!show) return null;

	return (
		<div className="fixed bottom-[calc(var(--layout-bottom-nav-height)+var(--space-2))] left-4 right-4 z-50 mx-auto max-w-sm">
			<div className="flex items-center gap-3 rounded-xl bg-primary-600 px-4 py-3 shadow-card">
				<Download className="h-5 w-5 shrink-0 text-white" />
				<div className="flex-1">
					<p className="text-sm font-medium text-white">{t('pwa.installToDesktop')}</p>
					<p className="text-xs text-primary-100">{t('pwa.installDesc')}</p>
				</div>
				<button
					onClick={handleInstall}
					className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-primary-600 hover:bg-primary-50 transition-colors"
				>
					{t('pwa.install')}
				</button>
				<button
					onClick={handleDismiss}
					className="rounded-xs p-1 text-primary-200 hover:bg-primary-500 hover:text-white transition-colors"
					aria-label={t('pwa.dismissAria')}
				>
					<X className="h-4 w-4" />
				</button>
			</div>
		</div>
	);
}
