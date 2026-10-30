import { describe, it, expect } from 'vitest';
import { parseAccounts, serializeAccounts } from '@/lib/backup-payload';
import type { TotpAccount } from '@/lib/store';

function account(overrides: Partial<TotpAccount> = {}): TotpAccount {
	return {
		id: 'acc-1',
		name: 'Example',
		username: 'user@example.com',
		secret: 'JBSWY3DPEHPK3PXP',
		type: 'totp',
		algorithm: 'SHA1',
		digits: 6,
		period: 30,
		icon: 'i',
		group: 'g',
		order: 1,
		pinned: false,
		createdAt: 1761700000000,
		...overrides,
	};
}

describe('backup-payload', () => {
	it('TOTP 全字段往返不丢', () => {
		const src = [account()];
		const out = parseAccounts(serializeAccounts(src));
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject(src[0]);
	});

	it('HOTP 保留 type 与 counter（回归：曾静默退化为 TOTP）', () => {
		const src = [account({ type: 'hotp', counter: 7 })];
		const out = parseAccounts(serializeAccounts(src));
		expect(out[0].type).toBe('hotp');
		expect(out[0].counter).toBe(7);
	});

	it('pinned 保留', () => {
		const out = parseAccounts(serializeAccounts([account({ pinned: true })]));
		expect(out[0].pinned).toBe(true);
	});

	it('旧信封缺 type 时按 TOTP 解释（向后兼容）', () => {
		const legacy = JSON.stringify([{ id: 'a', name: 'n', username: 'u', secret: 'S' }]);
		const out = parseAccounts(legacy);
		expect(out[0].type).toBe('totp');
		expect(out[0].counter).toBeUndefined();
	});

	it('未知 type 归一为 TOTP（防御）', () => {
		const bogus = JSON.stringify([{ id: 'a', type: 'steam' }]);
		expect(parseAccounts(bogus)[0].type).toBe('totp');
	});
});
