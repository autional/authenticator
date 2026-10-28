import { describe, expect, it, beforeEach } from 'vitest';
import { LOCAL_MODE_SLUG, readLastTenantSlug, rememberTenantSlug, toSlugged } from '../slug';

describe('tenantless routing helpers', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('toSlugged is identity (internal navigation stays at root)', () => {
		expect(toSlugged('/settings', 'acme')).toBe('/settings');
		expect(toSlugged('/', 'acme')).toBe('/');
		expect(toSlugged('/account?id=x', 'acme')).toBe('/account?id=x');
		expect(toSlugged('/settings')).toBe('/settings');
	});

	it('remembers the last tenant for login/branding fallback', () => {
		expect(readLastTenantSlug()).toBe('');
		rememberTenantSlug('acme');
		expect(readLastTenantSlug()).toBe('acme');
		rememberTenantSlug('');
		expect(readLastTenantSlug()).toBe('acme');
	});

	it('keeps the legacy local segment constant for one release', () => {
		expect(LOCAL_MODE_SLUG).toBe('local');
	});
});
