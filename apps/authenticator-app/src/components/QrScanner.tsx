import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Html5Qrcode } from 'html5-qrcode';
import {
	isOtpauthMigrationUri,
	parseOtpauthMigration,
	type MigratedAccount,
} from '@/lib/otpauth-migration';
import { parseAutionalLoginUri } from '@/lib/login-approve';

interface ScanResult {
	secret: string;
	name: string;
	username: string;
	algorithm: 'SHA1' | 'SHA256' | 'SHA512';
	digits: number;
	period: number;
}

export interface LoginScanResult {
	token: string;
	numberMatching?: string;
}

interface QrScannerProps {
	onScan: (result: ScanResult) => void;
	onMigration?: (accounts: MigratedAccount[]) => void;
	onScanLogin?: (result: LoginScanResult) => void;
	onError?: (error: string) => void;
	/** 降级出路：一键切手动输入（无摄像头/拒权/引擎 hang 时展示） */
	onManualFallback?: () => void;
}

/** 摄像头启动超时护栏（ms）：引擎 hang 时 ≤ 此时间退出 spinner 进入诚实错误态。audit 观察 5s+ 永转；8s 防慢机型误杀。 */
export const SCANNER_START_TIMEOUT_MS = 8000;

/**
 * 解码失败提示节流（ms）：扫描回调按 fps 逐帧触发，对着非 MFA 二维码时会 10 次/秒刷 toast。
 * 同一文案在此窗口内只提示一次；不同文案（如迁移码解析失败）仍立即提示。
 */
export const QR_ERROR_THROTTLE_MS = 2500;

/** 错误 → 本地化文案映射（兜底终止英文/技术文案外泄）。 */
function mapCameraError(err: unknown, t: TFunction): string {
	const msg = err instanceof Error ? err.message : String(err);
	if (msg === 'scanner-start-timeout') return t('qr.cameraTimeout');
	if (/permission|notallowed|denied/i.test(msg)) return t('qr.cameraPermissionDenied');
	if (/notfound|no camera|not found/i.test(msg)) return t('qr.noCamera');
	return t('qr.cameraFailed');
}

/**
 * 让摄像头画面在正方形容器里「铺满」（等价 object-fit: cover），同时保持解码正确。
 *
 * 为什么不用 CSS `object-fit`：html5-qrcode 的 `scanContext()` 用
 * `videoWidth / video.clientWidth` 与 `videoHeight / video.clientHeight` 两个独立比例
 * 把取景区域画到解码 canvas。若用 CSS 把 <video> 盒子强行改成方形，两个比例不再相等，
 * 整帧会被各向异性压扁（QR 变形 → 识别率下降）。
 *
 * 所以这里只对「渲染层」做 `scale()`：布局盒仍是宽 100% + 高度随画面比例，
 * clientWidth/clientHeight 不变 → 解码比例不变；绘制结果被放大后由容器裁切 = cover。
 * 返回清理函数（卸载或重开摄像头时解绑监听）。
 */
function fitPreviewToContainer(container: HTMLElement): () => void {
	const video = container.querySelector('video');
	if (!(video instanceof HTMLVideoElement)) return () => {};

	const apply = () => {
		const vw = video.clientWidth;
		const vh = video.clientHeight;
		if (!vw || !vh) return;
		// 单轴等比放大即可覆盖容器（取两轴所需比例的最大值）。
		const scale = Math.max(container.clientWidth / vw, container.clientHeight / vh);
		video.style.transformOrigin = 'center center';
		video.style.transform = scale > 1.01 ? `scale(${scale})` : '';
	};

	apply();
	// 摄像头分辨率/朝向变化会触发 video 的 resize；容器尺寸变化（窗口/旋屏）用 ResizeObserver。
	video.addEventListener('resize', apply);
	const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
	observer?.observe(container);

	return () => {
		video.removeEventListener('resize', apply);
		observer?.disconnect();
	};
}

