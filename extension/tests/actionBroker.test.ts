// @vitest-environment happy-dom

import type { AgentAction, PageObservation } from '@contextshield/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { DomActionBroker } from '../lib/actions/broker';
import type { PerceptionSnapshot } from '../lib/perception/extractObservation';

function rect(): DOMRect {
  return { x: 0, y: 0, width: 120, height: 32, top: 0, right: 120, bottom: 32, left: 0, toJSON: () => ({}) };
}

function makeSnapshot(element: HTMLElement, id = 'el_1'): PerceptionSnapshot {
  element.getBoundingClientRect = rect;
  const observation: PageObservation = {
    snapshot_id: 'snap_1',
    origin: window.location.origin,
    url: window.location.href,
    viewport: { width: 800, height: 600 },
    elements: [
      {
        id,
        role: element instanceof HTMLButtonElement ? 'button' : 'textbox',
        tag: element.tagName.toLowerCase(),
        text: element instanceof HTMLButtonElement ? element.textContent : null,
        label: null,
        input_type: element instanceof HTMLInputElement ? element.type : null,
        bbox: { x: 0, y: 0, width: 120, height: 32 },
        visible: true,
        enabled: true,
        selected: null,
        value_present: false,
        options: [],
        selected_option: null,
        control_value: null,
        dom_index: 0,
      },
    ],
    visual_regions: [],
    timestamp: 1,
  };
  return {
    observation,
    privateValues: [],
    visualHints: [],
    ocrHints: [],
    safeVisualCrops: [],
    fingerprint: 'fp_1',
    elementIndex: new Map([[id, element]]),
  };
}

describe('DOM action broker', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('resolves and types a local value without accepting model-generated text', async () => {
    const input = document.createElement('input');
    document.body.append(input);
    const snapshot = makeSnapshot(input);
    const action: AgentAction = {
      type: 'TYPE_HANDLE',
      action_id: 'act_1',
      snapshot_id: 'snap_1',
      element_id: 'el_1',
      handle: 'LOCAL_EMAIL_1',
      reason: 'Fill the local email handle',
    };
    const broker = new DomActionBroker(() => snapshot, () => snapshot, 0);
    const result = await broker.execute(action, {
      snapshotId: 'snap_1',
      origin: window.location.origin,
      fingerprint: 'fp_1',
      resolvedValue: 'private@example.com',
      confirmedActionIds: new Set(),
    });

    expect(result.success).toBe(true);
    expect(input.value).toBe('private@example.com');
  });

  it('rejects a stale fingerprint before touching the page', async () => {
    const button = document.createElement('button');
    button.textContent = 'Continue';
    document.body.append(button);
    const snapshot = makeSnapshot(button);
    const fresh = { ...snapshot, fingerprint: 'fp_changed' };
    let clicked = false;
    button.addEventListener('click', () => { clicked = true; });
    const broker = new DomActionBroker(() => snapshot, () => fresh);
    const result = await broker.execute(
      { type: 'CLICK', action_id: 'act_2', snapshot_id: 'snap_1', element_id: 'el_1', reason: 'Continue' },
      {
        snapshotId: 'snap_1',
        origin: window.location.origin,
        fingerprint: 'fp_1',
        confirmedActionIds: new Set(),
      },
    );
    expect(result.error).toBe('STALE_SNAPSHOT');
    expect(clicked).toBe(false);
  });

  it('rejects a button click with no observable page effect', async () => {
    const button = document.createElement('button');
    button.textContent = 'Continue';
    document.body.append(button);
    const snapshot = makeSnapshot(button);
    const broker = new DomActionBroker(() => snapshot, () => snapshot, 0);
    const result = await broker.execute(
      {
        type: 'CLICK',
        action_id: 'act_noop',
        snapshot_id: 'snap_1',
        element_id: 'el_1',
        reason: 'Continue',
      },
      {
        snapshotId: 'snap_1',
        origin: window.location.origin,
        fingerprint: 'fp_1',
        confirmedActionIds: new Set(),
      },
    );

    expect(result.success).toBe(false);
    expect(result.page_changed).toBe(false);
    expect(result.error).toBe('VERIFICATION_FAILED');
  });

  it('accepts a button whose SPA result appears after the click handler returns', async () => {
    const button = document.createElement('button');
    button.textContent = 'Submit';
    document.body.append(button);
    const snapshot = makeSnapshot(button);
    let current = snapshot;
    button.addEventListener('click', () => {
      setTimeout(() => {
        current = { ...snapshot, fingerprint: 'fp_modal_visible' };
      }, 20);
    });
    const broker = new DomActionBroker(() => snapshot, () => current, 250);
    const result = await broker.execute(
      {
        type: 'CLICK',
        action_id: 'act_submit',
        snapshot_id: 'snap_1',
        element_id: 'el_1',
        reason: 'Submit the completed form',
      },
      {
        snapshotId: 'snap_1',
        origin: window.location.origin,
        fingerprint: 'fp_1',
        confirmedActionIds: new Set(['act_submit']),
      },
    );

    expect(result.success).toBe(true);
    expect(result.page_changed).toBe(true);
    expect(result.error).toBeNull();
  });

  it('requires a one-action confirmation for consequential clicks', async () => {
    const button = document.createElement('button');
    button.textContent = 'Place order';
    document.body.append(button);
    const snapshot = makeSnapshot(button);
    const action: AgentAction = {
      type: 'CLICK',
      action_id: 'act_pay',
      snapshot_id: 'snap_1',
      element_id: 'el_1',
      reason: 'Complete the purchase',
    };
    const broker = new DomActionBroker(() => snapshot, () => snapshot);
    const blocked = await broker.execute(action, {
      snapshotId: 'snap_1',
      origin: window.location.origin,
      fingerprint: 'fp_1',
      confirmedActionIds: new Set(),
    });
    expect(blocked.error).toBe('CONFIRMATION_REQUIRED');
  });

  it('clicks the visible label for a visually hidden radio control', async () => {
    const input = document.createElement('input');
    input.type = 'radio';
    input.id = 'hidden-radio';
    input.style.opacity = '0';
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.textContent = 'Male';
    document.body.append(input, label);
    const snapshot = makeSnapshot(input);
    input.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      top: 0,
      right: 1,
      bottom: 1,
      left: 0,
      toJSON: () => ({}),
    });
    label.getBoundingClientRect = rect;
    let current = snapshot;
    input.addEventListener('change', () => {
      current = { ...snapshot, fingerprint: 'fp_radio_checked' };
    });
    const broker = new DomActionBroker(() => snapshot, () => current, 0);
    const result = await broker.execute(
      {
        type: 'CLICK',
        action_id: 'act_hidden_radio',
        snapshot_id: 'snap_1',
        element_id: 'el_1',
        reason: 'Select Male',
      },
      {
        snapshotId: 'snap_1',
        origin: window.location.origin,
        fingerprint: 'fp_1',
        confirmedActionIds: new Set(),
      },
    );

    expect(result.success).toBe(true);
    expect(input.checked).toBe(true);
  });
});
