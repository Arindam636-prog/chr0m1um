const HANDLE_PATTERN = /^LOCAL_[A-Z][A-Z0-9_]*_[1-9][0-9]*$/;

/**
 * Memory-only secret storage. Values disappear when the extension worker is
 * unloaded and are never written to browser.storage.
 */
export class SecretVault {
  readonly #values = new Map<string, string>();
  readonly #kinds = new Map<string, string>();
  readonly #counters = new Map<string, number>();

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

  resolve(handle: string): string | undefined {
    if (!HANDLE_PATTERN.test(handle)) return undefined;
    return this.#values.get(handle);
  }

  remove(handle: string): boolean {
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
    this.#values.clear();
    this.#kinds.clear();
    this.#counters.clear();
  }

  get size(): number {
    return this.#values.size;
  }
}
