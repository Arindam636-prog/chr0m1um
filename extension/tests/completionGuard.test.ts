import type { SanitizedContext } from '@contextshield/shared';
import { describe, expect, it } from 'vitest';

import { finishRepresentsSuccess } from '../lib/agent/completionGuard';

const pendingOrderContext: SanitizedContext = {
  task: 'Continue and place the order.',
  origin: 'https://example.com',
  snapshot_id: 'snap_guard',
  elements: [
    {
      id: 'el_order',
      role: 'button',
      text: 'Place order',
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
    },
  ],
  safe_visual_crops: [],
  privacy_summary: {},
};

describe('finish completion guard', () => {
  it('rejects a blocked planner result instead of showing Task complete', () => {
    expect(
      finishRepresentsSuccess(
        'No form controls are available',
        'No actionable elements found. Task cannot be completed.',
      ),
    ).toBe(false);
  });

  it('accepts a finish only when the requested state is reported satisfied', () => {
    expect(
      finishRepresentsSuccess(
        'Every requested form state is already satisfied',
        'The requested form controls are now in the required state.',
      ),
    ).toBe(true);
  });

  it('rejects finish while a requested enabled final-action button remains', () => {
    expect(
      finishRepresentsSuccess(
        'Every requested form state is already satisfied',
        'The form controls are ready.',
        pendingOrderContext,
      ),
    ).toBe(false);
  });

  it('allows finish with an enabled Submit button when the task says not to submit', () => {
    expect(
      finishRepresentsSuccess(
        'The requested fields are complete and the form remains unsubmitted',
        'The form was filled without submission.',
        { ...pendingOrderContext, task: 'Fill the fields. Do not submit it.', elements: pendingOrderContext.elements.map((element) => ({ ...element, text: 'Submit' })) },
      ),
    ).toBe(true);
  });
});
