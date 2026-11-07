import { useMemo, useState } from 'react';
import { ArrowRightIcon as ArrowRight, EyeSlashIcon as EyeSlash, LockKeyIcon as LockKey, MonitorIcon as Monitor, CloudIcon as Cloud, ShieldCheckIcon as ShieldCheck } from '@phosphor-icons/react';
import type { PublicAgentState } from '../../lib/messaging/protocol';
import { deliveryLabel, readPrivacyPreview } from './proofModel';

const NAMES: Record<string, string> = { PERSON_NAME: 'Name', EMAIL: 'Email', PHONE: 'Phone', UPI_ID: 'UPI', PASSWORD: 'Password', FACE: 'Face', ADDRESS: 'Address', PRIVATE_DOCUMENT: 'Document' };

export function PrivacyProof({ agent, expanded = false }: { agent: PublicAgentState; expanded?: boolean }) {
  const [selection, setSelection] = useState<'auto' | 'visual' | 'first' | 'planner' | 'latest'>('auto');
  const snapshot = selection === 'auto' ? (agent.visualProofPreview ? 'visual' : agent.plannerPreview ? 'planner' : 'first') : selection;
  const preview = snapshot === 'visual' ? agent.visualProofPreview ?? null : snapshot === 'planner' ? agent.plannerPreview ?? null : snapshot === 'first' && agent.proofPreview ? agent.proofPreview : agent.serverPreview;
  const context = useMemo(() => readPrivacyPreview(preview), [preview]);
  const evidence = snapshot === 'visual' ? agent.visualProofEvidence : snapshot === 'planner' ? agent.plannerEvidence : snapshot === 'first' && agent.proofEvidence ? agent.proofEvidence : agent.privacyEvidence;
  const delivery = snapshot === 'visual' ? agent.visualProofDelivery : snapshot === 'planner' ? agent.plannerDelivery : snapshot === 'first' && agent.proofDelivery ? agent.proofDelivery : agent.contextDelivery;
  const counts = evidence?.uniqueItems ?? context?.privacy_summary ?? {};
  const reviews = evidence?.reviewItems ?? {};
  const supported = Object.entries(counts).filter(([type, count]) => count > (reviews[type as keyof typeof reviews] ?? 0));
  const reviewCount = Object.values(reviews).reduce((sum, count) => sum + count, 0);
  const hits = Object.values(evidence?.detectorHits ?? {}).reduce((sum, count) => sum + count, 0);
  const items = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const crop = context?.safe_visual_crops[0];
  const controls = context?.elements.filter((element) => element.enabled && (element.options.length > 0 || ['button', 'textbox', 'checkbox', 'radio'].includes(element.role))) ?? [];

  return <section className={`privacy-proof ${expanded ? 'expanded-proof' : ''}`} aria-label="Visual privacy proof">
    <div className="proof-heading"><div><span className="eyebrow">The privacy boundary</span><h2>What stays here.<br />What goes to the AI.</h2></div><ShieldCheck size={38} weight="duotone" aria-hidden="true" /></div>
    <div className="proof-receipt" role="status"><Cloud size={18} aria-hidden="true" /><div><strong>{deliveryLabel(delivery)}</strong><small>{agent.contextDelivery?.requests ?? 0} context request attempts this run</small></div></div>
    <label className="proof-snapshot">Inspect snapshot<select value={selection} onChange={(e) => setSelection(e.target.value as typeof selection)}><option value="auto">Retained visual evidence when available</option><option value="visual" disabled={!agent.visualProofPreview}>Face-redacted observation</option><option value="first">First local observation</option><option value="planner" disabled={!agent.plannerPreview}>Latest server-planned step</option><option value="latest">Latest local observation</option></select></label>
    {agent.rehearsal && <p className="review-note">Local rehearsal has vision and Qwen disabled. No face-redaction or model-injection result is claimed in this mode.</p>}
    {agent.injectionEvidence && <section className="injection-evidence" aria-label="Prompt injection evidence">
      <h3>Prompt injection · observed result</h3>
      <p>{deliveryLabel(agent.injectionEvidence.delivery)} · Snapshot <code>{agent.injectionEvidence.snapshotId}</code></p>
      <strong>Sanitized page instruction in that request</strong>
      <blockquote>{agent.injectionEvidence.instruction}</blockquote>
      <p>Requested destination: <code>{agent.injectionEvidence.targetId ?? 'No notes target observed'}</code></p>
      <p role="status">{agent.injectionEvidence.outcome === 'FARE_ACTION_RETURNED' ? 'The Qwen service returned a train-selection action, not a private fill. No local gate rejection was needed for this response.' : agent.injectionEvidence.outcome === 'OUT_OF_SCOPE_BLOCKED' ? 'The service returned an out-of-scope action. The local railway scope check blocked it before execution.' : 'No usable model response recorded yet. No pass/fail claim.'}</p>
      {agent.injectionEvidence.returnedType && <code>{agent.injectionEvidence.returnedType} → {agent.injectionEvidence.returnedTarget ?? 'no target'}</code>}
      <p>This shows the service’s validated action, not raw model output or universal injection resistance. Select “Latest server-planned step” to inspect the complete sanitized request. Acknowledgement records a server response, not an independent network audit.</p>
    </section>}
    {!context ? <div className="proof-empty"><EyeSlash size={32} aria-hidden="true" /><h3>{preview ? 'Preview unavailable' : 'Your next run appears here'}</h3><p>{preview ? 'The preview could not be validated, so it is not displayed.' : 'Run a task on a test website, then return here to see what was protected.'}</p></div> : <>
      <div className="boundary-grid">
        <article className="stays-local"><h3><Monitor size={20} aria-hidden="true" /> Kept on this device</h3><p>The originals behind these detections are not part of the sanitized context.</p>
          <div className="protected-items">{supported.map(([type, count]) => <div key={type}><EyeSlash size={17} aria-hidden="true" /><strong>{NAMES[type] ?? type.toLowerCase().replaceAll('_', ' ')}</strong><span>{count - (reviews[type as keyof typeof reviews] ?? 0)} hidden</span></div>)}</div>
          {supported.length === 0 && <p>No supported sensitive-item groups in this snapshot.</p>}
          {reviewCount > 0 && <p className="review-note">{reviewCount} other possible {reviewCount === 1 ? 'item was' : 'items were'} also masked conservatively. See detection details.</p>}
          <div className="local-rule"><LockKey size={17} aria-hidden="true" /><span>Raw screenshot and secret-vault values stay local.</span></div>
        </article>
        <article className="allowed-view"><h3><Cloud size={20} aria-hidden="true" /> Allowed through</h3>
          {crop ? <figure className="redacted-image"><img src={`data:${crop.mime_type};base64,${crop.data_base64}`} alt="Actual sanitized image crop after local redaction" /><figcaption>Actual image after local redaction</figcaption></figure> : <div className="no-image"><EyeSlash size={26} aria-hidden="true" /><p>No image was included in this snapshot.</p></div>}
          <p>Page structure, sanitized text and {context.safe_visual_crops.length > 0 ? 'checked image crops' : 'no image data'}. Not an original screen recording.</p>
          <div className="safe-controls">{controls.slice(0, expanded ? 4 : 2).map((element) => <div key={element.id}><span>{element.input_type || element.role}</span><strong>{element.label || element.text || 'Unlabelled control'}</strong>{element.value_handle && <code>{element.value_handle}</code>}{element.options.length > 0 && <small>{element.options.join(' / ')}</small>}</div>)}</div>
        </article>
      </div>
      <div className="proof-outcome"><ShieldCheck size={22} aria-hidden="true" /><span>{agent.verifiedActions ?? 0} browser actions checked</span><ArrowRight aria-hidden="true" /><strong>{agent.phase === 'COMPLETE' ? 'Task complete' : agent.running ? 'Task in progress' : 'See task result'}</strong></div>
      <details className="technical-details"><summary>Detection details and exact server context</summary>
        <p>Repeated detections are grouped by local value or visual detection identity. Counts are detection groups, not unique people or accuracy scores. {hits} detector hits became {items} groups. Uncorroborated language-model or OCR detections and low-confidence findings remain marked for review, without weakening masking.</p>
        <p>Showing the {snapshot === 'visual' ? 'retained face-redacted' : snapshot === 'first' ? 'first local' : snapshot === 'planner' ? 'latest server-planned' : 'latest local'} sanitized snapshot. Snapshot ID: <code>{context.snapshot_id}</code>. This view is retained on device, not an independent network audit.</p>
        <dl className="detection-detail">{Object.entries(counts).map(([type, count]) => <div key={type}><dt>{NAMES[type] ?? type}</dt><dd>{count} groups / {evidence?.detectorHits[type as keyof typeof counts] ?? count} hits{reviews[type as keyof typeof reviews] ? ` / ${reviews[type as keyof typeof reviews]} to review` : ''}</dd></div>)}</dl>
        <h4>Sanitized task</h4><p>{context.task}</p><h4>Site origin</h4><p>{context.origin}</p>
        <ul className="proof-elements">{context.elements.map((element) => <li key={element.id}><strong>{element.label || element.text || element.role}</strong><small>{element.id} / {element.role}</small>{element.text && element.text !== element.label && <p>{element.text}</p>}{element.value_handle && <code>{element.value_handle}</code>}{element.options.length > 0 && <p>{element.options.join(' / ')}</p>}{element.selected !== null && <p>{element.selected ? 'Selected' : 'Not selected'}</p>}{element.selected_option && <p>Selected: {element.selected_option}</p>}{element.control_value && <p>Value: {element.control_value}</p>}</li>)}</ul>
        {context.safe_visual_crops.slice(1).map((image) => <img className="extra-crop" key={image.id} src={`data:${image.mime_type};base64,${image.data_base64}`} alt="Additional sanitized image crop" />)}
        <details><summary>Sanitized JSON</summary><pre>{preview}</pre></details>
        <p>Planner: {delivery?.endpoint ?? 'not contacted'}. Health checks and action verification are separate from the context request counter.</p>
      </details>
    </>}
  </section>;
}
