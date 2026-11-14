import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@autional/ui';
import { useLogout, useAuth, extractApiErrorMessage } from '@autional/shared';
import { useSignIn } from '@/lib/use-sign-in';
import { Info } from 'lucide-react';
import { showToast } from '@autional/ui';
import { useAuthenticatorStore, type TotpAccount } from '@/lib/store';
import BottomNav from '@/components/BottomNav';
import SettingsHeader from '@/components/settings/SettingsHeader';
import SettingsNetworkStatusCard from '@/components/settings/SettingsNetworkStatusCard';
import SettingsAppearance from '@/components/settings/SettingsAppearance';
import SettingsBackgroundPush from '@/components/settings/SettingsBackgroundPush';
import SettingsActivity from '@/components/settings/SettingsActivity';
import SettingsDevices from '@/components/settings/SettingsDevices';
import SettingsDataManage from '@/components/settings/SettingsDataManage';
import SettingsExportPasswordDialog from '@/components/settings/SettingsExportPasswordDialog';
import SettingsImportPasswordDialog from '@/components/settings/SettingsImportPasswordDialog';
import SettingsCloud from '@/components/settings/SettingsCloud';
import SettingsAccount from '@/components/settings/SettingsAccount';
import SettingsSecurityScore from '@/components/settings/SettingsSecurityScore';
import SettingsBiometric from '@/components/settings/SettingsBiometric';
import SettingsBackupCodes from '@/components/settings/SettingsBackupCodes';
import SettingsPinProtection from '@/components/settings/SettingsPinProtection';
import { lockVault } from '@/lib/app-lock';
import {
	registerBiometric,
	hasBiometricRegistered,
	clearBiometric,
	isBiometricAvailable,
	verifyBiometric,
} from '@/lib/webauthn';
import { generateBackupCodes, getBackupCodesCount } from '@/lib/api';
import { setPinProtection, setBiometricProtection, clearBiometricProtection } from '@/lib/storage';
import { clearSessionKeys } from '@/lib/session-keys';
import {
	derivePinKey,
	encryptWithKey,
	decryptWithKey,
	arrayBufferToBase64,
	base64ToArrayBuffer,
	PIN_KDF_ITERATIONS,
	LEGACY_PBKDF2_ITERATIONS,
	PIN_PATTERN,
} from '@/lib/crypto';
import { toSlugged, useTenantSlug } from '../../lib/slug';

