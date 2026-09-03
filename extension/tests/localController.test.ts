import type { SanitizedContext, SanitizedElement } from '@contextshield/shared';
import { describe, expect, it } from 'vitest';

import { planLocalAction } from '../lib/agent/localController';

function element(overrides: Partial<SanitizedElement> & Pick<SanitizedElement, 'id' | 'role'>): SanitizedElement {
  return {
    text: null,
    label: null,
    input_type: null,
    value_handle: null,
    enabled: true,
    selected: null,
    value_present: false,
    options: [],
    selected_option: null,
    control_value: null,
    dom_index: 0,
    bbox: null,
    sources: ['DOM'],
    ...overrides,
  };
}

function context(task: string, elements: SanitizedElement[]): SanitizedContext {
  return {
    task,
    origin: 'https://example.com',
    snapshot_id: 'snap_local_1',
    elements,
    safe_visual_crops: [],
    privacy_summary: {},
  };
}

describe('local controller', () => {
  it('fills exact local handles without asking the server', () => {
    const action = planLocalAction(context(
      'Fill email LOCAL_EMAIL_1.',
      [element({ id: 'el_email', role: 'textbox', label: 'Email', value_handle: 'LOCAL_EMAIL_1' })],
    ));
    expect(action).toMatchObject({ type: 'TYPE_HANDLE', element_id: 'el_email', handle: 'LOCAL_EMAIL_1' });
  });

  it('fills a labelled generic text fixture through a local handle', () => {
    const action = planLocalAction(context(
      'Fill the text input with LOCAL_TEXT_1 and do not submit.',
      [element({
        id: 'el_text',
        role: 'textbox',
        label: 'Text input',
        input_type: 'text',
        value_handle: 'LOCAL_TEXT_1',
      })],
    ));
    expect(action).toMatchObject({ type: 'TYPE_HANDLE', element_id: 'el_text', handle: 'LOCAL_TEXT_1' });
  });

  it('grounds select, ordinal, and named control tasks locally', () => {
    const elements = [
      element({ id: 'el_select', role: 'combobox', options: ['JAVA', 'Python'], selected_option: 'JAVA' }),
      element({ id: 'el_one', role: 'checkbox', label: 'Option 1', selected: false, dom_index: 1 }),
      element({ id: 'el_two', role: 'checkbox', label: 'Option 2', selected: false, dom_index: 2 }),
      element({ id: 'el_blue', role: 'radio', label: 'Blue', selected: false, dom_index: 3 }),
    ];
    expect(planLocalAction(context('Select Python, select the second checkbox, and select Blue.', elements))).toMatchObject({ type: 'SELECT', option: 'Python' });
    const select = elements[0];
    const second = elements[2];
    const blue = elements[3];
    if (!select || !second || !blue) throw new Error('fixture incomplete');
    elements[0] = { ...select, selected_option: 'Python' };
    expect(planLocalAction(context('Select Python, select the second checkbox, and select Blue.', elements))).toMatchObject({ type: 'CLICK', element_id: 'el_two' });
    elements[2] = { ...second, selected: true };
    expect(planLocalAction(context('Select Python, select the second checkbox, and select Blue.', elements))).toMatchObject({ type: 'CLICK', element_id: 'el_blue' });
    elements[3] = { ...blue, selected: true };
    expect(planLocalAction(context('Select Python, select the second checkbox, and select Blue.', elements))?.type).toBe('FINISH');
  });

  it('routes reasoning-heavy tasks to the server', () => {
    expect(planLocalAction(context('Compare these products and choose the best one.', []))).toBeNull();
  });

  it('creates a safe screen summary entirely locally', () => {
    const action = planLocalAction(context('Summarize what is visible on this page.', [
      element({ id: 'el_continue', role: 'button', text: 'Continue' }),
      element({ id: 'el_visual', role: 'visual_text', text: 'Public heading', sources: ['OCR'], bbox: { x: 1, y: 2, width: 30, height: 10 } }),
    ]));
    expect(action).toMatchObject({ type: 'FINISH' });
    if (action?.type === 'FINISH') expect(action.summary).toContain('pixel-derived');
  });
});
