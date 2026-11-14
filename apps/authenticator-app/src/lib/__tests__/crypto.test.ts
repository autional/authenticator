import { describe, it, expect } from 'vitest';
import {
	encryptWithKey,
	decryptWithKey,
	generateDeviceKey,
	exportDeviceKey,
	importDeviceKey,
	derivePinKey,
	arrayBufferToBase64,
	base64ToArrayBuffer,
} from '../crypto';

describe('arrayBufferToBase64 / base64ToArrayBuffer', () => {
	it('roundtrip', () => {
		const data = new Uint8Array([0x00, 0xff, 0x48, 0x65, 0x6c, 0x6c, 0x6f]);
		const b64 = arrayBufferToBase64(data);
		const decoded = base64ToArrayBuffer(b64);
		expect(decoded).toEqual(data);
	});

	it('empty buffer', () => {
		const data = new Uint8Array(0);
		const b64 = arrayBufferToBase64(data);
		expect(b64).toBe('');
		const decoded = base64ToArrayBuffer(b64);
		expect(decoded).toEqual(data);
	});
});

describe('encryptWithKey / decryptWithKey', () => {
	it('roundtrip', async () => {
		const key = await generateDeviceKey();
		const plaintext = 'Hello, World!';
		const { ciphertext, iv } = await encryptWithKey(plaintext, key);
		expect(ciphertext.length).toBeGreaterThan(0);
		expect(iv.length).toBe(12);

		const decrypted = await decryptWithKey(ciphertext, iv, key);
		expect(decrypted).toBe(plaintext);
	});

	it('produces different ciphertext for same plaintext', async () => {
		const key = await generateDeviceKey();
		const plaintext = 'same message';

		const result1 = await encryptWithKey(plaintext, key);
		const result2 = await encryptWithKey(plaintext, key);

		expect(result1.iv).not.toEqual(result2.iv);
		expect(result1.ciphertext).not.toEqual(result2.ciphertext);
	});

	it('decrypt with wrong key fails', async () => {
		const key1 = await generateDeviceKey();
		const key2 = await generateDeviceKey();
		const plaintext = 'secret data';
		const { ciphertext, iv } = await encryptWithKey(plaintext, key1);

		await expect(decryptWithKey(ciphertext, iv, key2)).rejects.toThrow();
	});

	it('decrypt with wrong IV fails', async () => {
		const key = await generateDeviceKey();
		const plaintext = 'secret data';
		const { ciphertext } = await encryptWithKey(plaintext, key);
		const wrongIv = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

		await expect(decryptWithKey(ciphertext, wrongIv, key)).rejects.toThrow();
	});

	it('decrypt with tampered ciphertext fails', async () => {
		const key = await generateDeviceKey();
		const plaintext = 'secret data';
		const { ciphertext, iv } = await encryptWithKey(plaintext, key);
		ciphertext[0] ^= 1; // flip one bit

		await expect(decryptWithKey(ciphertext, iv, key)).rejects.toThrow();
	});

	it('empty string', async () => {
		const key = await generateDeviceKey();
		const { ciphertext, iv } = await encryptWithKey('', key);
		const decrypted = await decryptWithKey(ciphertext, iv, key);
		expect(decrypted).toBe('');
	});

	it('large payload (10KB)', async () => {
		const key = await generateDeviceKey();
		const plaintext = 'x'.repeat(10 * 1024);
		const { ciphertext, iv } = await encryptWithKey(plaintext, key);
		expect(ciphertext.length).toBeGreaterThanOrEqual(plaintext.length);
		const decrypted = await decryptWithKey(ciphertext, iv, key);
		expect(decrypted).toBe(plaintext);
	});

	it('unicode characters', async () => {
		const key = await generateDeviceKey();
		const plaintext = '中文テスト🎉 emoji ✅';
		const { ciphertext, iv } = await encryptWithKey(plaintext, key);
		const decrypted = await decryptWithKey(ciphertext, iv, key);
		expect(decrypted).toBe(plaintext);
	});

	it('special characters and newlines', async () => {
		const key = await generateDeviceKey();
		const plaintext = 'line1\nline2\r\nline3\t"quoted" <tag> {json: true}';
		const { ciphertext, iv } = await encryptWithKey(plaintext, key);
		const decrypted = await decryptWithKey(ciphertext, iv, key);
		expect(decrypted).toBe(plaintext);
	});
});

describe('device key import/export', () => {
	it('roundtrip', async () => {
		const key = await generateDeviceKey();
		const raw = await exportDeviceKey(key);
		expect(raw).toBeInstanceOf(Uint8Array);
		expect(raw.length).toBe(32);

		const imported = await importDeviceKey(raw);
		const plaintext = 'test after import/export';
		const { ciphertext, iv } = await encryptWithKey(plaintext, imported);
		const decrypted = await decryptWithKey(ciphertext, iv, imported);
		expect(decrypted).toBe(plaintext);
	});
});

describe('derivePinKey', () => {
	it('derives key from PIN', async () => {
		const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
		const pinKey = await derivePinKey('123456', salt);
		expect(pinKey.type).toBe('secret');
		expect(pinKey.algorithm.name).toBe('AES-GCM');
	});

	it('different PIN produces different key', async () => {
		const salt = new Uint8Array(16);
		const key1 = await derivePinKey('111111', salt);
		const key2 = await derivePinKey('222222', salt);
		const raw1 = await exportDeviceKey(key1);
		const raw2 = await exportDeviceKey(key2);
		expect(raw1).not.toEqual(raw2);
	});

	it('same PIN and salt produces same key', async () => {
		const salt = new Uint8Array([
			0xab, 0xcd, 0xef, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x11, 0x22, 0x33, 0x44,
			0x55,
		]);
		const key1 = await derivePinKey('password', salt);
		const key2 = await derivePinKey('password', salt);
		const raw1 = await exportDeviceKey(key1);
		const raw2 = await exportDeviceKey(key2);
		expect(raw1).toEqual(raw2);
	});

	it('迭代次数参与派生（旧库兼容路径与现行标准不同）', async () => {
		const salt = new Uint8Array(16).fill(3);
		const current = await derivePinKey('123456', salt);
		const legacy = await derivePinKey('123456', salt, 100_000);
		expect(await exportDeviceKey(current)).not.toEqual(await exportDeviceKey(legacy));
	});
});

describe('importDeviceKey roundtrip (BUG-05 regression)', () => {
	it('import → export roundtrip (key must be extractable for PIN wrapping)', async () => {
		const original = await generateDeviceKey();
		const exported = await exportDeviceKey(original);
		const imported = await importDeviceKey(exported);
		const reExported = await exportDeviceKey(imported);
		expect(reExported).toEqual(exported);
	});

	it('imported key can still encrypt/decrypt', async () => {
		const original = await generateDeviceKey();
		const exported = await exportDeviceKey(original);
		const imported = await importDeviceKey(exported);

		const plaintext = 'test data for imported key';
		const { ciphertext, iv } = await encryptWithKey(plaintext, imported);
		const decrypted = await decryptWithKey(ciphertext, iv, imported);
		expect(decrypted).toBe(plaintext);
	});
});
