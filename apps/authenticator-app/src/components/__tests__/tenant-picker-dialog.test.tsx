import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-i18next', () => ({
	useTranslation: () => ({
		t: (key: string, opts?: any) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
	}),
}));

vi.mock('@autional/shared', () => ({
	getPortalUrl: () => 'https://brand.example',
}));

import TenantPickerDialog from '../TenantPickerDialog';

describe('TenantPickerDialog', () => {
	it('filters organization codes case-insensitively and picks a suggestion', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve({
					ok: true,
					json: async () => ({ items: [{ name: 'acme-corp' }, { name: 'platform' }] }),
				}),
			),
		);
		const onPick = vi.fn();
		render(<TenantPickerDialog open onPick={onPick} onCancel={() => {}} />);

		const input = screen.getByLabelText('signIn.label');
		await userEvent.type(input, 'ACME');

		const option = await screen.findByRole('option', { name: 'acme-corp' });
		await userEvent.click(option);
		expect(input).toHaveValue('acme-corp');

		await userEvent.click(screen.getByRole('button', { name: 'signIn.continue' }));
		expect(onPick).toHaveBeenCalledWith('acme-corp');
	});

	it('normalizes manually typed codes to lower case', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
		const onPick = vi.fn();
		render(<TenantPickerDialog open onPick={onPick} onCancel={() => {}} />);

		const input = screen.getByLabelText('signIn.label');
		await userEvent.type(input, 'MyOrg');
		await userEvent.click(screen.getByRole('button', { name: 'signIn.continue' }));

		expect(onPick).toHaveBeenCalledWith('myorg');
	});
});
