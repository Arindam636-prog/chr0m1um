import { describe, expect, it } from 'vitest';
import { privateInputMasks } from '../lib/privacy/inputMasks';
import type { PageElement } from '@contextshield/shared';

const input: PageElement = { id: 'el_1', role: 'textbox', tag: 'input', text: null, label: 'First name', input_type: 'text', bbox: { x: 10, y: 20, width: 200, height: 40 }, visible: true, enabled: true, selected: null, value_present: true, options: [], selected_option: null, control_value: null, dom_index: 0 };

describe('private input pixel masks', () => {
  it('masks filled text values regardless of whether a model recognizes the name', () => {
    expect(privateInputMasks([input])).toEqual([input.bbox]);
  });
  it('does not hide selectable public controls or empty text fields', () => {
    expect(privateInputMasks([
      { ...input, value_present: false },
      { ...input, tag: 'select', role: 'combobox', input_type: 'select' },
      { ...input, role: 'checkbox', input_type: 'checkbox' },
    ])).toEqual([]);
  });
  it('masks passwords even without a readable value', () => {
    expect(privateInputMasks([{ ...input, value_present: false, input_type: 'password' }])).toEqual([input.bbox]);
  });
});
