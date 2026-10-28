import { describe, expect, it } from 'vitest';
import {
	BackupEnvelopeError,
	checksumOfData,
	createEnvelope,
	decryptEnvelope,
	formatRecoveryCode,
	hashWraps,
	isEnvelopeV2,
	normalizeRecoveryCode,
	parseEnvelope,
	reencryptEnvelope,
	rewrapPassphrase,
	rotateRecoveryCode,
	serializeEnvelope,
	unlockEnvelope,
} from '../backup-envelope';

const ACCOUNTS = JSON.stringify([
	{ id: '1', name: 'GitHub', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 },
	{ id: '2', name: 'Example', secret: 'GEZDGNBVGY3TQOJQ', algorithm: 'SHA1', digits: 6, period: 30 },
]);

async function newEnvelope() {
	return createEnvelope(ACCOUNTS, 'correct horse battery');
}

describe('backup envelope v2', () => {
	it('roundtrips with the passphrase', async () => {
		const { envelope, dek } = await newEnvelope();
		const parsed = parseEnvelope(serializeEnvelope(envelope));
		const unlocked = await unlockEnvelope(parsed, { passphrase: 'correct horse battery' });
		expect(unlocked.dek).toBeDefined();
		expect(unlocked.needsRewrap).toBe(false);
		await expect(decryptEnvelope(parsed, dek)).resolves.toBe(ACCOUNTS);
	});

	it('roundtrips with the recovery code (normalized)', async () => {
		const { envelope, recoveryCode } = await newEnvelope();
		const parsed = parseEnvelope(serializeEnvelope(envelope));
		const messy = ` ${recoveryCode.toLowerCase().replace(/-/g, ' ')} `;
		expect(normalizeRecoveryCode(messy)).toBe(recoveryCode.replace(/-/g, ''));
		const unlocked = await unlockEnvelope(parsed, { recoveryCode: messy });
		expect(await decryptEnvelope(parsed, unlocked.dek)).toBe(ACCOUNTS);
	});

	it('rejects a wrong passphrase', async () => {
		const { envelope } = await newEnvelope();
		await expect(
			unlockEnvelope(envelope, { passphrase: 'wrong passphrase' }),
		).rejects.toBeInstanceOf(BackupEnvelopeError);
	});

	it('rejects a tampered data block', async () => {
		const { envelope, dek } = await newEnvelope();
		const tampered = {
			...envelope,
			data: { ...envelope.data, ct: envelope.data.ct.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) },
		};
		await expect(
			unlockEnvelope(tampered, { passphrase: 'correct horse battery' }),
		).rejects.toBeInstanceOf(BackupEnvelopeError);
		await expect(decryptEnvelope(tampered, dek)).rejects.toBeInstanceOf(BackupEnvelopeError);
	});

	it('rejects a tampered header via MAC', async () => {
		const { envelope } = await newEnvelope();
		const tampered = { ...envelope, kdf_policy: 1000 };
		await expect(
			unlockEnvelope(tampered, { passphrase: 'correct horse battery' }),
		).rejects.toBeInstanceOf(BackupEnvelopeError);
	});

	it('re-encrypts data without changing wraps', async () => {
		const { envelope, dek } = await newEnvelope();
		const before = await hashWraps(envelope.wraps);
		const next = await reencryptEnvelope(envelope, dek, JSON.stringify([{ id: '3' }]));
		expect(await hashWraps(next.wraps)).toBe(before);
		const unlocked = await unlockEnvelope(next, { passphrase: 'correct horse battery' });
		expect(await decryptEnvelope(next, unlocked.dek)).toBe(JSON.stringify([{ id: '3' }]));
	});

	it('rewraps the passphrase and keeps the recovery code valid', async () => {
		const { envelope, dek, recoveryCode } = await newEnvelope();
		const next = await rewrapPassphrase(envelope, dek, 'new passphrase 123');
		await expect(
			unlockEnvelope(next, { passphrase: 'correct horse battery' }),
		).rejects.toBeInstanceOf(BackupEnvelopeError);
		const unlocked = await unlockEnvelope(next, { passphrase: 'new passphrase 123' });
		expect(await decryptEnvelope(next, unlocked.dek)).toBe(ACCOUNTS);
		const viaRecovery = await unlockEnvelope(next, { recoveryCode });
		expect(await decryptEnvelope(next, viaRecovery.dek)).toBe(ACCOUNTS);
	});

	it('rotates the recovery code', async () => {
		const { envelope, dek, recoveryCode } = await newEnvelope();
		const { envelope: next, recoveryCode: fresh } = await rotateRecoveryCode(envelope, dek);
		await expect(
			unlockEnvelope(next, { recoveryCode }),
		).rejects.toBeInstanceOf(BackupEnvelopeError);
		const unlocked = await unlockEnvelope(next, { recoveryCode: fresh });
		expect(await decryptEnvelope(next, unlocked.dek)).toBe(ACCOUNTS);
	});

	it('detects v1 vs v2 and validates recovery codes', () => {
		expect(isEnvelopeV2('{"v":2}')).toBe(true);
		expect(isEnvelopeV2('abc:def')).toBe(false);
		expect(() => normalizeRecoveryCode('short')).toThrow();
		const code = formatRecoveryCode('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
		expect(code).toContain('-');
	});

	it('computes a stable checksum', async () => {
		const { envelope } = await newEnvelope();
		const a = await checksumOfData(envelope.data);
		const b = await checksumOfData(envelope.data);
		expect(a).toBe(b);
		expect(a).toHaveLength(64);
	});

	it('never embeds plaintext secrets or names in the serialized envelope', async () => {
		const { envelope } = await newEnvelope();
		const raw = serializeEnvelope(envelope);
		expect(raw).not.toContain('JBSWY3DPEHPK3PXP');
		expect(raw).not.toContain('GEZDGNBVGY3TQOJQ');
		expect(raw).not.toContain('GitHub');
	});
});
