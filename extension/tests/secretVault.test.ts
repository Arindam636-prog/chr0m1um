import { describe, expect, it } from 'vitest';

import { SecretVault } from '../lib/vault/secretVault';

describe('SecretVault', () => {
  it('stores values only behind opaque handles', () => {
    const vault = new SecretVault();
    const handle = vault.store('email', 'private@example.com');

    expect(handle).toBe('LOCAL_EMAIL_1');
    expect(vault.resolve(handle)).toBe('private@example.com');
    expect(vault.resolve('private@example.com')).toBeUndefined();
  });

  it('clears all runtime secrets', () => {
    const vault = new SecretVault();
    const handle = vault.store('otp', '123456');
    vault.clear();

    expect(vault.resolve(handle)).toBeUndefined();
    expect(vault.size).toBe(0);
  });
});

