import type { LoginScanResult } from '@/components/QrScanner';

export interface LoginChallengeStatus {
	status: string;
	number_matching?: string;
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
}

export function parseAutionalLoginUri(url: string): LoginScanResult | null {
	try {
		// 新版 scheme = autional://；authms:// 为旧版深链，保留兼容（已安装应用/旧二维码仍可能使用）
		const normalized = url.startsWith('autional://')
			? url.replace('autional://', 'https://')
			: url.startsWith('authms://')
				? url.replace('authms://', 'https://')
				: url;
		const parsed = new URL(normalized);
		const token = parsed.searchParams.get('token') || parsed.searchParams.get('session_token');
		if (!token) return null;
		return { token, numberMatching: parsed.searchParams.get('nm') || undefined };
	} catch {
		return null;
	}
}

export { LoginScanResult };
