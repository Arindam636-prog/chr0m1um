import { useMemo, useState } from 'react';
import { ArrowRightIcon as ArrowRight, EyeSlashIcon as EyeSlash, LockKeyIcon as LockKey, MonitorIcon as Monitor, CloudIcon as Cloud, ShieldCheckIcon as ShieldCheck } from '@phosphor-icons/react';
import type { PublicAgentState } from '../../lib/messaging/protocol';
import { deliveryLabel, readPrivacyPreview } from './proofModel';

const NAMES: Record<string, string> = { PERSON_NAME: 'Name', EMAIL: 'Email', PHONE: 'Phone', UPI_ID: 'UPI', PASSWORD: 'Password', FACE: 'Face', ADDRESS: 'Address', PRIVATE_DOCUMENT: 'Document' };

export function PrivacyProof({ agent, expanded = false }: { agent: PublicAgentState; expanded?: boolean }) {
  const [latest, setLatest] = useState(false);
  const preview = !latest && agent.proofPreview ? agent.proofPreview : agent.serverPreview;
  const context = useMemo(() => readPrivacyPreview(preview), [preview]);
  const evidence = !latest && agent.proofEvidence ? agent.proofEvidence : agent.privacyEvidence;
  const delivery = !latest && agent.proofDelivery ? agent.proofDelivery : agent.contextDelivery;
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
        <p>{!latest && agent.proofPreview ? 'Showing the first sanitized snapshot, retained locally for this explanation.' : 'Showing the latest sanitized snapshot.'} This view is not an independent network audit.</p>
        {agent.proofPreview && <button className="secondary" onClick={() => setLatest(!latest)}>{latest ? 'Show first snapshot' : 'Show latest snapshot'}</button>}
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