export default function SettingsPage() {
	const { signIn, dialog } = useSignIn();
	const navigate = useNavigate();
	const slug = useTenantSlug();
	const { t } = useTranslation();
	const { theme, toggle: toggleTheme } = useTheme();
	const { accounts, importAccounts, hasPin, setHasPin } = useAuthenticatorStore();
	const handleLogout = useLogout();
	const onLogout = () => {
		clearSessionKeys();
		handleLogout();
	};
	const { isAuthenticated } = useAuth();

	const [pinInput, setPinInput] = useState('');
	const [pinSaving, setPinSaving] = useState(false);
	const [pinMessage, setPinMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
		null,
	);
	const [importError, setImportError] = useState<string | null>(null);
	const [importSuccess, setImportSuccess] = useState(false);
	const [showExportPassword, setShowExportPassword] = useState(false);
	const [exportPassword, setExportPassword] = useState('');
	const [importPassword, setImportPassword] = useState('');
	const [showImportPassword, setShowImportPassword] = useState<{
		file: File;
		encrypted: boolean;
	} | null>(null);


	const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
	const [backupCodesCount, setBackupCodesCount] = useState(0);
	const [backupCodesLoading, setBackupCodesLoading] = useState(false);
	const [backupCodesError, setBackupCodesError] = useState<string | null>(null);
	const [showBackupCodes, setShowBackupCodes] = useState(false);

	const [isOnline, setIsOnline] = useState(navigator.onLine);

	const [bioAvailable, setBioAvailable] = useState(false);
	const [bioRegistered, setBioRegistered] = useState(false);

	useEffect(() => {
		// 2026-11-10：不再探测/订阅第三方推送（FCM）；通知走应用内 SSE。
		if (isAuthenticated) {
			getBackupCodesCount()
				.then((res) => setBackupCodesCount(res?.count || 0))
				.catch(() => setBackupCodesCount(0));
		}

		isBiometricAvailable().then((avail) => {
			setBioAvailable(avail);
			if (avail) setBioRegistered(hasBiometricRegistered());
		});

		const onOnline = () => setIsOnline(true);
		const onOffline = () => setIsOnline(false);
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		return () => {
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
		};
	}, [isAuthenticated]);

	const handleExport = () => {
		setExportPassword('');
		setShowExportPassword(true);
	};

	const doExport = async (password: string | null) => {
		if (password) {
			try {
				const salt = crypto.getRandomValues(new Uint8Array(16));
				const key = await derivePinKey(password, salt, PIN_KDF_ITERATIONS);
				const innerData = {
					version: 2,
					exportedAt: Date.now(),
					accounts: accounts.map((a) => ({ ...a })),
				};
				const json = JSON.stringify(innerData);
				const { ciphertext, iv } = await encryptWithKey(json, key);
				const blob = new Blob(
					[
						JSON.stringify(
							{
								version: 2,
								encrypted: true,
								exportedAt: Date.now(),
								algorithm: 'PBKDF2-SHA256',
								iterations: PIN_KDF_ITERATIONS,
								salt: arrayBufferToBase64(salt),
								iv: arrayBufferToBase64(iv),
								ciphertext: arrayBufferToBase64(ciphertext),
								accounts: [],
							},
							null,
							2,
						),
					],
					{ type: 'application/json' },
				);
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `autional-authenticator-backup-${new Date().toISOString().slice(0, 10)}.json`;
				a.click();
				URL.revokeObjectURL(url);
				showToast(t('settings.exportSuccessEncrypted'), 'success');
			} catch {
				showToast(t('settings.exportFailed'), 'error');
			}
		} else {
			const data = {
				version: 2,
				encrypted: false,
				exportedAt: Date.now(),
				accounts: accounts.map((a) => ({ ...a })),
			};
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `autional-authenticator-backup-${new Date().toISOString().slice(0, 10)}.json`;
			a.click();
			URL.revokeObjectURL(url);
			showToast(t('settings.exportSuccessPlain'), 'success');
		}
		setShowExportPassword(false);
		setExportPassword('');
	};

	const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		setImportError(null);
		setImportSuccess(false);
		e.target.value = '';
		try {
			const text = await file.text();
			const data = JSON.parse(text);
			if (data.encrypted) {
				setShowImportPassword({
					file: new File([text], file.name, { type: 'application/json' }),
					encrypted: true,
				});
				return;
			}
			await processImportData(data);
		} catch (err) {
			setImportError(err instanceof Error ? err.message : t('settings.importFailed'));
		}
	};

	const handleImportWithPassword = async () => {
		if (!showImportPassword || !importPassword) return;
		try {
			const text = await showImportPassword.file.text();
			const data = JSON.parse(text);
			if (!data.encrypted || !data.salt || !data.iv || !data.ciphertext) {
				throw new Error(t('settings.importInvalidBackup'));
			}
			const salt = base64ToArrayBuffer(data.salt);
			const iv = base64ToArrayBuffer(data.iv);
			const ciphertext = base64ToArrayBuffer(data.ciphertext);
			// 迭代次数随文件保存；旧文件没有该字段 → 回落到旧标准
			const iterations =
				Number(data.iterations) > 0 ? Number(data.iterations) : LEGACY_PBKDF2_ITERATIONS;
			const key = await derivePinKey(importPassword, salt, iterations);
			const json = await decryptWithKey(ciphertext, iv, key);
			const inner = JSON.parse(json);
			await processImportData(inner);
		} catch (err) {
			setImportError(err instanceof Error ? err.message : t('settings.importWrongPassword'));
		} finally {
			setShowImportPassword(null);
			setImportPassword('');
		}
	};

	/** 导入文件 JSON 中单个账户的宽松形态（来自用户导出的备份文件，字段类型不可信） */
	interface ImportedAccount {
		id?: string;
		name?: string;
		username?: string;
		secret?: string;
		type?: string;
		algorithm?: string;
		digits?: number;
		period?: number;
		icon?: string;
		group?: string;
		order?: number;
		counter?: number;
		createdAt?: number;
	}

	async function processImportData(data: unknown) {
		const payload = data as { accounts?: unknown };
		if (!payload || !Array.isArray(payload.accounts)) {
			throw new Error(t('settings.importInvalidFormat'));
		}
		const validAccounts: TotpAccount[] = payload.accounts
			.filter((a): a is ImportedAccount => {
				if (typeof a !== 'object' || a === null) return false;
				const acc = a as ImportedAccount;
				return !!(acc.secret && acc.name && acc.username);
			})
			.map((a) => ({
				id: a.id || `imported_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
				name: String(a.name),
				username: String(a.username),
				secret: String(a.secret).replace(/\s/g, '').toUpperCase(),
				type: a.type === 'hotp' ? 'hotp' : 'totp',
				algorithm: a.algorithm === 'SHA256' || a.algorithm === 'SHA512' ? a.algorithm : 'SHA1',
				digits: Number(a.digits) || 6,
				period: Number(a.period) || 30,
				icon: a.icon,
				group: a.group,
				order: a.order,
				counter: a.counter,
				createdAt: a.createdAt || Date.now(),
			}));
		if (validAccounts.length === 0) throw new Error(t('settings.importNoValidAccounts'));
		importAccounts(validAccounts);
		setImportSuccess(true);
		setTimeout(() => setImportSuccess(false), 3000);
	}

	const handlePinSave = async (e?: React.FormEvent) => {
		e?.preventDefault();
		setPinMessage(null);

		if (pinInput.length === 0 && hasPin) {
			setPinSaving(true);
			try {
				await setPinProtection(null);
				setHasPin(false);
				setPinMessage({ type: 'success', text: t('settings.pinDisabled') });
			} catch {
				setPinMessage({ type: 'error', text: t('settings.pinFailed') });
			} finally {
				setPinSaving(false);
			}
			return;
		}

		if (!PIN_PATTERN.test(pinInput)) {
			setPinMessage({ type: 'error', text: t('settings.pinLengthError') });
			return;
		}

		setPinSaving(true);
		try {
			await setPinProtection(pinInput);
			setHasPin(true);
			setPinMessage({ type: 'success', text: t('settings.pinEnabled_confirm') });
			setPinInput('');
		} catch {
			setPinMessage({ type: 'error', text: t('settings.pinFailed') });
		} finally {
			setPinSaving(false);
		}
	};

	const handleBiometricToggle = async () => {
		// 生物识别叠加在 PIN 之上，不是替代：无 PIN 时开启等于没开（钥匙仍是明文）
		if (!bioRegistered && !hasPin) {
			showToast(t('settings.biometricNeedsPin'), 'error');
			return;
		}
		if (bioRegistered) {
			clearBiometric();
			clearBiometricProtection();
			setBioRegistered(false);
			showToast(t('settings.biometricCleared'), 'success');
		} else {
			const ok = await registerBiometric();
			if (!ok) {
				showToast(t('settings.biometricFailed'), 'error');
				return;
			}
			// 注册只创建凭据；解锁还需要把 deviceKey 用 PRF 密钥再包一层（否则解不开 PIN 包裹）。
			// 因此再走一次断言取得 PRF 密钥——用户会看到第二次生物识别提示。
			const prfKey = await verifyBiometric();
			if (!prfKey || prfKey.length === 0) {
				clearBiometric();
				setBioRegistered(false);
				showToast(t('settings.biometricFailed'), 'error');
				return;
			}
			try {
				await setBiometricProtection(prfKey);
				setBioRegistered(true);
				showToast(t('settings.biometricRegistered'), 'success');
			} catch {
				clearBiometric();
				setBioRegistered(false);
				showToast(t('settings.biometricFailed'), 'error');
			}
		}
	};

	const handleGenerateBackupCodes = async () => {
		setBackupCodesLoading(true);
		setBackupCodesError(null);
		try {
			// generateBackupCodes() 经 interceptor 解包，返回即 {codes}，不可再取 res.data
			const res = await generateBackupCodes();
			const codes = res?.codes || [];
			setBackupCodes(codes);
			setBackupCodesCount(codes.length);
			setShowBackupCodes(true);
		} catch (err: unknown) {
			// 备用码生成失败 → 写入备用码区块的错误状态（此前误写 pushError，显示在 Push MFA 区块）
			setBackupCodesError(extractApiErrorMessage(err, t('settings.backupCodesGenerateFailed')));
		} finally {
			setBackupCodesLoading(false);
		}
	};

	const handleCopyBackupCodes = async () => {
		if (!backupCodes) return;
		await navigator.clipboard.writeText(backupCodes.join('\n'));
		showToast(t('settings.backupCodesCopied'), 'success');
	};

	return (
		<div className="flex min-h-full flex-col">
			<SettingsHeader onBack={() => navigate(toSlugged('/', slug))} />

			<div className="flex-1 space-y-6 px-4 py-4">
				<SettingsSecurityScore
					accountsCount={accounts.length}
					inAppNotifications={isAuthenticated}
					hasPin={hasPin}
					hasBackupCodes={backupCodesCount > 0}
				/>

				<SettingsNetworkStatusCard isOnline={isOnline} />

				<SettingsAppearance theme={theme} onToggle={toggleTheme} />

				{/* 后台审批通知：SSE 已覆盖前台，这里只补「锁屏/切后台」；默认关闭，登录态才有意义
				    （订阅登记需要服务端账号；本地模式下开关会一直注册失败）。
				    403（令牌缺 write scope）时给「重新登录」入口：旧 refresh 继承旧 scope，只有重登能修。 */}
				{isAuthenticated && <SettingsBackgroundPush onRelogin={signIn} />}

				<section>
					<h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
						{t('settings.security')}
					</h2>
					<div className="rounded-xl border border-auth-border bg-auth-surface divide-y divide-auth-border">
						<SettingsBiometric
							bioAvailable={bioAvailable}
							bioRegistered={bioRegistered}
							onToggle={handleBiometricToggle}
						/>

						<SettingsPinProtection
							hasPin={hasPin}
							pinInput={pinInput}
							onPinChange={setPinInput}
							pinSaving={pinSaving}
							pinMessage={pinMessage}
							onSave={handlePinSave}
						/>

						{/* 手动锁定：立即清掉内存密钥与账户缓存，回首页需要重新验证 */}
						<div className="px-4 py-3">
							<button
								type="button"
								onClick={() => {
									lockVault('manual');
									navigate(toSlugged('/', slug));
								}}
								className="w-full rounded-lg border border-auth-border bg-auth-surface py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-auth-elevated"
							>
								{t('settings.lockNow')}
							</button>
						</div>

						{isAuthenticated && (
							<>
								<SettingsBackupCodes
									backupCodes={backupCodes}
									backupCodesCount={backupCodesCount}
									showBackupCodes={showBackupCodes}
									loading={backupCodesLoading}
									error={backupCodesError}
									onGenerate={handleGenerateBackupCodes}
									onCopy={handleCopyBackupCodes}
								/>

							</>
						)}
					</div>
				</section>

				{isAuthenticated && (
					<>
						<SettingsActivity />
						<SettingsDevices />
					</>
				)}

				<SettingsDataManage
					accountsCount={accounts.length}
					onExport={handleExport}
					onImportChange={handleImport}
					importError={importError}
					importSuccess={importSuccess}
				/>

				<SettingsExportPasswordDialog
					open={showExportPassword}
					value={exportPassword}
					onChange={setExportPassword}
					onExport={doExport}
					onCancel={() => {
						setShowExportPassword(false);
						setExportPassword('');
					}}
				/>

				<SettingsImportPasswordDialog
					open={!!showImportPassword}
					value={importPassword}
					onChange={setImportPassword}
					onDecrypt={handleImportWithPassword}
					onCancel={() => {
						setShowImportPassword(null);
						setImportPassword('');
					}}
				/>

				{isAuthenticated ? (
					<>
						<SettingsCloud />
						<SettingsAccount onLogout={onLogout} />
					</>
				) : (
					<>
					<section>
						<h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
							{t('settings.localModeTitle')}
						</h2>
						<div className="rounded-xl border border-auth-border bg-auth-surface p-4">
							<p className="text-sm text-[var(--color-text-secondary)]">{t('settings.localModeDesc')}</p>
							<button
								type="button"
								onClick={signIn}
								className="mt-3 w-full rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-500 active:scale-[0.98] transition-all"
							>
								{t('settings.localModeLogin')}
							</button>
						</div>
					</section>
					{dialog}
					</>
				)}

				<section>
					<h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
						{t('settings.about')}
					</h2>
					<div className="rounded-xl border border-auth-border bg-auth-surface">
						<div className="flex items-center gap-3 px-4 py-3">
							<Info className="h-4 w-4 text-[var(--color-text-secondary)]" />
							<div>
								<span className="text-sm text-[var(--color-text-primary)]">{t('settings.aboutVersion')}</span>
								<p className="text-[11px] text-[var(--color-text-muted)]">{t('settings.aboutDesc')}</p>
							</div>
						</div>
					</div>
				</section>
			</div>

			<BottomNav />
		</div>
	);
}
