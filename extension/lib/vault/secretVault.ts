const HANDLE_PATTERN = /^LOCAL_[A-Z][A-Z0-9_]*_[1-9][0-9]*$/;

export interface ReleaseScope {
  run: number; tab: number; document: string; origin: string;
  target: string; fieldType: string; purpose: string; actionDigest: string;
  snapshot: string; fingerprint: string;
}
interface ReleaseGrant { handle: string; scope: string; expires: number }

/**
 * Memory-only secret storage. Values disappear when the extension worker is
 * unloaded and are never written to browser.storage.
 */
export class SecretVault {
  readonly #values = new Map<string, string>();
  readonly #kinds = new Map<string, string>();
  readonly #counters = new Map<string, number>();
  readonly #grants = new Map<string, ReleaseGrant>();

  approveOnce(handle: string, scope: ReleaseScope, now = Date.now()): string {
    if (!this.#values.has(handle) || !scope.document || !scope.actionDigest || !scope.purpose) throw new Error('INVALID_RELEASE_SCOPE');
    const id = crypto.randomUUID();
    this.#grants.set(id, { handle, scope: JSON.stringify(scope), expires: now + 30_000 });
    return id;
  }

  revokeGrants(): void { this.#grants.clear(); }

  store(kind: string, value: string): string {
    const normalizedKind = kind.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    if (!normalizedKind || !value) {
      throw new Error('Secret kind and value are required');
    }

    for (const [handle, existing] of this.#values) {
      if (existing === value && this.#kinds.get(handle) === normalizedKind) return handle;
    }

    const next = (this.#counters.get(normalizedKind) ?? 0) + 1;
    const handle = `LOCAL_${normalizedKind}_${next}`;
    this.#counters.set(normalizedKind, next);
    this.#values.set(handle, value);
    this.#kinds.set(handle, normalizedKind);
    return handle;
  }

  resolve(handle: string, authorization?: { grantId: string; scope: ReleaseScope }, now = Date.now()): string | undefined {
    if (!authorization) return undefined;
    const grant = this.#grants.get(authorization.grantId);
    this.#grants.delete(authorization.grantId);
    if (!HANDLE_PATTERN.test(handle) || !grant || grant.expires <= now || grant.handle !== handle || grant.scope !== JSON.stringify(authorization.scope)) return undefined;
    return this.#values.get(handle);
  }

  remove(handle: string): boolean {
    this.revokeGrants();
    this.#kinds.delete(handle);
    return this.#values.delete(handle);
  }

  firstHandle(kind: string): string | undefined {
    const normalizedKind = kind.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    for (const [handle, storedKind] of this.#kinds) {
      if (storedKind === normalizedKind) return handle;
    }
    return undefined;
  }

  handles(): string[] {
    return [...this.#values.keys()];
  }

  values(): string[] {
    return [...this.#values.values()];
  }

  clear(): void {
    this.revokeGrants();
    this.#values.clear();
    this.#kinds.clear();
    this.#counters.clear();
  }

  get size(): number {
    return this.#values.size;
  }
}
