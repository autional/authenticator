import type { ReactNode } from 'react';
import { Home, WifiOff, AlertCircle } from 'lucide-react';

/**
 * W6 对比度取景语料网格（replica）— w6-design §4.3-④
 *
 * 纪律：每个样本 = 生产「修复后」类串逐字 + grep 锚点头注；文本尺寸随类串逐字；
 * 数据/外壳允许占位（§4.3-③）。全页禁 backdrop-filter / background-image（否则 PROBE 判 skippedGradient）。
 * 外壳紧凑化（p-2 / mb-1 / space-y-2，仅占位壳层）——语料前置于取景首屏（main.tsx 取景纪律）。
 */

function Sample({ anchor, children }: { anchor: string; children: ReactNode }) {
	return (
		<div className="rounded-lg border border-auth-border bg-auth-surface p-2">
			<p className="mb-1 font-mono text-[11px] text-[var(--color-text-secondary)]">{anchor}</p>
			{children}
		</div>
	);
}

export default function Corpus() {
	return (
		<section className="space-y-2">
			<h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
				语料网格（grep 锚定 · 修复后类串逐字）
			</h2>

			{/* O-N1 · page.tsx:173 · 修复后类串：bg-primary-500/10 px-2 py-0.5 text-[10px] font-medium text-primary-600 dark:text-primary-400（修复前 text-primary-400：recon light 3.37 fail） */}
			<Sample anchor="O-N1 · src/app/page.tsx:173">
				<span className="shrink-0 whitespace-nowrap rounded-full bg-primary-500/10 px-2 py-0.5 text-[10px] font-medium text-primary-600 dark:text-primary-400">
					5
				</span>
			</Sample>

			{/* O-N2 · add/page.tsx:215 · 类串：flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-danger（sweep → text-[var(--color-danger-text)]） */}
			<Sample anchor="O-N2 danger · src/app/add/page.tsx:215">
				<div className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-[var(--color-danger-text)]">
					<AlertCircle className="h-4 w-4 shrink-0" />
					密钥格式不正确
				</div>
			</Sample>

			{/* O-N5 success · SettingsDataManage.tsx:51 · 类串：mt-2 text-xs text-success（sweep → text-[var(--color-success-text)]） */}
			<Sample anchor="O-N5 success · src/components/settings/SettingsDataManage.tsx:51">
				<p className="mt-2 text-xs text-[var(--color-success-text)]">导入成功</p>
			</Sample>

			{/* O-N5 warning · NetworkStatus.tsx:25 · 类串：flex items-center justify-center gap-1.5 bg-warning/10 px-3 py-1.5 text-xs text-warning */}
			<Sample anchor="O-N5 warning · src/components/NetworkStatus.tsx:25">
				<div className="flex items-center justify-center gap-1.5 bg-warning/10 px-3 py-1.5 text-xs text-[var(--color-warning-text)]">
					<WifiOff className="h-3.5 w-3.5" />
					<span>离线模式</span>
				</div>
			</Sample>

			{/* O-N5 info · notifications/page.tsx:47（TYPE_COLORS.email，生产为图标色无文本尺寸类）· 色类 text-info 逐字，尺寸归一为 text-xs 仅取可量文本样本 */}
			<Sample anchor="O-N5 info · src/app/notifications/page.tsx:47">
				<span className="text-xs text-[var(--color-info-text)]">系统通知</span>
			</Sample>

			{/* O-N4 徽标 · BottomNav.tsx:69 · 类串：absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger-soft px-1 text-[9px] font-bold text-[var(--color-danger-text)]（修复前 bg-danger text-white，3.27 fail） */}
			<Sample anchor="O-N4 徽标 · src/components/BottomNav.tsx:69">
				<span className="relative inline-flex h-10 w-8 items-center justify-center">
					<Home className="h-5 w-5 text-[var(--color-text-muted)]" />
					<span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger-soft px-1 text-[9px] font-bold text-[var(--color-danger-text)]">
						99+
					</span>
				</span>
			</Sample>

			{/* O-N4 通知 chip · notifications/page.tsx:222 · 类串：rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-medium text-[var(--color-danger-text)]（修复前 bg-danger-soft 底 read-键坏？原文 bg-danger text-white 3.27） */}
			<Sample anchor="O-N4 通知 chip · src/app/notifications/page.tsx:222">
				<span className="rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-medium text-[var(--color-danger-text)]">
					3
				</span>
			</Sample>

			{/* O-N4 破坏按钮 · account/page.tsx:339 · 类串：rounded-lg bg-danger-soft px-3 py-1.5 text-xs text-[var(--color-danger-text)]（修复前 bg-danger text-white） */}
			<Sample anchor="O-N4 破坏按钮 · src/app/account/page.tsx:339">
				<button className="rounded-lg bg-danger-soft px-3 py-1.5 text-xs text-[var(--color-danger-text)]">
					确认
				</button>
			</Sample>

			{/* O-N4 破坏按钮 · TotpCard.tsx:181 · 类串：rounded-lg bg-danger-soft px-4 py-1.5 text-xs font-medium text-[var(--color-danger-text)]（修复前 bg-danger text-white hover:bg-danger/80） */}
			<Sample anchor="O-N4 破坏按钮 · src/components/TotpCard.tsx:181">
				<button className="rounded-lg bg-danger-soft px-4 py-1.5 text-xs font-medium text-[var(--color-danger-text)]">
					删除
				</button>
			</Sample>

			{/* AU-32/C31 输入值回显 · add/page.tsx:240/257 · 类串逐字（text-[var(--color-text-primary)] + bg-auth-elevated） */}
			<Sample anchor="AU-32/C31 输入值 · src/app/add/page.tsx:240/257">
				<input
					type="text"
					readOnly
					value="Staging Vault"
					className="w-full rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-colors focus:border-primary-500"
				/>
			</Sample>

			{/* AU-32/C31 textarea 回显 · add/page.tsx:274 · 类串含 resize-none font-mono */}
			<Sample anchor="AU-32/C31 textarea · src/app/add/page.tsx:274">
				<textarea
					readOnly
					value="JBSWY3DPEHPK3PXP"
					rows={3}
					className="w-full resize-none rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2.5 text-sm font-mono text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-colors focus:border-primary-500"
				/>
			</Sample>

			{/* AU-32/C31 账户编辑输入 · account/page.tsx:178/190 · 类串逐字（无 focus:ring 变体） */}
			<Sample anchor="AU-32/C31 输入值 · src/app/account/page.tsx:178/190">
				<input
					type="text"
					readOnly
					value="demo@example.com"
					className="w-full rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-colors focus:border-primary-500"
				/>
			</Sample>

			{/* N8 · devices/page.tsx:110-113 · text-muted on elevated 如实渲染（marginal：闸门实测为准） */}
			<Sample anchor="N8 · src/app/devices/page.tsx:110-113（muted on elevated）">
				<div className="rounded-lg bg-auth-elevated p-3">
					<p className="text-xs text-[var(--color-text-muted)]">撤销后该设备将不再接收审批推送。</p>
				</div>
			</Sample>
		</section>
	);
}
