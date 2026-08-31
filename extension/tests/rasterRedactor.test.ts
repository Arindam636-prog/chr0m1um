import { describe, expect, it } from 'vitest';

import { irreversiblyMask, verifyMasks } from '../lib/privacy/rasterRedactor';

describe('raster redaction', () => {
  it('changes actual transmitted pixels and verifies the irreversible mask', () => {
    const source = {
      width: 4,
      height: 4,
      data: new Uint8ClampedArray(4 * 4 * 4).fill(127),
    };
    const boxes = [{ x: 1, y: 1, width: 2, height: 2 }];
    const redacted = irreversiblyMask(source, boxes);

    expect(verifyMasks(redacted, boxes)).toBe(true);
    expect(verifyMasks(source, boxes)).toBe(false);
    expect(source.data.every((value) => value === 127)).toBe(true);
  });
});
