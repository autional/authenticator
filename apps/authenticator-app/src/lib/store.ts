import { create } from 'zustand';

export interface TotpAccount {
	id: string;
	name: string;
	username: string;
	secret: string;
	type: 'totp' | 'hotp';
	algorithm: 'SHA1' | 'SHA256' | 'SHA512';
	digits: number;
	period: number;
	counter?: number;
	icon?: string;
	group?: string;
	order?: number;
	pinned?: boolean;
	createdAt: number;
}

interface AuthenticatorState {
	accounts: TotpAccount[];
	isLoading: boolean;
	isUnlocked: boolean;
	hasPin: boolean;
	unlockError: string | null;
	searchQuery: string;
	selectedGroup: string | null;

	// Actions
	loadAccounts: (accounts: TotpAccount[]) => void;
	addAccount: (account: Omit<TotpAccount, 'id' | 'createdAt'>) => void;
	removeAccount: (id: string) => void;
	updateAccount: (id: string, updates: Partial<Omit<TotpAccount, 'id' | 'createdAt'>>) => void;
	updateAccountOrder: (id: string, order: number) => void;
	toggleAccountPin: (id: string) => void;
	reorderAccounts: (accounts: TotpAccount[]) => void;
	importAccounts: (accounts: TotpAccount[]) => void;
	setUnlocked: (unlocked: boolean) => void;
	setHasPin: (hasPin: boolean) => void;
	setUnlockError: (error: string | null) => void;
	setLoading: (loading: boolean) => void;
	setSearchQuery: (query: string) => void;
	setSelectedGroup: (group: string | null) => void;
}

function generateId(): string {
	return `acc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const useAuthenticatorStore = create<AuthenticatorState>()((set) => ({
	accounts: [],
	isLoading: true,
	isUnlocked: false,
	hasPin: false,
	unlockError: null,
	searchQuery: '',
	selectedGroup: null,

	loadAccounts: (accounts) => set({ accounts, isUnlocked: true, isLoading: false }),

	addAccount: (account) =>
		set((state) => {
			const exists = state.accounts.some(
				(a) => a.secret === account.secret && a.username === account.username,
			);
			if (exists) {
				return state; // no-op, deduplication
			}
			const maxOrder =
				state.accounts.length > 0 ? Math.max(...state.accounts.map((a) => a.order ?? 0)) : -1;
			return {
				accounts: [
					...state.accounts,
					{
						...account,
						id: generateId(),
						order: maxOrder + 1,
						pinned: false,
						createdAt: Date.now(),
					},
				],
			};
		}),

	removeAccount: (id) =>
		set((state) => ({
			accounts: state.accounts.filter((a) => a.id !== id),
		})),

	updateAccount: (id, updates) =>
		set((state) => ({
			accounts: state.accounts.map((a) => (a.id === id ? { ...a, ...updates } : a)),
		})),

	updateAccountOrder: (id, order) =>
		set((state) => ({
			accounts: state.accounts.map((a) => (a.id === id ? { ...a, order } : a)),
		})),

	toggleAccountPin: (id) =>
		set((state) => ({
			accounts: state.accounts.map((a) => (a.id === id ? { ...a, pinned: !a.pinned } : a)),
		})),

	reorderAccounts: (accounts) => set({ accounts }),

	importAccounts: (accounts) =>
		set((state) => {
			const existingKeys = new Set(state.accounts.map((a) => `${a.secret}:${a.username}`));
			const newAccounts = accounts.filter((a) => !existingKeys.has(`${a.secret}:${a.username}`));
			const maxOrder =
				state.accounts.length > 0 ? Math.max(...state.accounts.map((a) => a.order ?? 0)) : -1;
			return {
				accounts: [
					...state.accounts,
					...newAccounts.map((a, i) => ({
						...a,
						order: a.order ?? maxOrder + 1 + i,
						pinned: a.pinned ?? false,
					})),
				],
			};
		}),

	setUnlocked: (unlocked) => set({ isUnlocked: unlocked }),
	setHasPin: (hasPin) => set({ hasPin }),
	setUnlockError: (error) => set({ unlockError: error }),
	setLoading: (loading) => set({ isLoading: loading }),
	setSearchQuery: (query) => set({ searchQuery: query }),
	setSelectedGroup: (group) => set({ selectedGroup: group }),
}));

// Auto-save accounts to encrypted storage on every change
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
useAuthenticatorStore.subscribe((state, prevState) => {
	if (state.accounts !== prevState.accounts && state.isUnlocked) {
		if (saveTimeout) clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => {
			import('./storage').then(({ saveAccounts, getDeviceKey }) => {
				// 已锁定（内存设备钥已清）时静默跳过：本次改动会在下次解锁后的状态里重新落盘
				if (!getDeviceKey()) return;
				saveAccounts(state.accounts).catch((err) => {
					console.error('Failed to save accounts:', err);
				});
			});
		}, 300);
	}
});
