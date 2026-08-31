import { describe, expect, it } from 'vitest';

import { localizeTaskFieldValues } from '../lib/privacy/taskHandles';
import { SecretVault } from '../lib/vault/secretVault';

describe('task field handles', () => {
  it('keeps form values local while preserving a usable structured task', () => {
    const vault = new SecretVault();
    const task = 'Fill first name Arindam, last name Test, email owner@example.com, mobile 9876543210, and address Kolkata. Do not submit it.';
    const localized = localizeTaskFieldValues(task, vault);

    expect(localized).toContain('first name LOCAL_GIVEN_NAME_1');
    expect(localized).toContain('last name LOCAL_SURNAME_1');
    expect(localized).toContain('email LOCAL_EMAIL_1');
    expect(localized).toContain('mobile LOCAL_PHONE_1');
    expect(localized).toContain('address LOCAL_ADDRESS_1');
    expect(localized).toContain('Do not submit it');
    expect(localized).not.toContain('Arindam');
    expect(localized).not.toContain('owner@example.com');
    expect(vault.resolve('LOCAL_GIVEN_NAME_1')).toBe('Arindam');
    expect(vault.resolve('LOCAL_SURNAME_1')).toBe('Test');
    expect(vault.resolve('LOCAL_ADDRESS_1')).toBe('Kolkata');
  });

  it('does not wrap an existing local handle a second time', () => {
    const vault = new SecretVault();
    expect(localizeTaskFieldValues('Use email LOCAL_EMAIL_1.', vault)).toBe(
      'Use email LOCAL_EMAIL_1.',
    );
    expect(vault.size).toBe(0);
  });

  it('does not mistake an action after a field name for a private value', () => {
    const vault = new SecretVault();
    expect(localizeTaskFieldValues('Fill my email and continue', vault)).toBe(
      'Fill my email and continue',
    );
    expect(vault.size).toBe(0);
  });
});
