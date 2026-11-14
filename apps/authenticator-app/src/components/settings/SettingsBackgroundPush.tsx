import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, BellOff } from 'lucide-react';
import {
	PushNotificationError,
	disablePush,
	enablePush,
	getPushState,
	isPushBlocked,
	type PushNotificationState,
} from '@/lib/push-notifications';

/**
 * 设置页「后台审批通知」开关（默认关闭，用户显式开启）。
 *
 * 分工（2026-11-13 产品决定）：
 *   - 前台提醒 = SSE，默认就有，这里不提供开关（没有可关的东西）；
 *   - 本开关只补「锁屏/切后台」这一段 —— 那里长连接被系统挂起，需要 Web Push。
 *
 * 交互约束：
 *   - 只在用户点开关时请求通知权限（进页面/挂载不请求，绝不自动弹权限框）；
 *   - 切换期间 loading 且禁用（防重复点击 → 防重复登记/重复解绑）；
 *   - 失败只报可读错误，**不改变开关状态**（不假装成功）；
 *   - 三种禁用态（不支持/iOS 未安装/权限被拒）开关置灰并解释原因，而不是让人点了没反应。
 */

function errorMessageKey(error: unknown): string {
	if (error instanceof PushNotificationError) {
		switch (error.code) {
			case 'permission-denied':
				return 'settings.pushPermissionDenied';
			case 'vapid-failed':
				return 'settings.pushVapidFailed';
			case 'subscribe-failed':
				return 'settings.pushSubscribeFailed';
			case 'register-failed':
				return 'settings.pushRegisterFailed';
			case 'register-forbidden':
				return 'settings.pushRegisterForbidden';
			case 'register-rejected':
				return 'settings.pushRegisterRejected';
			case 'register-offline':
				return 'settings.pushRegisterOffline';
			case 'unbind-failed':
				return 'settings.pushUnbindFailed';
			default:
				return 'settings.pushFailed';
		}
	}
	return 'settings.pushFailed';
}

/** 只有「令牌 scope 不足」这一种失败能靠重新登录修好（refresh 继承旧 scope）。 */
function needsRelogin(error: unknown): boolean {
	return error instanceof PushNotificationError && error.code === 'register-forbidden';
}

function hintMessageKey(state: PushNotificationState): string | null {
	if (state === 'unsupported') return 'settings.pushUnsupportedHint';
	if (state === 'ios-not-installed') return 'settings.pushIosHint';
	if (state === 'denied') return 'settings.pushDeniedHint';
	return null;
}

export default function SettingsBackgroundPush({ onRelogin }: { onRelogin?: () => void } = {}) {
	const { t } = useTranslation();
	const hintId = useId();
	const [state, setState] = useState<PushNotificationState | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [errorNeedsRelogin, setErrorNeedsRelogin] = useState(false);

	// 卸载后不再 setState（进页面时的状态探测是异步的）
	const aliveRef = useRef(true);

	useEffect(() => {
		aliveRef.current = true;
		getPushState()
			.then((next) => {
				if (aliveRef.current) setState(next);
			})
			.catch(() => {
				// 状态探测失败：按「未开启」显示（用户可再点一次开关重试），不报错打扰
				if (aliveRef.current) setState('unsubscribed');
			});
		return () => {
			aliveRef.current = false;
		};
	}, []);

	const blocked = state ? isPushBlocked(state) : false;
	const enabled = state === 'subscribed';
	const disabled = blocked || busy || state === null;

	const onToggle = useCallback(async () => {
		if (busy || state === null || isPushBlocked(state)) return;
		setBusy(true);
		setError('');
		setErrorNeedsRelogin(false);
		try {
			if (state === 'subscribed') {
				await disablePush();
				if (aliveRef.current) setState('unsubscribed');
			} else {
				await enablePush();
				if (aliveRef.current) setState('subscribed');
			}
		} catch (err) {
			// 失败保持原状态：开关不回弹成"成功"，也不假装已关闭
			if (aliveRef.current) {
				setError(t(errorMessageKey(err)));
				setErrorNeedsRelogin(needsRelogin(err));
			}
		} finally {
			if (aliveRef.current) setBusy(false);
		}
	}, [busy, state, t]);

	const hintKey = state ? hintMessageKey(state) : null;

	return (
		<section>
			<h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
				{t('settings.notificationsSection')}
			</h2>
			<div className="rounded-xl border border-auth-border bg-auth-surface">
				<div className="flex items-center justify-between gap-3 px-4 py-3">
					<div className="flex min-w-0 items-center gap-3">
						{enabled ? (
							<Bell className="h-4 w-4 shrink-0 text-primary-500 dark:text-primary-400" />
						) : (
							<BellOff className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
						)}
						<div className="min-w-0">
							<span className="text-sm text-[var(--color-text-primary)]">
								{t('settings.backgroundPush')}
							</span>
							<p className="text-xs text-[var(--color-text-muted)]">
								{t('settings.backgroundPushDesc')}
							</p>
						</div>
					</div>
					<button
						type="button"
						role="switch"
						aria-checked={enabled}
						aria-label={t('settings.backgroundPush')}
						aria-describedby={hintKey ? hintId : undefined}
						aria-busy={busy}
						disabled={disabled}
						onClick={() => void onToggle()}
						className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
							enabled ? 'bg-primary-600' : 'bg-auth-border'
						} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
					>
						<span
							className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-soft ring-0 transition duration-200 ease-in-out ${
								enabled ? 'translate-x-5' : 'translate-x-0'
							}`}
						/>
					</button>
				</div>

				{busy && (
					<p aria-live="polite" className="px-4 pb-3 text-xs text-[var(--color-text-secondary)]">
						{t('settings.pushProcessing')}
					</p>
				)}

				{hintKey && !busy && (
					<p id={hintId} className="px-4 pb-3 text-xs text-[var(--color-warning-text)]">
						{t(hintKey)}
					</p>
				)}

				{error && (
					<div
						role="alert"
						className="mx-4 mb-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger-text"
					>
						<p>{error}</p>
						{errorNeedsRelogin && onRelogin && (
							<button
								type="button"
								onClick={onRelogin}
								className="mt-2 rounded-lg border border-danger-text/40 px-3 py-1 text-xs font-medium text-danger-text transition-colors hover:bg-danger-text/10"
							>
								{t('settings.pushRelogin')}
							</button>
						)}
					</div>
				)}
			</div>
		</section>
	);
}
