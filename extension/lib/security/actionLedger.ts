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
  try {
    if (
      proof.blocks.length !== trusted.count ||
      proof.checkpoint.head !== trusted.head
    )
      return false;
    let previous = ZERO;
    for (const [index, block] of proof.blocks.entries()) {
      const { hash, ...body } = block;
      if (
        block.index !== index ||
        block.previous !== previous ||
        (await digest(body)) !== hash
      )
        return false;
      previous = hash;
    }
    if (previous !== trusted.head) return false;
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
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      signedBytes(proof.session, trusted.count, trusted.head),
    );
  } catch {
    return false;
  }
}
