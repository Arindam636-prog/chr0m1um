import type { SanitizedContext } from '@contextshield/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  checkAgentHealth,
  PrivacyAssertionError,
  startAgent,
} from '../lib/network/privacyGateway';

const context: SanitizedContext = {
  task: 'Continue',
  origin: 'https://example.com',
  snapshot_id: 'snap_1',
  elements: [],
  safe_visual_crops: [],
  privacy_summary: { EMAIL: 1 },
};

describe('privacy gateway', () => {
  it('blocks known secrets before fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      startAgent(
        new URL('http://127.0.0.1:8000'),
        { ...context, task: 'Email private@example.com' },
        ['private@example.com'],
        fetchImpl,
      ),
    ).rejects.toBeInstanceOf(PrivacyAssertionError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks obvious sensitive values even when the detector missed them', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      startAgent(
        new URL('http://127.0.0.1:8000'),
        { ...context, task: 'Email privacy.fixture@example.invalid' },
        [],
        fetchImpl,
      ),
    ).rejects.toBeInstanceOf(PrivacyAssertionError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks insecure non-loopback endpoints', async () => {
    await expect(
      startAgent(new URL('http://example.com'), context, [], vi.fn<typeof fetch>()),
    ).rejects.toBeInstanceOf(PrivacyAssertionError);
  });

  it('scans select options as well as labels and task text', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      startAgent(
        new URL('http://127.0.0.1:8000'),
        {
          ...context,
          elements: [
            {
              id: 'el_1',
              role: 'combobox',
              text: null,
              label: 'Recipient',
              input_type: 'select',
              value_handle: null,
              enabled: true,
              selected: null,
              value_present: false,
              options: ['private@example.com'],
              selected_option: null,
              control_value: null,
              dom_index: 0,
            },
          ],
        },
        [],
        fetchImpl,
      ),
    ).rejects.toBeInstanceOf(PrivacyAssertionError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows safe PASSWORD and OTP classification counts', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          session_id: '11111111-1111-4111-8111-111111111111',
          state: 'COMPLETE',
          action: {
            type: 'FINISH',
            action_id: 'act_safe_summary',
            snapshot_id: context.snapshot_id,
            reason: 'The privacy summary is safe to report',
            summary: 'The page was summarized from sanitized context.',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(
      startAgent(
        new URL('http://127.0.0.1:8000'),
        { ...context, privacy_summary: { EMAIL: 1, PASSWORD: 1, OTP: 1 } },
        [],
        fetchImpl,
      ),
    ).resolves.toMatchObject({ state: 'COMPLETE' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('reports a safe, actionable planner error for HTTP 502', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 502 }));

    await expect(
      startAgent(new URL('http://127.0.0.1:8000'), context, [], fetchImpl),
    ).rejects.toThrow('PLANNER_FAILED');
  });

  it('maps connection failures to a clear offline service error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      startAgent(new URL('http://127.0.0.1:8000'), context, [], fetchImpl),
    ).rejects.toThrow('AGENT_SERVER_OFFLINE');
    await expect(
      checkAgentHealth(new URL('http://127.0.0.1:8000'), fetchImpl),
    ).rejects.toThrow('AGENT_SERVER_OFFLINE');
  });
});
