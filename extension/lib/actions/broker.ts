import {
  AgentActionSchema,
  VerificationResultSchema,
  type AgentAction,
  type VerificationResult,
} from '@contextshield/shared';

import type { PerceptionSnapshot } from '../perception/extractObservation';

const HIGH_RISK_TEXT = /\b(pay|purchase|buy|order|place order|submit|send|transfer|delete|remove|confirm|book|sign|agree)\b/i;

export interface ActionValidationContext {
  snapshotId: string;
  origin: string;
  fingerprint: string;
  resolvedValue?: string;
  confirmedActionIds: ReadonlySet<string>;
}

export interface ActionBroker {
  execute(action: AgentAction, context: ActionValidationContext): Promise<VerificationResult>;
}

function result(
  actionId: string,
  success: boolean,
  pageChanged: boolean,
  newSnapshotRequired: boolean,
  error: VerificationResult['error'],
): VerificationResult {
  return VerificationResultSchema.parse({
    action_id: actionId,
    success,
    page_changed: pageChanged,
    new_snapshot_required: newSnapshotRequired,
    error,
  });
}

function visible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    !element.hidden
  );
}

function enabled(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return false;
  return !(
    'disabled' in element &&
    (element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement).disabled
  );
}

function riskText(element: HTMLElement): string {
  return [
    element.innerText,
    element.textContent,
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('value'),
  ]
    .filter(Boolean)
    .join(' ');
}

function isHighRisk(action: AgentAction, element: HTMLElement | undefined): boolean {
  if (action.type === 'TYPE_HANDLE') {
    return element instanceof HTMLInputElement && element.type === 'password';
  }
  if (action.type !== 'CLICK' || !element) return false;
  return HIGH_RISK_TEXT.test(riskText(element));
}

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.bind(element);
  if (!setter) throw new Error('Input value setter is unavailable');
  setter(value);
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function executeClick(element: HTMLElement): void {
  const clickable =
    element instanceof HTMLButtonElement ||
    element instanceof HTMLAnchorElement ||
    element instanceof HTMLInputElement ||
    element.tagName === 'SUMMARY' ||
    [
      'button',
      'link',
      'checkbox',
      'radio',
      'switch',
      'tab',
      'menuitem',
      'option',
      'combobox',
      'treeitem',
    ].includes(element.getAttribute('role') ?? '');
  if (!clickable) throw new Error('Element is not an allowed click target');
  element.focus();
  element.click();
}

function executeType(element: HTMLElement, value: string): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.readOnly) throw new Error('Input is read-only');
    setInputValue(element, value);
    element.focus();
    return;
  }
  if (element.isContentEditable) {
    element.focus();
    element.textContent = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    return;
  }
  throw new Error('Element cannot receive text');
}

function executeSelect(element: HTMLElement, option: string): void {
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error('Element is not a select control');
  }
  const match = Array.from(element.options).find(
    (candidate) => candidate.value === option || candidate.text.trim() === option,
  );
  if (!match) throw new Error('Requested option does not exist');
  element.value = match.value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Executes only schema-valid, element-ID-based actions against the observed snapshot. */
export class DomActionBroker implements ActionBroker {
  constructor(
    private readonly getObservedSnapshot: () => PerceptionSnapshot | null,
    private readonly observeFresh: () => PerceptionSnapshot,
    private readonly buttonVerificationTimeoutMs = 1_500,
  ) {}

  private async waitForFingerprintChange(initialFingerprint: string): Promise<boolean> {
    const deadline = performance.now() + this.buttonVerificationTimeoutMs;
    if (this.observeFresh().fingerprint !== initialFingerprint) return true;
    while (performance.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      if (this.observeFresh().fingerprint !== initialFingerprint) return true;
    }
    return false;
  }

  async execute(
    untrustedAction: AgentAction,
    context: ActionValidationContext,
  ): Promise<VerificationResult> {
    await Promise.resolve();
    const parsed = AgentActionSchema.safeParse(untrustedAction);
    if (!parsed.success) {
      return result(untrustedAction.action_id, false, false, false, 'INVALID_AGENT_ACTION');
    }
    const action = parsed.data;
    if (action.snapshot_id !== context.snapshotId) {
      return result(action.action_id, false, false, true, 'STALE_SNAPSHOT');
    }
    if (window.location.origin !== context.origin) {
      return result(action.action_id, false, false, true, 'STALE_SNAPSHOT');
    }

    const observed = this.getObservedSnapshot();
    if (!observed || observed.observation.snapshot_id !== context.snapshotId) {
      return result(action.action_id, false, false, true, 'STALE_SNAPSHOT');
    }
    const fresh = this.observeFresh();
    if (fresh.fingerprint !== context.fingerprint) {
      return result(action.action_id, false, false, true, 'STALE_SNAPSHOT');
    }

    if (action.type === 'ASK_USER' || action.type === 'FINISH') {
      return result(action.action_id, true, false, false, null);
    }
    if (action.type === 'SCROLL') {
      const before = window.scrollY;
      window.scrollBy({
        top: action.direction === 'DOWN' ? action.amount : -action.amount,
        behavior: 'instant',
      });
      return result(action.action_id, true, window.scrollY !== before, true, null);
    }

    const element = observed.elementIndex.get(action.element_id);
    if (!element || !element.isConnected) {
      return result(action.action_id, false, false, true, 'ELEMENT_NOT_FOUND');
    }
    if (!visible(element) || !enabled(element)) {
      return result(action.action_id, false, false, true, 'ACTION_FAILED');
    }
    if (isHighRisk(action, element) && !context.confirmedActionIds.has(action.action_id)) {
      return result(action.action_id, false, false, false, 'CONFIRMATION_REQUIRED');
    }

    try {
      if (action.type === 'CLICK') executeClick(element);
      if (action.type === 'TYPE_HANDLE') {
        if (context.resolvedValue === undefined) throw new Error('Local handle did not resolve');
        executeType(element, context.resolvedValue);
      }
      if (action.type === 'SELECT') executeSelect(element, action.option);
      let changed = this.observeFresh().fingerprint !== fresh.fingerprint;
      // React and other SPA frameworks often commit a modal or success state on
      // the next event-loop/render turn. A synchronous check incorrectly marked
      // valid Submit clicks as failures before that state existed.
      if (action.type === 'CLICK' && element instanceof HTMLButtonElement && !changed) {
        changed = await this.waitForFingerprintChange(fresh.fingerprint);
      }
      if (action.type === 'CLICK' && element instanceof HTMLButtonElement && !changed) {
        return result(action.action_id, false, false, true, 'VERIFICATION_FAILED');
      }
      return result(action.action_id, true, changed, true, null);
    } catch {
      return result(action.action_id, false, false, true, 'ACTION_FAILED');
    }
  }
}
