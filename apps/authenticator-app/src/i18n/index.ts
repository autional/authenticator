import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { FALLBACK_LANG, localeOf } from '@/lib/site-env';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

i18n
	.use(LanguageDetector)
	.use(initReactI18next)
	.init({
		resources: { 'zh-CN': { translation: zhCN }, 'en-US': { translation: enUS } },
		fallbackLng: localeOf(FALLBACK_LANG),
		supportedLngs: ['zh-CN', 'en-US'],
		keySeparator: false,
		returnNull: false,
		interpolation: { escapeValue: false },
		detection: {
			// navigator 探测关停：首访语言 = 区域默认（B3 单源双区契约，见 docs/positioning/24）；
			// localStorage 仅存用户手动切换结果。
			order: ['localStorage'],
			caches: ['localStorage'],
			lookupLocalStorage: 'authenticator-app-lang',
		},
	});

// 同步 <html lang> 与 document.title — 语言切换后更新（a11y/浏览器翻译/SEO）
const syncDocumentMeta = () => {
	if (typeof document !== 'undefined') {
		document.documentElement.lang = i18n.language || localeOf(FALLBACK_LANG);
		document.title = i18n.t('app.title');
	}
};
i18n.on('languageChanged', syncDocumentMeta);
// 初始化完成后立即同步一次（覆盖 index.html 硬编码的 lang/title）
if (i18n.isInitialized) {
	syncDocumentMeta();
} else {
	i18n.on('initialized', syncDocumentMeta);
}

export default i18n;