export default function QrScanner({ onScan, onMigration, onScanLogin, onError, onManualFallback }: QrScannerProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const scannerRef = useRef<Html5Qrcode | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [hasCamera, setHasCamera] = useState(true);
	const { t } = useTranslation();

	// 回调经 ref 保存最新引用：摄像头 scanner.start 是重操作，effect 只启动一次，
	// 避免父组件每次渲染新建回调导致 scanner 反复 stop/start（循环重启摄像头）。
	const callbacksRef = useRef({ onScan, onMigration, onScanLogin, onError, t });
	useEffect(() => {
		callbacksRef.current = { onScan, onMigration, onScanLogin, onError, t };
	});

	useEffect(() => {
		let cancelled = false;
		let disposeFit: (() => void) | undefined;

		async function stopScanner() {
			if (scannerRef.current) {
				try {
					await scannerRef.current.stop();
				} catch {
					// ignore
				}
				scannerRef.current = null;
			}
		}

		async function startScanner() {
			try {
				const { Html5Qrcode } = await import('html5-qrcode');
				if (cancelled || !containerRef.current) return;

				const scannerId = 'qr-scanner-region';
				// Create inner div for scanner
				const scannerDiv = document.createElement('div');
				scannerDiv.id = scannerId;
				scannerDiv.style.width = '100%';
				scannerDiv.style.height = '100%';
				scannerDiv.style.borderRadius = '12px';
				scannerDiv.style.overflow = 'hidden';
				// 库只给 <video> 设 width（高度随摄像头画面比例），默认贴左上角。
				// 用 flex 居中，画面比容器矮/高时都能上下居中（外层 overflow 负责裁切）。
				scannerDiv.style.display = 'flex';
				scannerDiv.style.alignItems = 'center';
				scannerDiv.style.justifyContent = 'center';
				containerRef.current.innerHTML = '';
				containerRef.current.appendChild(scannerDiv);

				const scanner = new Html5Qrcode(scannerId);
				scannerRef.current = scanner;

				// 解码失败按帧回调：同一文案节流，避免对着非 MFA 二维码时 toast 刷屏。
				let lastError: { msg: string; at: number } = { msg: '', at: 0 };
				const emitDecodeError = (msg: string) => {
					const now = Date.now();
					if (msg === lastError.msg && now - lastError.at < QR_ERROR_THROTTLE_MS) return;
					lastError = { msg, at: now };
					callbacksRef.current.onError?.(msg);
				};

				// AU-04：超时竞速 —— scanner.start 是重操作，无摄像头/引擎 hang 时可能永不 settle，
				// 竞速 reject（'scanner-start-timeout'）落回 catch 走诚实错误态 + 手动输入出路。
				await Promise.race([
					scanner.start(
						{ facingMode: 'environment' },
						{
							fps: 10,
							// 不传 qrbox：库的遮罩按「视频高」算厚度、却铺满「正方形容器」，
							// 可见窗口会变成 200×(W−h+200)（桌面竖长 / 手机横扁），且与解码区不一致。
							// 改为全画面解码，取景框由本组件自绘（只作引导，不限制解码范围）。
						},
						(decodedText: string) => {
							const cb = callbacksRef.current;
							if (isOtpauthMigrationUri(decodedText)) {
								const accounts = parseOtpauthMigration(decodedText);
								if (accounts.length > 0) {
									cb.onMigration?.(accounts);
									void stopScanner();
								} else {
									emitDecodeError(cb.t('qr.migrationParseError'));
								}
								return;
							}
							const parsed = parseOtpAuthUrl(decodedText);
							if (parsed) {
								cb.onScan(parsed);
								void stopScanner();
								return;
							}
							const loginChallenge = parseAutionalLoginUri(decodedText);
							if (loginChallenge) {
								cb.onScanLogin?.(loginChallenge);
								void stopScanner();
								return;
							}
							emitDecodeError(cb.t('qr.unrecognized'));
						},
						() => {
							// QR scan error (no QR in frame) — ignore
						},
					),
					new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error('scanner-start-timeout')),
							SCANNER_START_TIMEOUT_MS,
						),
					),
				]);

				if (!cancelled) {
					setIsLoading(false);
					// 视觉上铺满方形容器（cover）：只缩放绘制层，不改 <video> 布局盒。
					// 布局盒保持画面比例 → 库的 widthRatio/heightRatio 一致 → 解码 canvas 不被拉斜。
					disposeFit = fitPreviewToContainer(scannerDiv);
				}
			} catch (err) {
				if (!cancelled) {
					// 先停底层（防超时后晚到的初始化把摄像头留在运行态），再置诚实错误态
					void stopScanner();
					setError(mapCameraError(err, callbacksRef.current.t));
					setHasCamera(false);
					setIsLoading(false);
				}
			}
		}

		startScanner();

		return () => {
			cancelled = true;
			disposeFit?.();
			void stopScanner();
		};
	}, []);

	if (error || !hasCamera) {
		return (
			<div className="flex flex-col items-center justify-center rounded-xl bg-auth-surface border border-auth-border py-10 text-center">
				<Camera className="mb-3 h-10 w-10 text-[var(--color-text-muted)]" />
				<p className="mb-1 text-sm font-medium text-[var(--color-text-secondary)]">{t('qr.noCamera')}</p>
				<p className="max-w-[240px] text-xs text-[var(--color-text-muted)]">{error}</p>
				{onManualFallback && (
					<button
						type="button"
						onClick={onManualFallback}
						className="mt-4 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-500"
					>
						{t('qr.manualFallback')}
					</button>
				)}
			</div>
		);
	}

	return (
		<div className="relative aspect-square w-full overflow-hidden rounded-xl border border-auth-border bg-black">
			<div ref={containerRef} className="h-full w-full" />
			{isLoading && (
				<div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
					<div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
				</div>
			)}
			{/*
			 * Scan overlay：只作视觉引导，解码范围是整幅画面（与 Bitwarden / Ente / 2FAuth 一致）。
			 * 框外用超大 box-shadow 压暗（随圆角挖孔），比四块遮罩 DOM 少且不会错位。
			 */}
			<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
				<div
					data-testid="qr-frame"
					className="relative aspect-square w-[64%] max-w-[280px] rounded-2xl ring-1 ring-white/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
				>
					<div className="absolute left-0 top-0 h-7 w-7 rounded-tl-lg border-l-2 border-t-2 border-white/90" />
					<div className="absolute right-0 top-0 h-7 w-7 rounded-tr-lg border-r-2 border-t-2 border-white/90" />
					<div className="absolute bottom-0 left-0 h-7 w-7 rounded-bl-lg border-b-2 border-l-2 border-white/90" />
					<div className="absolute bottom-0 right-0 h-7 w-7 rounded-br-lg border-b-2 border-r-2 border-white/90" />
				</div>
			</div>
			<p className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/70">
				{t('qr.scanHint')}
			</p>
		</div>
	);
}

