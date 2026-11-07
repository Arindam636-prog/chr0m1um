import { describe, expect, it } from "vitest";
import {
  ActionLedger,
  digest,
  verifyLedger,
  inspectLedger,
  rehashLedgerCopy,
  type LedgerProof,
} from "../lib/security/actionLedger";

describe("signed local action ledger", () => {
  it('reports independently recomputed hashes, and restoration really verifies', async () => {
    const ledger = new ActionLedger();
    await ledger.append('RUN_STARTED');
    await ledger.append('AUTHORIZED', 'CLICK');
    const original = await ledger.proof();
    const originalBytes = JSON.stringify(original);
    const copy = structuredClone(original);
    const editedBlock = copy.blocks[1];
    const originalBlock = original.blocks[1];
    if (!editedBlock || !originalBlock) throw new Error('Missing fixture block');
    editedBlock.event = 'DENIED';
    const result = await inspectLedger(copy, original.checkpoint);
    expect(result).toMatchObject({ valid: false, check: 'BLOCK_HASH', block: 1, expected: originalBlock.hash });
    const { hash, ...body } = editedBlock;
    expect(result.actual).toBe(await digest(body));
    expect(result.actual).not.toBe(hash);
    const rehashed = await rehashLedgerCopy(copy);
    expect(await inspectLedger(rehashed, original.checkpoint)).toMatchObject({ valid: false, check: 'CHECKPOINT_HEAD' });
    expect(await inspectLedger(rehashed)).toMatchObject({ valid: false, check: 'SIGNATURE' });
    expect(JSON.stringify(original)).toBe(originalBytes);
    expect(await inspectLedger(structuredClone(original), original.checkpoint)).toEqual({ valid: true, check: 'VERIFIED' });
  });
  it('reports invalid editable block values without throwing', async () => {
    const ledger = new ActionLedger(); await ledger.append('RUN_STARTED');
    const proof = await ledger.proof();
    const invalid = { ...proof, blocks: [{ ...proof.blocks[0], hash: { invalid: true } }] };
    expect(await inspectLedger(invalid as unknown as LedgerProof, proof.checkpoint)).toMatchObject({ valid: false, check: 'INVALID' });
  });
  it("serializes concurrent events and verifies the signed checkpoint", async () => {
    const ledger = new ActionLedger();
    await Promise.all([
      ledger.append("RUN_STARTED"),
      ledger.append("AUTHORIZED", "TYPE_HANDLE"),
      ledger.append("EXECUTED", "TYPE_HANDLE"),
    ]);
    const proof = await ledger.proof();
    expect(await verifyLedger(proof)).toBe(true);
    expect(proof.blocks.map((b) => b.index)).toEqual([0, 1, 2]);
    expect(JSON.stringify(proof)).not.toMatch(
      /LOCAL_|traveller@|9000000000|privateKey/,
    );
  });
  it("detects edits, reorder, tail removal and rehashed replacement against retained checkpoint", async () => {
    const ledger = new ActionLedger();
    await ledger.append("RUN_STARTED");
    await ledger.append("BLOCKED", "TYPE_HANDLE");
    const proof = await ledger.proof();
    const edited = structuredClone(proof);
    const first = edited.blocks[0];
    if (!first) throw new Error("missing block");
    first.at += 1;
    expect(await verifyLedger(edited, proof.checkpoint)).toBe(false);
    const reordered = structuredClone(proof);
    reordered.blocks.reverse();
    expect(await verifyLedger(reordered, proof.checkpoint)).toBe(false);
    const truncated = structuredClone(proof);
    truncated.blocks.pop();
    expect(await verifyLedger(truncated, proof.checkpoint)).toBe(false);
    let previous = "0".repeat(64);
    for (const block of edited.blocks) {
      block.previous = previous;
      const body = {
        index: block.index,
        at: block.at,
        event: block.event,
        action: block.action,
        actionCommitment: block.actionCommitment,
        previous,
      };
      block.hash = await digest(body);
      previous = block.hash;
    }
    expect(await verifyLedger(edited, proof.checkpoint)).toBe(false);
    const forged = new ActionLedger();
    await forged.append("RUN_STARTED");
    await forged.append("EXECUTED", "TYPE_HANDLE");
    expect(await verifyLedger(await forged.proof(), proof.checkpoint)).toBe(
      false,
    );
  });
  it("rejects free-form metadata", () => {
    expect(() =>
      new ActionLedger().append("EXECUTED", "email@example.test"),
    ).toThrow("UNSAFE_LEDGER_METADATA");
  });
});
