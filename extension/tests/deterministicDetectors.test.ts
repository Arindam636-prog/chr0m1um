import { describe, expect, it } from 'vitest';

import {
  detectSensitiveText,
  passesGstinChecksum,
  passesLuhn,
  passesVerhoeff,
} from '../lib/privacy/deterministicDetectors';

function types(text: string) {
  let id = 0;
  return detectSensitiveText(text, 'TEXT', 'DOM', 'el_1', () => `pii_${++id}`).map(
    (entity) => entity.entity.type,
  );
}

describe('deterministic privacy detectors', () => {
  it('validates checksum-backed Indian and payment identifiers', () => {
    expect(passesGstinChecksum('27AAPFU0939F1ZV')).toBe(true);
    expect(passesGstinChecksum('27AAPFU0939F1ZA')).toBe(false);
    expect(passesVerhoeff('9999 4105 7058')).toBe(true);
    expect(passesVerhoeff('9999 4105 7059')).toBe(false);
    expect(passesLuhn('4111 1111 1111 1111')).toBe(true);
    expect(passesLuhn('4111 1111 1111 1112')).toBe(false);
  });

  it('detects high-priority secrets and resolves overlapping email/UPI spans', () => {
    expect(types('Email: private@example.com')).toEqual(['EMAIL']);
    expect(types('OTP: 739201 password=not-for-server')).toEqual(['OTP', 'PASSWORD']);
    expect(types('PAN ABCDE1234F IFSC HDFC0001234')).toEqual(['PAN', 'IFSC']);
    expect(types('Pay 4111-1111-1111-1111')).toEqual(['PAYMENT_CARD']);
  });

  it('does not classify invalid checksums as critical identifiers', () => {
    expect(types('Reference 4111111111111112')).not.toContain('PAYMENT_CARD');
    expect(types('Document 999941057059')).not.toContain('AADHAAR_LIKE');
  });
});
