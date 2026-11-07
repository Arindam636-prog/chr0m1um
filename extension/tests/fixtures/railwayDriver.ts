/** Isolated ordinary-HTTP integration harness. No extension is installed or contacted. */
import type { AgentAction, SanitizedContext } from '@contextshield/shared';
import { parseRailwayJourney, RAILWAY_TASK } from '@contextshield/shared/railway';
import { extractObservation, type PerceptionSnapshot } from '../../lib/perception/extractObservation';
import { LocalPrivacyPipeline } from '../../lib/privacy/pipeline';
import type { ContextualPiiScanner } from '../../lib/privacy/rampartScanner';
import { SecretVault } from '../../lib/vault/secretVault';
import { planRailwayRehearsal } from '../../lib/agent/railwayRehearsal';
import { DomActionBroker } from '../../lib/actions/broker';
import { privateFillGate } from '../../lib/security/privateFillGate';

const vault = new SecretVault();
vault.store('PERSON_NAME', 'Demo Traveller');
vault.store('EMAIL', 'traveller@example.test');
vault.store('PHONE', '9000000000');
let pipeline = new LocalPrivacyPipeline(vault);
export function useContextualScanner(scanner: ContextualPiiScanner) {
  pipeline = new LocalPrivacyPipeline(vault, scanner);
}
let observed: PerceptionSnapshot | null = null;
let pending: { action: AgentAction; context: SanitizedContext; local: PerceptionSnapshot } | null = null;
const observe = () => ({ ...extractObservation(), documentId: 'isolated-qa-document' });
const broker = new DomActionBroker(() => observed, observe);

export const defaultTask = RAILWAY_TASK;
export async function step(task = RAILWAY_TASK, confirmed = false) {
  let current = pending;
  if (!current) {
    observed = observe();
    const privacy = await pipeline.sanitize(observed, task);
    const action = planRailwayRehearsal(privacy.context, window.location.href, true, parseRailwayJourney(task), observed.observation);
    if (!action) throw new Error('No grounded action');
    current = { local: observed, context: privacy.context, action };
  }
  const { local, context, action } = current;
  const target = 'element_id' in action ? context.elements.find((el) => el.id === action.element_id)?.label : null;
  if (action.type === 'FINISH') return { action: action.type, target, complete: true };
  const validation = { origin: context.origin, snapshotId: context.snapshot_id, fingerprint: local.fingerprint, confirmedActionIds: new Set(confirmed ? [action.action_id] : []) };
  let resolvedValue: string | undefined;
  if (action.type === 'TYPE_HANDLE') {
    const release = await privateFillGate({ action, local, context, vault, run: 1, tab: 1, purpose: task, confirmed, current: () => true, preflight: () => broker.execute(action, { ...validation, preflight: true }) });
    if (release.error) { pending = current; return { action: action.type, target, error: release.error }; }
    resolvedValue = release.value;
  }
  const result = await broker.execute(action, { ...validation, resolvedValue });
  pending = result.error === 'CONFIRMATION_REQUIRED' ? current : null;
  const fresh = result.error === 'STALE_SNAPSHOT' ? observe() : null;
  const differences = fresh?.observation.elements.filter((el) => JSON.stringify(el) !== JSON.stringify(local.observation.elements.find((old) => old.id === el.id))).map((el) => ({ old: local.observation.elements.find((old) => old.id === el.id), new: el }));
  return { action: action.type, target, option: action.type === 'SELECT' ? action.option : null, ...result, ...(fresh ? { debug: { original: local.fingerprint, fresh: fresh.fingerprint, differences } } : {}) };
}
