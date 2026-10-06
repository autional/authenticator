import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
	ArrowLeft,
	Copy,
	Check,
	Trash2,
	Save,
	AlertCircle,
	Pin,
	PinOff,
	ChevronUp,
	ChevronDown,
	Eye,
	EyeOff,
} from 'lucide-react';
import { useAuthenticatorStore } from '@/lib/store';
import { generateTOTP } from '@/lib/totp';
import { showToast } from '@autional/ui';
import BrandIcon from '@/components/BrandIcon';
import CountdownRing from '@/components/CountdownRing';
import { toSlugged, useTenantSlug } from '../../lib/slug';
import { PRESET_GROUPS, groupLabel } from '@/lib/groups';

export default function AccountDetailPage() {
	const navigate = useNavigate();
	const slug = useTenantSlug();
	const { t } = useTranslation();
	const [searchParams] = useSearchParams();
	const accountId = searchParams.get('id') || '';

	const { accounts, updateAccount, removeAccount, toggleAccountPin, updateAccountOrder } =
		useAuthenticatorStore();
	const account = accounts.find((a) => a.id === accountId);

	const [name, setName] = useState('');
	const [username, setUsername] = useState('');
	const [group, setGroup] = useState('');
	const [customGroup, setCustomGroup] = useState('');
	const [totp, setTotp] = useState<{ code: string; progress: number } | null>(null);
	const [copied, setCopied] = useState(false);
	const [showDelete, setShowDelete] = useState(false);
	const [showSecret, setShowSecret] = useState(false);
	const [hasChanges, setHasChanges] = useState(false);

	useEffect(() => {
		if (account) {
			setName(account.name);
			setUsername(account.username);
			setGroup(account.group || '');
		}
	}, [account]);

	// Generate TOTP
	const refreshTotp = useCallback(async () => {
		if (!account) return;
		const result = await generateTOTP(
			account.secret,
			account.period,
			account.digits,
			account.algorithm,
		);
		setTotp({ code: result.code, progress: result.progress });
	}, [account]);

	useEffect(() => {
		refreshTotp();
		const interval = setInterval(refreshTotp, 1000);
		return () => clearInterval(interval);
	}, [refreshTotp]);

	// Detect changes
	useEffect(() => {
		if (!account) return;
		const changed =
			name !== account.name ||
			username !== account.username ||
			(group || customGroup) !== (account.group || '');
		setHasChanges(changed);
	}, [name, username, group, customGroup, account]);

	const handleSave = () => {
		if (!account) return;
		updateAccount(account.id, {
			name: name.trim(),
			username: username.trim(),
			group: (customGroup.trim() || group || '').trim() || undefined,
		});
		setHasChanges(false);
		showToast(t('account.saved'), 'success');
	};

	const handleCopy = async () => {
		if (!totp) return;
		await navigator.clipboard.writeText(totp.code);
		setCopied(true);
		showToast(t('account.copied'), 'success');
		setTimeout(() => setCopied(false), 2000);
	};

	const handleDelete = () => {
		if (!account) return;
		removeAccount(account.id);
		showToast(t('account.deleted'), 'success');
		navigate(toSlugged('/', slug));
	};

	if (!account) {
		return (
			<div className="flex h-full flex-col items-center justify-center text-[var(--color-text-secondary)]">
				<p>{t('account.notFound')}</p>
				<button
					onClick={() => navigate(toSlugged('/', slug))}
					className="mt-2 text-sm text-primary-400"
				>
					{t('account.goBack')}
				</button>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<header className="sticky top-0 z-10 flex items-center gap-3 border-b border-auth-border bg-auth-bg/80 h-[var(--layout-header-height)] px-4 backdrop-blur-md">
				<button
					onClick={() => navigate(toSlugged('/', slug))}
					className="rounded-lg p-1.5 text-[var(--color-text-secondary)] hover:bg-auth-elevated hover:text-[var(--color-text-primary)] transition-colors"
					aria-label={t('account.goBack')}
				>
					<ArrowLeft className="h-5 w-5" />
				</button>
				<h1 className="text-lg font-bold text-[var(--color-text-primary)]">{t('account.title')}</h1>
				{hasChanges && (
					<button
						onClick={handleSave}
						className="ml-auto flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-500 transition-colors"
					>
						<Save className="h-3.5 w-3.5" />
						{t('account.save')}
					</button>
				)}
			</header>

			<div className="flex-1 space-y-6 px-4 py-4">
				{/* TOTP Code Display */}
				<div className="flex flex-col items-center rounded-xl border border-auth-border bg-auth-surface p-6">
					<BrandIcon name={account.name} username={account.username} size={48} className="mb-3" />
					<h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{account.name}</h2>
					<p className="text-sm text-[var(--color-text-secondary)]">{account.username}</p>

					<div className="mt-4 flex items-center gap-4">
						<button onClick={handleCopy} className="group flex items-center gap-2">
							<span className="text-4xl font-mono font-bold tracking-wider text-[var(--color-text-primary)]">
								{totp?.code ?? '------'}
							</span>
							<span className="rounded-md p-1.5 text-[var(--color-text-muted)] group-hover:bg-primary-500/10 group-hover:text-primary-400 transition-colors">
								{copied ? <Check className="h-4 w-4 text-[var(--color-success-text)]" /> : <Copy className="h-4 w-4" />}
							</span>
						</button>
						<CountdownRing progress={totp?.progress ?? 1} size={48} strokeWidth={3} />
					</div>
				</div>

				{/* Edit Form */}
				<div className="space-y-4 rounded-xl border border-auth-border bg-auth-surface p-4">
					<h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('account.editInfo')}</h3>

					<div>
						<label className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
							{t('account.serviceName')}
						</label>
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="w-full rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:border-primary-500"
						/>
					</div>

					<div>
						<label className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
							{t('account.username')}
						</label>
						<input
							type="text"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							className="w-full rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:border-primary-500"
						/>
					</div>

					<div>
						<label className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
							{t('account.group')}
						</label>
						<div className="flex flex-wrap gap-1.5">
							{PRESET_GROUPS.map((g) => (
								<button
									key={g}
									onClick={() => {
										setGroup(g === group ? '' : g);
										setCustomGroup('');
									}}
									className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
										g === group && !customGroup
											? 'bg-primary-600 text-white'
											: 'bg-auth-elevated text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
									}`}
								>
									{groupLabel(t, g)}
								</button>
							))}
						</div>
						<input
							type="text"
							value={customGroup}
							onChange={(e) => {
								setCustomGroup(e.target.value);
								setGroup('');
							}}
							placeholder={t('account.groupCustomPlaceholder')}
							className="mt-2 w-full rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:border-primary-500"
						/>
					</div>

					<div>
						<label className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
							{t('account.secretLabel')}
						</label>
						<div className="flex items-center justify-between gap-2 rounded-xl border border-auth-border bg-auth-elevated px-3.5 py-2.5">
							<code className="break-all text-xs font-mono text-[var(--color-text-muted)]">
								{showSecret ? account.secret : '•••• •••• •••• ••••'}
							</code>
							<button
								type="button"
								onClick={() => setShowSecret((v) => !v)}
								aria-label={showSecret ? t('account.hideSecret') : t('account.revealSecret')}
								className="shrink-0 rounded-md p-1.5 text-[var(--color-text-muted)] hover:bg-auth-border hover:text-[var(--color-text-secondary)] transition-colors"
							>
								{showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
							</button>
						</div>
						<p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{t('account.secretHint')}</p>
					</div>
				</div>

				{/* Pin & Order */}
				<div className="space-y-3 rounded-xl border border-auth-border bg-auth-surface p-4">
					<h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('account.sorting')}</h3>

					<button
						onClick={() => {
							toggleAccountPin(account.id);
							showToast(account.pinned ? t('account.unpinned') : t('account.pinned'), 'success');
						}}
						className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
							account.pinned
								? 'bg-warning/10 text-[var(--color-warning-text)] hover:bg-warning/20'
								: 'bg-auth-elevated text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
						}`}
					>
						{account.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
						{account.pinned ? t('account.cancelPin') : t('account.pinTop')}
					</button>

					<div className="flex gap-2">
						<button
							onClick={() => {
								const sameGroup = accounts.filter(
									(a) => (a.pinned ?? false) === (account.pinned ?? false),
								);
								const prev = sameGroup
									.filter((a) => (a.order ?? 0) < (account.order ?? 0))
									.sort((a, b) => (b.order ?? 0) - (a.order ?? 0))[0];
								if (prev) {
									const myOrder = account.order ?? 0;
									const prevOrder = prev.order ?? 0;
									updateAccountOrder(prev.id, myOrder);
									updateAccountOrder(account.id, prevOrder);
									showToast(t('account.movedUp'), 'success');
								}
							}}
							className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-auth-elevated px-3 py-2.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
						>
							<ChevronUp className="h-4 w-4" />
							{t('account.moveUp')}
						</button>
						<button
							onClick={() => {
								const sameGroup = accounts.filter(
									(a) => (a.pinned ?? false) === (account.pinned ?? false),
								);
								const next = sameGroup
									.filter((a) => (a.order ?? 0) > (account.order ?? 0))
									.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
								if (next) {
									const myOrder = account.order ?? 0;
									const nextOrder = next.order ?? 0;
									updateAccountOrder(next.id, myOrder);
									updateAccountOrder(account.id, nextOrder);
									showToast(t('account.movedDown'), 'success');
								}
							}}
							className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-auth-elevated px-3 py-2.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
						>
							<ChevronDown className="h-4 w-4" />
							{t('account.moveDown')}
						</button>
					</div>
				</div>

				{/* Delete */}
				<div className="rounded-xl border border-danger/20 bg-danger/5 p-4">
					<h3 className="text-sm font-semibold text-[var(--color-danger-text)]">{t('account.dangerZone')}</h3>
					<p className="mt-1 text-xs text-[var(--color-text-secondary)]">{t('account.deleteWarning')}</p>

					{!showDelete ? (
						<button
							onClick={() => setShowDelete(true)}
							className="mt-3 flex items-center gap-1.5 rounded-lg border border-danger/30 px-3 py-2 text-xs font-medium text-[var(--color-danger-text)] hover:bg-danger/10 transition-colors"
						>
							<Trash2 className="h-3.5 w-3.5" />
							{t('account.deleteButton')}
						</button>
					) : (
						<div className="mt-3 flex flex-wrap items-center gap-2">
							<AlertCircle className="h-4 w-4 text-[var(--color-danger-text)]" />
							<span className="text-xs text-[var(--color-danger-text)]">{t('account.confirmDelete')}</span>
							<button
								onClick={() => setShowDelete(false)}
								className="rounded-lg bg-auth-elevated px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
							>
								{t('common.cancel')}
							</button>
							<button
								onClick={handleDelete}
								className="rounded-lg bg-danger-soft px-3 py-1.5 text-xs text-[var(--color-danger-text)]"
							>
								{t('account.confirm')}
							</button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
