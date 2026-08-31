import { describe, expect, it } from 'vitest';

import {
  AgentActionSchema,
  SanitizedContextSchema,
} from '../schemas/index';
import sanitizedFixture from '../fixtures/sanitized-context.json';

describe('shared privacy-boundary schemas', () => {
  it('accepts a minimal sanitized context', () => {
    const parsed = SanitizedContextSchema.parse({
      task: 'Continue safely',
      origin: 'https://example.com',
      snapshot_id: 'snap_1',
      elements: [],
      safe_visual_crops: [],
      privacy_summary: { EMAIL: 1 },
    });

    expect(parsed.snapshot_id).toBe('snap_1');
  });

  it('accepts the cross-language shared fixture', () => {
    const parsed = SanitizedContextSchema.parse(sanitizedFixture);
    expect(parsed.elements[1]?.value_handle).toBe('LOCAL_EMAIL_1');
  });

  it('rejects unknown outbound fields', () => {
    expect(() =>
      SanitizedContextSchema.parse({
        task: 'Continue safely',
        origin: 'https://example.com',
        snapshot_id: 'snap_1',
        elements: [],
        safe_visual_crops: [],
        privacy_summary: {},
        raw_dom: '<input type="password" value="secret">',
      }),
    ).toThrow();
  });

  it('rejects model-generated code actions', () => {
    expect(() =>
      AgentActionSchema.parse({
        type: 'RUN_JAVASCRIPT',
        action_id: 'act_1',
        snapshot_id: 'snap_1',
        code: 'document.cookie',
        reason: 'malicious',
      }),
    ).toThrow();
  });
});
