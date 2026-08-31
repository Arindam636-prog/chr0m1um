import type { PageElement } from '@contextshield/shared';
import { describe, expect, it } from 'vitest';

import { fuseScreenState } from '../lib/perception/fuseScreenState';

function element(overrides: Partial<PageElement> & Pick<PageElement, 'id'>): PageElement {
  const { id, ...rest } = overrides;
  return {
    id,
    role: 'button',
    tag: 'button',
    text: 'Continue',
    label: null,
    input_type: null,
    bbox: { x: 10, y: 10, width: 100, height: 40 },
    visible: true,
    enabled: true,
    selected: null,
    value_present: false,
    options: [],
    selected_option: null,
    control_value: null,
    dom_index: 0,
    sources: ['DOM'],
    ...rest,
  };
}

describe('screen-state fusion', () => {
  it('joins matching OCR evidence to one actionable DOM record', () => {
    const result = fuseScreenState(
      [element({ id: 'el_dom' })],
      [element({ id: 'el_visual', role: 'visual_text', tag: 'visual', enabled: false, sources: ['OCR'] })],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'el_dom', enabled: true, sources: ['DOM', 'OCR'] });
  });

  it('keeps unmatched OCR records visible but non-actionable', () => {
    const result = fuseScreenState(
      [element({ id: 'el_dom' })],
      [element({ id: 'el_visual', text: 'Canvas only', bbox: { x: 400, y: 400, width: 90, height: 20 }, role: 'visual_text', tag: 'visual', enabled: false, sources: ['OCR'] })],
    );
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ id: 'el_visual', enabled: false, sources: ['OCR'] });
  });
});
