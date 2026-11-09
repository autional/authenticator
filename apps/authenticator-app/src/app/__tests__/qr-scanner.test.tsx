import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

/**
 * AU-04 回归锁：QR 扫描降级出路 ——
 * hang ≤ SCANNER_START_TIMEOUT_MS 内退出 spinner；错误文案全本地化；CTA 一键手动输入。
 */
const mockStart = vi.fn();
const mockStop = vi.fn();
vi.mock('html5-qrcode', () => ({
	Html5Qrcode: class {
		start(...args: unknown[]) {
			return mockStart(...args);
		}
		stop() {
			return mockStop();
		}
	},
}));

import QrScanner, { SCANNER_START_TIMEOUT_MS, QR_ERROR_THROTTLE_MS } from '../../components/QrScanner';

async function flushAsync() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mockStop.mockResolvedValue(undefined);
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('QrScanner 降级出路 (AU-04)', () => {
	it('T1 start 永不 settle（hang）→ 超时后 spinner 消失、本地化超时文案、CTA 可见', async () => {
		mockStart.mockImplementation(() => new Promise(() => {}));
		render(<QrScanner onScan={vi.fn()} onManualFallback={vi.fn()} />);
		await flushAsync();

		expect(document.querySelector('.animate-spin')).not.toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(SCANNER_START_TIMEOUT_MS);
		});

		expect(document.querySelector('.animate-spin')).toBeNull();
		expect(screen.getByText('摄像头启动超时。可改用手动输入添加账户')).toBeInTheDocument();
		expect(screen.getByText('改用手动输入')).toBeInTheDocument();
	});

	it('T2 CTA 点击 → onManualFallback 被调（真实出路）', async () => {
		mockStart.mockImplementation(() => new Promise(() => {}));
		const onManualFallback = vi.fn();
		render(<QrScanner onScan={vi.fn()} onManualFallback={onManualFallback} />);
		await flushAsync();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(SCANNER_START_TIMEOUT_MS);
		});

		await act(async () => {
			fireEvent.click(screen.getByText('改用手动输入'));
		});
		expect(onManualFallback).toHaveBeenCalledTimes(1);
	});

	it('T3 start reject Permission denied → 本地化拒权文案，裸英文原文零渲染', async () => {
		mockStart.mockRejectedValue(new Error('Permission denied'));
		render(<QrScanner onScan={vi.fn()} />);
		await flushAsync();
		await flushAsync();

		expect(
			screen.getByText('摄像头权限被拒绝，请在浏览器设置中允许访问后重试'),
		).toBeInTheDocument();
		expect(document.body.textContent).not.toContain('Permission denied');
		// 未传 onManualFallback → 不渲染 CTA
		expect(screen.queryByText('改用手动输入')).toBeNull();
	});

	it('T4 start 正常 resolve → spinner 消失、无错误卡（回归保护）', async () => {
		mockStart.mockResolvedValue(undefined);
		render(<QrScanner onScan={vi.fn()} />);
		await flushAsync();
		await flushAsync();

		expect(document.querySelector('.animate-spin')).toBeNull();
		expect(screen.queryByText('无法访问摄像头')).toBeNull();
		expect(screen.queryByText('摄像头启动超时。可改用手动输入添加账户')).toBeNull();
	});
});

/**
 * 取景几何回归锁：
 * - 不给库传 qrbox（库遮罩按视频高算厚度却铺满正方形容器 → 白框变 200×(W−h+200)）。
 * - 只用 transform 缩放绘制层，不改 <video> 布局盒（否则解码 canvas 各向异性压扁 QR）。
 */
describe('QrScanner 取景几何', () => {
	it('T5 不传 qrbox，取景框由组件自绘且为正方形', async () => {
		mockStart.mockResolvedValue(undefined);
		render(<QrScanner onScan={vi.fn()} />);
		await flushAsync();
		await flushAsync();

		expect(mockStart).toHaveBeenCalledTimes(1);
		const [cameraConfig, scanConfig] = mockStart.mock.calls[0];
		expect(cameraConfig).toEqual({ facingMode: 'environment' });
		expect(scanConfig).not.toHaveProperty('qrbox');
		expect(screen.getByTestId('qr-frame')).toHaveClass('aspect-square');
	});

	it('T6 横向摄像头在方形容器里：只 scale 绘制层，布局盒宽高保持不动', async () => {
		mockStart.mockImplementation(async () => {
			const region = document.getElementById('qr-scanner-region') as HTMLDivElement;
			Object.defineProperty(region, 'clientWidth', { value: 400, configurable: true });
			Object.defineProperty(region, 'clientHeight', { value: 400, configurable: true });
			const video = document.createElement('video');
			// 400×300 = 横向画面；容器 400×400
			Object.defineProperty(video, 'clientWidth', { value: 400, configurable: true });
			Object.defineProperty(video, 'clientHeight', { value: 300, configurable: true });
			region.appendChild(video);
		});
		render(<QrScanner onScan={vi.fn()} />);
		await flushAsync();
		await flushAsync();

		const video = document.querySelector('video') as HTMLVideoElement;
		expect(video.style.width).toBe('');
		expect(video.style.height).toBe('');
		expect(video.style.transform).toMatch(/^scale\(1\.33/);
	});
});

/**
 * 解码失败节流：扫描回调按 fps 逐帧触发，对非 MFA 二维码曾 10 次/秒刷 toast。
 */
describe('QrScanner 解码失败节流', () => {
	it('T7 同一失败文案在节流窗口内只提示一次，窗口过后可再次提示', async () => {
		let decoded: ((text: string) => void) | undefined;
		mockStart.mockImplementation(async (_cam: unknown, _cfg: unknown, cb: (text: string) => void) => {
			decoded = cb;
		});
		const onError = vi.fn();
		render(<QrScanner onScan={vi.fn()} onError={onError} />);
		await flushAsync();
		await flushAsync();

		await act(async () => {
			for (let i = 0; i < 10; i++) decoded?.('https://example.com/not-a-totp');
		});
		expect(onError).toHaveBeenCalledTimes(1);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(QR_ERROR_THROTTLE_MS + 10);
			decoded?.('https://example.com/not-a-totp');
		});
		expect(onError).toHaveBeenCalledTimes(2);
	});
});
