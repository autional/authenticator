import { describe, it, expect, vi } from 'vitest';

const { mockGeneratedApi } = vi.hoisted(() => ({
	mockGeneratedApi: {
		mfaTotpDisablePost: vi.fn(),
		mfaBackupCodesGeneratePost: vi.fn(),
		mfaTotpEnablePost: vi.fn(),
		mfaBackupCodesCount: vi.fn(),
	},
}));

vi.mock('@autional/shared', () => ({
	GeneratedApi: mockGeneratedApi,
}));

import { disableTotp, generateBackupCodes, enableTotp, getBackupCodesCount } from '../api';

describe('disableTotp', () => {
	it('calls GeneratedApi with code', async () => {
		mockGeneratedApi.mfaTotpDisablePost.mockResolvedValue(undefined);
		await disableTotp('123456');
		expect(mockGeneratedApi.mfaTotpDisablePost).toHaveBeenCalledWith({ code: '123456' });
	});
});

describe('generateBackupCodes', () => {
	it('calls GeneratedApi with empty body', async () => {
		mockGeneratedApi.mfaBackupCodesGeneratePost.mockResolvedValue(undefined);
		await generateBackupCodes();
		expect(mockGeneratedApi.mfaBackupCodesGeneratePost).toHaveBeenCalledWith({});
	});
});

describe('enableTotp', () => {
	it('calls GeneratedApi with empty body', async () => {
		mockGeneratedApi.mfaTotpEnablePost.mockResolvedValue(undefined);
		await enableTotp();
		expect(mockGeneratedApi.mfaTotpEnablePost).toHaveBeenCalledWith({});
	});
});

describe('getBackupCodesCount', () => {
	it('returns count', async () => {
		mockGeneratedApi.mfaBackupCodesCount.mockResolvedValue({ count: 5 });
		const result = await getBackupCodesCount();
		expect(result).toEqual({ count: 5 });
	});
});
