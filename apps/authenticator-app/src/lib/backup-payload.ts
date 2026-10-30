import type { TotpAccount } from '@/lib/store';

/**
 * 云备份载荷的序列化 / 反序列化（纯函数，无副作用）。
 *
 * 约束：输出必须与 `TotpAccount` 同构。漏字段会在「备份 → 还原」后**静默丢数据**
 * （历史事故：HOTP 的 `type` / `counter` 未序列化，还原后被当成 TOTP，出码必错且无报错）。
 * 新增 `TotpAccount` 字段时，这里必须同步补一行，并在 `__tests__/backup-payload.test.ts` 里加断言。
 *
 * 兼容性：旧信封（早期 v2）没有 `type` / `counter` / `pinned`，解析时按 TOTP 缺省处理；
 * 新信封对旧客户端是「多出未知字段」，解析方用展开语法，向后兼容。
 */
export function serializeAccounts(accounts: TotpAccount[]): string {
	return JSON.stringify(
		accounts.map((a) => ({
			id: a.id,
			name: a.name,
			username: a.username,
			secret: a.secret,
			type: a.type,
			algorithm: a.algorithm,
			digits: a.digits,
			period: a.period,
			counter: a.counter,
			icon: a.icon,
			group: a.group,
			order: a.order,
			pinned: a.pinned,
			createdAt: a.createdAt,
		})),
	);
}

export function parseAccounts(json: string): TotpAccount[] {
	const parsed = JSON.parse(json) as Partial<TotpAccount>[];
	return parsed.map((a) => ({
		...a,
		type: a.type === 'hotp' ? 'hotp' : 'totp',
	})) as TotpAccount[];
}
