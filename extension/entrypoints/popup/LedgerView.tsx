import { useState } from 'react';
import type { AgentCommandResponse } from '../../lib/messaging/protocol';
import { inspectLedger, rehashLedgerCopy, type LedgerInspection, type LedgerProof } from '../../lib/security/actionLedger';

function Inspection({ report }: { report: LedgerInspection }) {
  return <div className={`result ${report.valid ? 'success-result' : 'error-result'}`} role="status">
    <strong>{report.valid ? 'Verified' : 'Tampering detected / verification failed'} · {report.check}</strong>
    {report.block !== undefined && <p>First failure: block #{report.block}</p>}
    {report.expected !== undefined && <><p>Expected / retained value</p><code>{report.expected}</code><p>Actual / recomputed value</p><code>{report.actual}</code></>}
    <p>{report.check === 'BLOCK_HASH' ? 'SHA-256 of the edited block no longer matches its recorded hash.' : report.check === 'CHECKPOINT_HEAD' || report.check === 'CHAIN_HEAD' ? 'The recalculated chain no longer matches the retained signed checkpoint. Rehashing cannot sign a replacement.' : report.valid ? 'All block links, contents and the P-256 checkpoint signature passed.' : 'Do not trust the modified evidence.'}</p>
  </div>;
}

export function LedgerView({ running }: { running: boolean }) {
  const [proof, setProof] = useState<LedgerProof | null>(null);
  const [copy, setCopy] = useState<LedgerProof | null>(null);
  const [report, setReport] = useState<LedgerInspection | null>(null);
  const [copyReport, setCopyReport] = useState<LedgerInspection | null>(null);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setBusy(true); setError('');
    try {
      const reply: AgentCommandResponse = await browser.runtime.sendMessage({ type: 'GET_LEDGER' });
      if (!reply.ok || !reply.state.ledger) throw new Error('No ledger available. Complete a run first.');
      const current = reply.state.ledger;
      setProof(current); setCopy(null); setCopyReport(null); setIndex(0);
      setReport(await inspectLedger(current));
    } catch { setError('Could not load the current ledger. Try again after the run.'); }
    finally { setBusy(false); }
  }
  async function tamper() {
    if (!proof?.blocks.length) return;
    const changed = structuredClone(proof);
    const first = changed.blocks[0];
    if (!first) return;
    first.at += 1;
    setIndex(0); setCopy(changed);
    setDraft(JSON.stringify(changed.blocks[0], null, 2));
    setCopyReport(await inspectLedger(changed, proof.checkpoint));
  }
  async function checkEdit() {
    if (!proof || !copy) return;
    setError(''); setBusy(true);
    try {
      const block: unknown = JSON.parse(draft);
      if (!block || typeof block !== 'object' || Array.isArray(block)) throw new Error('Invalid block');
      const changed = structuredClone(copy);
      changed.blocks[index] = block as LedgerProof['blocks'][number];
      setCopy(changed); setCopyReport(await inspectLedger(changed, proof.checkpoint));
    } catch { setError('Enter a JSON object for this block. No evidence was changed.'); }
    finally { setBusy(false); }
  }
  async function rehash() {
    if (!proof || !copy) return;
    setBusy(true); setError('');
    try {
      const changed = await rehashLedgerCopy(copy);
      setCopy(changed); setDraft(JSON.stringify(changed.blocks[index], null, 2));
      setCopyReport(await inspectLedger(changed, proof.checkpoint));
    } catch { setError('The modified block could not be rehashed. Restore the original copy.'); }
    finally { setBusy(false); }
  }
  function download(value: LedgerProof, name: string) {
    const blob = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = blob; link.download = name; link.click(); URL.revokeObjectURL(blob);
  }
  return <section className="ledger-view">
    <h2>Action ledger</h2>
    <p>SHA-256-linked events, sealed by a P-256 signed checkpoint. Test the evidence itself; private values are never stored in these blocks.</p>
    <div className="actions"><button className="primary" disabled={running || busy} onClick={() => void load()}>Verify current ledger</button><button className="secondary" disabled={!proof?.blocks.length || running || busy} onClick={() => void tamper()}>Tamper with a copy</button></div>
    {error && <p role="alert">{error}</p>}
    {!proof && <p>Load the current session’s evidence after a run.</p>}
    {report && <Inspection report={report} />}
    {proof && <>
      <p>{proof.blocks.length} blocks · Session <code>{proof.session.slice(0, 8)}</code></p>
      {copy && <section className="tamper-lab">
        <h3>Edit evidence. Re-run the verifier.</h3>
        <p>The button changed block #0’s timestamp by 1 ms in a disposable copy. You can make your own edit below. The original and its trusted checkpoint stay unchanged.</p>
        <label>Choose block<select disabled={busy} value={index} onChange={(e) => { const next = Number(e.target.value); setIndex(next); setDraft(JSON.stringify(copy.blocks[next], null, 2)); setCopyReport(null); }}>{copy.blocks.map((_, i) => <option key={i} value={i}>Block #{i} · {proof.blocks[i]?.event}</option>)}</select></label>
        <details><summary>Original block · unchanged</summary><pre>{JSON.stringify(proof.blocks[index], null, 2)}</pre></details>
        <label>Editable copy · block JSON<textarea className="evidence-editor" spellCheck={false} value={draft} onChange={(e) => { setDraft(e.target.value); setCopyReport(null); }} /></label>
        <div className="actions"><button className="primary" disabled={busy} onClick={() => void checkEdit()}>Verify my edit</button><button className="secondary" disabled={busy} onClick={() => { const restored = structuredClone(proof); setCopy(restored); setDraft(JSON.stringify(restored.blocks[index], null, 2)); setCopyReport(null); setError(''); }}>Restore original copy</button></div>
        {copyReport && <Inspection report={copyReport} />}
        <details><summary>Can recomputing the hashes hide the edit?</summary><p>First verify your edit. This recalculates every hash in the checked copy, but keeps the original checkpoint signature and trusted head.</p><button className="secondary" disabled={busy || !copyReport} onClick={() => void rehash()}>Rehash copy and verify</button></details>
        <button className="secondary" onClick={() => download(copy, 'contextshield-modified-copy.json')}>Export checked copy</button>
      </section>}
      <details><summary>Retained signed checkpoint</summary><pre>{JSON.stringify(proof.checkpoint, null, 2)}</pre></details>
      <ol className="ledger-blocks">{proof.blocks.map((block) => <li key={block.hash}><strong>#{block.index} · {block.event}</strong><span>{block.action}</span><code>{block.previous.slice(0, 10)} → {block.hash.slice(0, 14)}</code></li>)}</ol>
      <button className="secondary" onClick={() => download(proof, 'contextshield-action-ledger.json')}>Export signed evidence</button>
    </>}
    <p className="hint">Single-device, session-only audit chain—not a distributed blockchain or an injection detector. Keep the exported public key and checkpoint independently to detect replacement. A compromised extension can create new evidence. The local gate enforces safety; the chain records it.</p>
  </section>;
}