/**
 * Parse otpauth:// URL into account fields.
 * Format: otpauth://totp/{issuer}:{account}?secret=...&issuer=...&algorithm=...&digits=...&period=...
 */
function parseOtpAuthUrl(url: string): ScanResult | null {
	if (!url.startsWith('otpauth://')) return null;

	try {
		const parsed = new URL(url);
		const secret = parsed.searchParams.get('secret');
		if (!secret) return null;

		const path = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
		let issuer = parsed.searchParams.get('issuer') || '';
		let username = '';

		const colonIndex = path.indexOf(':');
		if (colonIndex > 0) {
			issuer = issuer || path.slice(0, colonIndex);
			username = path.slice(colonIndex + 1);
		} else {
			username = path;
		}

		const rawAlg = (parsed.searchParams.get('algorithm') || 'SHA1').toUpperCase();
		const algorithm = (rawAlg === 'SHA256' || rawAlg === 'SHA512' ? rawAlg : 'SHA1') as
			| 'SHA1'
			| 'SHA256'
			| 'SHA512';
		const digits = parseInt(parsed.searchParams.get('digits') || '6', 10);
		const period = parseInt(parsed.searchParams.get('period') || '30', 10);

		return {
			secret: secret.replace(/\s/g, '').toUpperCase(),
			name: issuer || 'Unknown',
			username: username || 'Unknown',
			algorithm,
			digits,
			period,
		};
	} catch {
		return null;
	}
}
