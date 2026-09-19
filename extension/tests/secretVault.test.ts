import { describe, expect, it } from 'vitest';

import { SecretVault } from '../lib/vault/secretVault';
import type { ReleaseScope } from '../lib/vault/secretVault';
const scope: ReleaseScope = { run: 1, tab: 4, document: 'doc1', origin: 'https://example.com', target: 'el_1', fieldType: 'email', purpose: 'user task', actionDigest: 'digest1', snapshot: 'snap_1', fingerprint: 'fp_1' };

describe('SecretVault', () => {
  it('stores values only behind opaque handles', () => {
    const vault = new SecretVault();
    const handle = vault.store('email', 'private@example.com');

    expect(handle).toBe('LOCAL_EMAIL_1');
    expect(vault.resolve(handle)).toBeUndefined();
    const grantId = vault.approveOnce(handle, scope);
    expect(vault.resolve(handle, { grantId, scope })).toBe('private@example.com');
    expect(vault.resolve(handle, { grantId, scope })).toBeUndefined();
    expect(vault.resolve('private@example.com')).toBeUndefined();
  });
  it.each(Object.keys(scope))('rejects changed scope component %s', (key) => {
    const vault = new SecretVault(); const handle = vault.store('email', 'synthetic@example.test');
    const grantId = vault.approveOnce(handle, scope);
    const changed = { ...scope, [key]: 'different' };
    expect(vault.resolve(handle, { grantId, scope: changed })).toBeUndefined();
    expect(vault.resolve(handle, { grantId, scope })).toBeUndefined();
  });
  it('expires, revokes and prevents clear/readd handle reuse', () => {
    const vault = new SecretVault(); const handle = vault.store('email', 'one@example.test');
    const expired = vault.approveOnce(handle, scope, 1000);
    expect(vault.resolve(handle, { grantId: expired, scope }, 31000)).toBeUndefined();
    const revoked = vault.approveOnce(handle, scope); vault.revokeGrants();
    expect(vault.resolve(handle, { grantId: revoked, scope })).toBeUndefined();
    const old = vault.approveOnce(handle, scope); vault.clear(); vault.store('email', 'two@example.test');
    expect(vault.resolve(handle, { grantId: old, scope })).toBeUndefined();
  });

  it('clears all runtime secrets', () => {
    const vault = new SecretVault();
    const handle = vault.store('otp', '123456');
    vault.clear();

    expect(vault.resolve(handle)).toBeUndefined();
    expect(vault.size).toBe(0);
  });
});
