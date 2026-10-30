import { Link } from 'react-router';
import { FileQuestion } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * NotFoundPage — 404（TASK-428，ADR-4；AU-29 W2）
 *
 * 贴合 authenticator 设计（mobile-first，纯 Tailwind + CSS 变量，无 antd）。
 * 返回首页固定走裸根漏斗（App.tsx TenantRootRedirect）：有会话 → 按公开租户名单
 * 解析真 slug 跳 /<slug>/；无会话 → brand。锚点恒 `/`，带无效 slug 的路径不再自指。
 */
export default function NotFoundPage() {
	const { t } = useTranslation();
	return (
		<div className="flex min-h-full flex-col items-center justify-center px-4 text-center">
			<div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-500/10">
				<FileQuestion size={40} className="text-primary-500" />
			</div>
			<h1 className="mt-6 text-4xl font-bold text-[var(--color-text-primary)]">404</h1>
			<p className="mt-2 text-base text-[var(--color-text-secondary)]">{t('notFound.title')}</p>
			<p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('notFound.desc')}</p>
			<Link
				to="/"
				className="mt-8 rounded-xl bg-primary-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-500"
			>
				{t('notFound.backHome')}
			</Link>
		</div>
	);
}
