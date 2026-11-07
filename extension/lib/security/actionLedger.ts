/** A session-local signed hash chain, not a distributed blockchain or a network audit. */
export type LedgerEvent =
  | "RUN_STARTED"
  | "APPROVAL_REQUESTED"
  | "DENIED"
  | "AUTHORIZED"
  | "EXECUTED"
  | "BLOCKED"
  | "STOPPED"
  | "VAULT_CLEARED";
export interface LedgerBlock {
  index: number;
  at: number;
  event: LedgerEvent;
  action: string;
  actionCommitment: string | null;
  previous: string;
  hash: string;
}
export interface LedgerProof {
  version: 1;
  session: string;
  blocks: LedgerBlock[];
  checkpoint: {
    count: number;
    head: string;
    signature: string;
    publicKey: JsonWebKey;
  };
}
const ZERO = "0".repeat(64);
export async function digest(value: unknown): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function signedBytes(
  session: string,
  count: number,
  head: string,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify({ version: 1, session, count, head }),
  );
}
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
export class ActionLedger {
  readonly session = crypto.randomUUID();
  #blocks: LedgerBlock[] = [];
  #keys = crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  #queue: Promise<unknown> = Promise.resolve();
  append(event: LedgerEvent, action = "NONE", actionCommitment: string | null = null): Promise<void> {
    // Never accept task text, handles, field values, URLs, or planner prose into the journal.
    if (
      ![
        "RUN_STARTED",
        "APPROVAL_REQUESTED",
        "DENIED",
        "AUTHORIZED",
        "EXECUTED",
        "BLOCKED",
        "STOPPED",
        "VAULT_CLEARED",
      ].includes(event) ||
      ![
        "NONE",
        "CLICK",
        "TYPE_HANDLE",
        "SELECT",
        "SCROLL",
        "ASK_USER",
        "FINISH",
      ].includes(action) || (actionCommitment !== null && !/^[a-f0-9]{64}$/.test(actionCommitment))
    )
      throw new Error("UNSAFE_LEDGER_METADATA");
    const next = this.#queue.then(async () => {
      const body = {
        index: this.#blocks.length,
        at: Date.now(),
        event,
        action,
        actionCommitment,
        previous: this.#blocks.at(-1)?.hash ?? ZERO,
      };
      this.#blocks.push({ ...body, hash: await digest(body) });
    });
    this.#queue = next;
    return next;
  }
  async proof(): Promise<LedgerProof> {
    await this.#queue;
    const keys = await this.#keys;
    const blocks = structuredClone(this.#blocks);
    const count = blocks.length,
      head = blocks.at(-1)?.hash ?? ZERO;
    const signature = hex(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keys.privateKey,
        signedBytes(this.session, count, head),
      ),
    );
    return {
      version: 1,
      session: this.session,
      blocks,
      checkpoint: {
        count,
        head,
        signature,
        publicKey: await crypto.subtle.exportKey("jwk", keys.publicKey),
      },
    };
  }
}
export async function verifyLedger(
  proof: LedgerProof,
  trusted: LedgerProof["checkpoint"] = proof.checkpoint,
): Promise<boolean> {
  return (await inspectLedger(proof, trusted)).valid;
}

export interface LedgerInspection {
  valid: boolean;
  check: 'COUNT' | 'CHECKPOINT_HEAD' | 'INDEX' | 'PREVIOUS_HASH' | 'BLOCK_HASH' | 'CHAIN_HEAD' | 'SIGNATURE' | 'VERIFIED' | 'INVALID';
  block?: number;
  expected?: string;
  actual?: string;
}

/** Recompute each block from its contents; report the first failing check. */
export async function inspectLedger(
  proof: LedgerProof,
  trusted: LedgerProof['checkpoint'] = proof.checkpoint,
): Promise<LedgerInspection> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- edited JSON is untrusted at runtime
    if (proof.version !== 1) return { valid: false, check: 'INVALID' };
    if (proof.blocks.length !== trusted.count) return { valid: false, check: 'COUNT', expected: String(trusted.count), actual: String(proof.blocks.length) };
    if (proof.checkpoint.head !== trusted.head) return { valid: false, check: 'CHECKPOINT_HEAD', expected: trusted.head, actual: proof.checkpoint.head };
    let previous = ZERO;
    for (const [index, block] of proof.blocks.entries()) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- a JSON editor can supply null or non-block objects
      if (!block || typeof block !== 'object' || typeof block.index !== 'number' ||
        typeof block.at !== 'number' || !Number.isFinite(block.at) ||
        typeof block.event !== 'string' || typeof block.action !== 'string' ||
        typeof block.hash !== 'string' || typeof block.previous !== 'string' ||
        (block.actionCommitment !== null && typeof block.actionCommitment !== 'string')) {
        return { valid: false, check: 'INVALID', block: index };
      }
      const { hash, ...body } = block;
      if (block.index !== index) return { valid: false, check: 'INDEX', block: index, expected: String(index), actual: String(block.index) };
      if (block.previous !== previous) return { valid: false, check: 'PREVIOUS_HASH', block: index, expected: previous, actual: block.previous };
      const computed = await digest(body);
      if (computed !== hash) return { valid: false, check: 'BLOCK_HASH', block: index, expected: hash, actual: computed };
      previous = hash;
    }
    if (previous !== trusted.head) return { valid: false, check: 'CHAIN_HEAD', expected: trusted.head, actual: previous };
    const key = await crypto.subtle.importKey(
      "jwk",
      trusted.publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const signature = Uint8Array.from(
      trusted.signature.match(/.{2}/g) ?? [],
      (pair) => parseInt(pair, 16),
    );
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      signedBytes(proof.session, trusted.count, trusted.head),
    );
    return { valid, check: valid ? 'VERIFIED' : 'SIGNATURE' };
  } catch {
    return { valid: false, check: 'INVALID' };
  }
}

/** Rehashing a copy cannot produce a new signature for the retained checkpoint. */
export async function rehashLedgerCopy(proof: LedgerProof): Promise<LedgerProof> {
  const copy = structuredClone(proof);
  let previous = ZERO;
  for (const block of copy.blocks) {
    block.previous = previous;
    const body = Object.fromEntries(Object.entries(block).filter(([key]) => key !== 'hash'));
    block.hash = await digest(body);
    previous = block.hash;
  }
  copy.checkpoint.head = previous;
  return copy;
}
