import { describe, expect, it } from 'vitest';
import fixture from '../../shared/fixtures/sanitized-context.json';
import { deliveryLabel, readPrivacyPreview } from '../entrypoints/popup/proofModel';

describe('judge privacy proof', () => {
  it('projects the actual sanitized records and local handles', () => {
    const preview = readPrivacyPreview(JSON.stringify(fixture));
    expect(preview?.elements[1]?.value_handle).toBe('LOCAL_EMAIL_1');
    expect(preview?.safe_visual_crops).toHaveLength(0);
  });
  it('does not render malformed or raw context as a preview', () => {
    expect(readPrivacyPreview(null)).toBeNull();
    expect(readPrivacyPreview('invalid')).toBeNull();
    expect(readPrivacyPreview(JSON.stringify({ ...fixture, raw_dom: 'private value' }))).toBeNull();
  });
  it('never equates preparation or attempted delivery with server acknowledgement', () => {
    const base = { endpoint: 'http://127.0.0.1:8000', requests: 0 };
    expect(deliveryLabel(undefined)).toBe('No delivery evidence yet');
    expect(deliveryLabel({ ...base, status: 'PREPARED' })).toContain('not dispatched');
    expect(deliveryLabel({ ...base, status: 'LOCAL_ONLY' })).toContain('not sent');
    expect(deliveryLabel({ ...base, status: 'DISPATCHED' })).toContain('awaiting');
    expect(deliveryLabel({ ...base, status: 'UNCONFIRMED' })).toContain('not confirmed');
    expect(deliveryLabel({ ...base, status: 'ACKNOWLEDGED' })).toContain('Server responded');
  });
});
