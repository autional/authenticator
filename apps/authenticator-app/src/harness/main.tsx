import '../i18n';
import '../app/globals.css';
import './harness.css';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router';
import BottomNav from '../components/BottomNav';
import UnlockGate from '../components/UnlockScreen';
import NotFoundPage from '../app/not-found/page';
import Corpus from './corpus';

/**
 * W6 对比度取景框入口 — w6-design §4.3（对齐 user 门户 src/test/portal-chrome.tsx 先例）
 *
 * - 版式（取景纪律）：语料网格前置（首屏 = 语料主题面）；真组件帧下移；UnlockGate 收进
 *   h-96 overflow-hidden 裁剪框 + 挂载后 scroll 复位/失焦——PinInputScreen（UnlockScreen.tsx 的
 *   PIN 视图）为 h-screen 且进入 PIN 视图即聚焦输入框，不约束会劫持取景位（首跑实测：抓到的全是 PIN 屏）。
 * - 真组件 ×3：BottomNav（O-N3 激活态，MemoryRouter 挂 ':tenantSlug' 路由使 useTenantSlug 可满足）/
 *   NotFoundPage（404 面互证）/ UnlockGate（PIN 屏 AU-10；localStorage 播种 PIN 载荷使
 *   `!isUnlocked && hasPin` 分支渲染 PinInputScreen，优于 replica 降级——记录于 w6-verify）。
 * - 语料网格见 corpus.tsx（每样本 grep 锚点 + 修复后类串逐字）。
 * - 令牌经 index.html 的 CDN <link> 加载（复刻生产 index.html 机制）；直接 import tokens.css
 *   会被 Tailwind 的 @layer 处理链拒绝（normalizeTailwindDirectives 抛错，user 门户 Storybook
 *   preview.ts 已记录同一实测）——那正是生产把令牌放 CDN 的原因。
 * - 主题由 index.html 启动块按 ?theme=dark|light 复刻（dark-first）；本文件不重复设置。
 * - 对生产零干扰：生产 main.tsx 不 import 本目录。
 * - 备注：原计划 authenticator-notfound「真 dist 404」目标经路由实测撤除——/a/b 落
 *   /:tenantSlug/* → RequireAuth 未认证 null（App.tsx:87-96），顶层 * 被 /:tenantSlug/* 全域
 *   遮蔽（App.tsx:98），离线无任何 URL 可渲染真 dist NotFoundPage；实测与撤除裁定记录于
 *   w6-verify / w6-design §4.4 勘误。
 */

// 双保险：UnlockGate boot 依赖 deviceKeyWrap != null（index.html 启动块已播种）
try {
	if (!localStorage.getItem('autional-authenticator-v2')) {
		localStorage.setItem(
			'autional-authenticator-v2',
			JSON.stringify({
				version: 2,
				salt: 'seed',
				deviceKey: null,
				deviceKeyWrap: { iv: 'seed', ciphertext: 'seed' },
				data: { iv: 'seed', ciphertext: 'seed' },
			}),
		);
	}
} catch {
	/* 存储不可用：UnlockGate 将回落 children（取景退化，闸门侧可辨） */
}

function Harness() {
	useEffect(() => {
		// PinInputScreen autoFocus 会把视口滚到 PIN 屏；挂载后复位页顶（StrictMode 双跑无害）
		const resetScroll = () => {
			if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
			window.scrollTo(0, 0);
		};
		resetScroll();
		const t = window.setTimeout(resetScroll, 400);
		return () => window.clearTimeout(t);
	}, []);

	return (
		<MemoryRouter initialEntries={['/demo']}>
			<div className="min-h-screen bg-auth-bg text-[var(--color-text-primary)]">
				<div className="mx-auto max-w-3xl space-y-3 px-4 py-4">
					<header className="flex items-baseline justify-between gap-3">
						<h1 className="text-sm font-bold text-[var(--color-text-primary)]">
							authenticator contrast harness
						</h1>
						<p className="text-[10px] text-[var(--color-text-secondary)]">
							真组件 ×3 + 修复后语料（O-N1/N2/N4/N5 + AU-32/C31 + N8）· ?theme=dark|light
						</p>
					</header>

					<Corpus />

					<section className="space-y-2">
						<h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
							真组件 · BottomNav（O-N3 激活态）
						</h2>
						<div className="harness-frame h-24 rounded-xl border border-auth-border bg-auth-bg">
							<Routes>
								<Route path=":tenantSlug" element={<BottomNav />} />
							</Routes>
						</div>
						<p className="text-[11px] text-[var(--color-text-secondary)]">
							nav 为 fixed 定位（挂视口底）；backdrop-filter 已由 harness.css 中和（取景纪律①）
						</p>
					</section>

					<section className="space-y-2">
						<h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
							真组件 · NotFoundPage（404）
						</h2>
						<div className="h-96 overflow-hidden rounded-xl border border-auth-border bg-auth-bg">
							<NotFoundPage />
						</div>
					</section>

					<section className="space-y-2">
						<h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
							真组件 · UnlockGate（PIN 屏 · AU-10 · 裁剪框）
						</h2>
						<div className="h-96 overflow-hidden rounded-xl border border-auth-border bg-auth-bg">
							<UnlockGate>
								<div />
							</UnlockGate>
						</div>
					</section>
				</div>
			</div>
		</MemoryRouter>
	);
}

const rootEl = document.getElementById('root');
if (rootEl) {
	createRoot(rootEl).render(
		<StrictMode>
			<Harness />
		</StrictMode>,
	);
}
