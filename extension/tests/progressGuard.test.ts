import type { AgentAction, SanitizedContext } from '@contextshield/shared';
import { describe, expect, it } from 'vitest';

import {
  actionProgressMarker,
  isRepeatedNoProgress,
} from '../lib/agent/progressGuard';

const context: SanitizedContext = {
  task: 'Continue',
  origin: 'https://example.com',
  snapshot_id: 'snap_1',
  elements: [
    {
      id: 'el_1',
      role: 'button',
      text: 'Continue',
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

function click(snapshotId: string, elementId = 'el_1'): AgentAction {
  return {
    type: 'CLICK',
    action_id: `act_${snapshotId}`,
    snapshot_id: snapshotId,
    element_id: elementId,
    reason: 'Continue',
  };
}

describe('action progress guard', () => {
  it('detects the same semantic action on an unchanged page across snapshots', () => {
    const first = actionProgressMarker(click('snap_1'), context);
    const second = actionProgressMarker(
      click('snap_2'),
      { ...context, snapshot_id: 'snap_2' },
    );

    expect(isRepeatedNoProgress(first, second)).toBe(true);
  });

  it('allows the same target when the visible page state changed', () => {
    const first = actionProgressMarker(click('snap_1'), context);
    const second = actionProgressMarker(click('snap_2'), {
      ...context,
      snapshot_id: 'snap_2',
      elements: context.elements.map((element) => ({
        ...element,
        text: 'Continue (step 2)',
      })),
    });

    expect(isRepeatedNoProgress(first, second)).toBe(false);
  });

  it('does not classify repeated scrolling as a no-progress action loop', () => {
    const scroll: AgentAction = {
      type: 'SCROLL',
      action_id: 'act_scroll',
      snapshot_id: 'snap_1',
      direction: 'DOWN',
      amount: 600,
      reason: 'Read more',
    };

    expect(actionProgressMarker(scroll, context)).toBeNull();
  });
});
