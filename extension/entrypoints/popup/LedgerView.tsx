import { useState } from "react";
import type { AgentCommandResponse } from "../../lib/messaging/protocol";
import {
  verifyLedger,
  type LedgerProof,
} from "../../lib/security/actionLedger";

export function LedgerView({ running }: { running: boolean }) {
  const [proof, setProof] = useState<LedgerProof | null>(null);
  const [message, setMessage] = useState(
    "Load the current session’s evidence after a run.",
  );
  async function load() {
    const reply: AgentCommandResponse = await browser.runtime.sendMessage({
      type: "GET_LEDGER",
    });
    const current = reply.state.ledger;
    if (!current) return;
    setProof(current);
    setMessage(
      (await verifyLedger(current))
        ? "Verified: every block and the signed checkpoint match."
        : "Verification failed. Do not trust this evidence.",
    );
  }
  async function tamper() {
    if (!proof?.blocks.length) return;
    const changed = structuredClone(proof);
    const first = changed.blocks[0];
    if (!first) return;
    first.at += 1;
    setMessage(
      (await verifyLedger(changed, proof.checkpoint))
        ? "Unexpected result: modified copy verified."
        : "Tampering detected: the edited copy does not match the signed checkpoint. Original evidence is unchanged.",
    );
  }
  function download() {
    if (!proof) return;
    const blob = URL.createObjectURL(
      new Blob([JSON.stringify(proof, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = blob;
    link.download = "contextshield-action-ledger.json";
    link.click();
    URL.revokeObjectURL(blob);
  }
  return (
    <section className="ledger-view">
      <h2>Action ledger</h2>
      <p>
        SHA-256-linked blocks, with a P-256 signed checkpoint. Private values,
        tasks and secret handles are not stored in these blocks.
      </p>
      <div className="actions">
        <button
          className="primary"
          disabled={running}
          onClick={() => void load()}
        >
          Verify current ledger
        </button>
        <button
          className="secondary"
          disabled={!proof?.blocks.length || running}
          onClick={() => void tamper()}
        >
          Tamper with a copy
        </button>
      </div>
      <p className="result" role="status">
        {message}
      </p>
      {proof && (
        <>
          <p>
            {proof.blocks.length} blocks · Session {proof.session.slice(0, 8)}
          </p>
          <ol className="ledger-blocks">
            {proof.blocks.map((block) => (
              <li key={block.hash}>
                <strong>
                  #{block.index} · {block.event}
                </strong>
                <span>{block.action}</span>
                <code>
                  {block.previous.slice(0, 10)} → {block.hash.slice(0, 14)}
                </code>
              </li>
            ))}
          </ol>
          <button className="secondary" onClick={download}>
            Export signed evidence
          </button>
        </>
      )}
      <p className="hint">
        This is a single-device, session-only audit chain—not a distributed
        blockchain. Keep the exported public key and checkpoint independently if
        you need to detect later replacement or truncation. A compromised
        extension can create new evidence. The local gate enforces safety; the
        chain records it.
      </p>
    </section>
  );
}
