'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@autional/ui';
import { GeneratedApi, GeneratedTypes, extractApiError, extractItem } from '@autional/shared';

// Autional QR login approval page（AU-27/28 W2：七态状态机 + 零信任预校验）
// Entry: /login-approve?token=xxx&nm=123456
// Or deep-linked from push notification
//
// 状态机：checking → pending | scanned | approved | denied | invalid | error
// - mount 先真预校验（authQrLoginStatus），不再出现「未经校验的假待批准」；
// - 提交面仅在 pending/scanned 渲染；空/无效 token 机械性不可达 POST（入口硬闸 + 渲染闸双保险）；
// - 重试 = 真重试（重走 precheck）；invalid 为终态仅「返回首页」。

type ApproveState =
	| { status: 'checking' }
	| { status: 'pending'; numberMatching?: string }
	| { status: 'scanned'; numberMatching?: string }
	| { status: 'approved' }
	| { status: 'denied' }
	| { status: 'invalid'; message: string }
	| { status: 'error'; message: string };

export default function LoginApprovePage() {
	const [searchParams] = useSearchParams();
	const { t } = useTranslation();
	const token = searchParams.get('token') || '';
	const numberMatching = searchParams.get('nm') || '';
	const [state, setState] = useState<ApproveState>({ status: 'checking' });
	const [busy, setBusy] = useState(false);

	/** 预校验（mount + 重试共用）：真请求读服务端真实状态；空 token 直接落 invalid（零 POST）。 */
	const precheck = useCallback(async () => {
		if (!token) {
			setState({ status: 'invalid', message: t('loginApprove.missingParams') });
			return;
		}
		setState({ status: 'checking' });
		try {
			const data = extractItem(
				await GeneratedApi.authQrLoginStatus({ token }),
			) as GeneratedTypes.QrLoginStatusResponse | null;
			const nm = data?.numberMatching || numberMatching || undefined;
			switch (data?.status) {
				case 'pending':
					setState({ status: 'pending', numberMatching: nm });
					break;
				case 'scanned':
					setState({ status: 'scanned', numberMatching: nm });
					break;
				case 'confirmed':
					setState({ status: 'approved' });
					break;
				case 'cancelled':
					setState({ status: 'invalid', message: t('loginApprove.cancelledDesc') });
					break;
				case 'expired':
					setState({ status: 'invalid', message: t('loginApprove.expiredDesc') });
					break;
				default:
					setState({ status: 'error', message: t('loginApprove.operationFailed') });
			}
		} catch (err: unknown) {
			const { code, message } = extractApiError(err, t('loginApprove.operationFailed'));
			const http = (err as { response?: { status?: number } })?.response?.status;
			if (String(code) === '61000901') {
				// 404 not found
				setState({ status: 'invalid', message: t('loginApprove.notFoundDesc') });
			} else if (String(code) === '61000902') {
				// 410 expired
				setState({ status: 'invalid', message: t('loginApprove.expiredDesc') });
			} else if (http === 429) {
				setState({ status: 'error', message: t('loginApprove.rateLimited') });
			} else {
				setState({ status: 'error', message: message || t('loginApprove.operationFailed') });
			}
		}
	}, [token, numberMatching, t]);

	useEffect(() => {
		void precheck();
	}, [precheck]);

	const handleApprove = async () => {
		// 硬闸：空 token / 非合法态不可达提交（AU-27 结案证据）
		if (!token || !(state.status === 'pending' || state.status === 'scanned')) return;
		setBusy(true);
		try {
			// Option A（2026-10-04 拍板）：pending 深链批准 = Scan → Confirm 顺序自足链
			if (state.status === 'pending') {
				await GeneratedApi.authQrLoginScanPost({ token });
			}
			await GeneratedApi.authQrLoginConfirmPost({ token });
			setState({ status: 'approved' });
		} catch (err: unknown) {
			const { code, message } = extractApiError(err, t('loginApprove.approveFailed'));
			if (String(code) === '61000903') {
				// 已被处理/并发 → 以服务端真实状态收敛（非假态）
				await precheck();
			} else {
				setState({ status: 'error', message });
			}
		} finally {
			setBusy(false);
		}
	};

	const handleDeny = async () => {
		if (!token || !(state.status === 'pending' || state.status === 'scanned')) return;
		setBusy(true);
		try {
			await GeneratedApi.authQrLoginCancelPost({ token });
			setState({ status: 'denied' });
		} catch (err: unknown) {
			const { code, message } = extractApiError(err, t('loginApprove.operationFailed'));
			if (String(code) === '61000903') {
				await precheck();
			} else {
				setState({ status: 'error', message });
			}
		} finally {
			setBusy(false);
		}
	};

	if (state.status === 'checking') {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center gap-3">
				<div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
				<p className="text-sm text-[var(--color-text-muted)]">{t('loginApprove.checking')}</p>
			</div>
		);
	}

	if (state.status === 'invalid') {
		return (
			<div className="flex min-h-screen items-center justify-center px-4">
				<div className="w-full max-w-sm space-y-4 text-center">
					<div className="text-red-500 text-lg">!</div>
					<p className="text-sm text-[var(--color-text-muted)]">{state.message}</p>
					{/* 终态：无物可重试，仅返回首页出路 */}
					<Link
						to="/"
						className="inline-flex h-10 w-full items-center justify-center rounded-md border border-[var(--color-border-subtle)] bg-transparent px-4 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-muted)]"
					>
						{t('notFound.backHome')}
					</Link>
				</div>
			</div>
		);
	}

	if (state.status === 'error') {
		return (
			<div className="flex min-h-screen items-center justify-center px-4">
				<div className="w-full max-w-sm space-y-4 text-center">
					<div className="text-red-500 text-lg">!</div>
					<p className="text-sm text-[var(--color-text-muted)]">{state.message}</p>
					<div className="flex flex-col gap-3">
						{/* 真重试：重走 precheck 真请求（替换旧假转态） */}
						<Button variant="primary" fullWidth onClick={() => void precheck()}>
							{t('common.retry')}
						</Button>
						<Link
							to="/"
							className="inline-flex h-10 w-full items-center justify-center rounded-md border border-[var(--color-border-subtle)] bg-transparent px-4 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-muted)]"
						>
							{t('notFound.backHome')}
						</Link>
					</div>
				</div>
			</div>
		);
	}

	if (state.status === 'approved') {
		return (
			<div className="flex min-h-screen items-center justify-center px-4">
				<div className="w-full max-w-sm space-y-4 text-center">
					<div className="rounded-full bg-green-100 w-16 h-16 flex items-center justify-center mx-auto">
						<span className="text-2xl text-green-600"></span>
					</div>
					<h1 className="text-xl font-bold">{t('loginApprove.approvedTitle')}</h1>
					<p className="text-sm text-[var(--color-text-muted)]">{t('loginApprove.approvedDesc')}</p>
				</div>
			</div>
		);
	}

	if (state.status === 'denied') {
		return (
			<div className="flex min-h-screen items-center justify-center px-4">
				<div className="w-full max-w-sm space-y-4 text-center">
					<div className="rounded-full bg-red-100 w-16 h-16 flex items-center justify-center mx-auto">
						<span className="text-2xl text-red-600"></span>
					</div>
					<h1 className="text-xl font-bold">{t('loginApprove.deniedTitle')}</h1>
					<p className="text-sm text-[var(--color-text-muted)]">{t('loginApprove.deniedDesc')}</p>
				</div>
			</div>
		);
	}

	// pending / scanned：仅合法态渲染提交面
	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-sm space-y-6">
				<div className="text-center">
					<h1 className="text-xl font-bold">{t('loginApprove.requestTitle')}</h1>
					<p className="mt-2 text-sm text-[var(--color-text-muted)]">{t('loginApprove.requestDesc')}</p>
				</div>

				{state.numberMatching && (
					<div className="rounded-lg border border-blue-200 bg-blue-50 p-6 text-center">
						<p className="text-xs text-[var(--color-text-muted)] mb-2">{t('loginApprove.confirmNumber')}</p>
						<span className="text-3xl font-bold tracking-widest text-blue-700">
							{state.numberMatching}
						</span>
						<p className="mt-2 text-xs text-blue-600">{t('loginApprove.numberHint')}</p>
					</div>
				)}

				<div className="flex gap-3">
					<Button variant="danger" fullWidth onClick={handleDeny} disabled={busy}>
						{t('loginApprove.deny')}
					</Button>
					<Button variant="primary" fullWidth onClick={handleApprove} disabled={busy}>
						{t('loginApprove.approve')}
					</Button>
				</div>
			</div>
		</div>
	);
}
