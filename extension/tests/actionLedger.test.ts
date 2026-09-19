import { describe, expect, it } from "vitest";
import {
  ActionLedger,
  digest,
  verifyLedger,
} from "../lib/security/actionLedger";

describe("signed local action ledger", () => {
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
