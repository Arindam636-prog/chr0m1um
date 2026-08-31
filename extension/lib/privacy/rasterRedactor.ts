import { SafeVisualCropSchema, type BBox } from '@contextshield/shared';

export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function clippedBox(box: BBox, width: number, height: number) {
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const right = Math.min(width, Math.ceil(box.x + box.width));
  const bottom = Math.min(height, Math.ceil(box.y + box.height));
  return { left, top, right, bottom };
}

export function irreversiblyMask(
  source: RasterImage,
  sensitiveBoxes: readonly BBox[],
): RasterImage {
  const expected = source.width * source.height * 4;
  if (source.data.length !== expected) throw new Error('REDACTION_FAILED');
  const output = new Uint8ClampedArray(source.data);
  for (const box of sensitiveBoxes) {
    const clipped = clippedBox(box, source.width, source.height);
    for (let y = clipped.top; y < clipped.bottom; y += 1) {
      for (let x = clipped.left; x < clipped.right; x += 1) {
        const offset = (y * source.width + x) * 4;
        output[offset] = 0;
        output[offset + 1] = 0;
        output[offset + 2] = 0;
        output[offset + 3] = 255;
      }
    }
  }
  return { width: source.width, height: source.height, data: output };
}

export function verifyMasks(image: RasterImage, sensitiveBoxes: readonly BBox[]): boolean {
  for (const box of sensitiveBoxes) {
    const clipped = clippedBox(box, image.width, image.height);
    for (let y = clipped.top; y < clipped.bottom; y += 1) {
      for (let x = clipped.left; x < clipped.right; x += 1) {
        const offset = (y * image.width + x) * 4;
        if (
          image.data[offset] !== 0 ||
          image.data[offset + 1] !== 0 ||
          image.data[offset + 2] !== 0 ||
          image.data[offset + 3] !== 255
        ) {
          return false;
        }
      }
    }
  }
  return true;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function createVerifiedPngCrop(
  id: string,
  source: RasterImage,
  sensitiveBoxes: readonly BBox[],
) {
  const redacted = irreversiblyMask(source, sensitiveBoxes);
  if (!verifyMasks(redacted, sensitiveBoxes)) throw new Error('REDACTION_FAILED');
  const canvas = new OffscreenCanvas(redacted.width, redacted.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('REDACTION_FAILED');
  context.putImageData(
    new ImageData(new Uint8ClampedArray(redacted.data), redacted.width, redacted.height),
    0,
    0,
  );
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return SafeVisualCropSchema.parse({
    id,
    mime_type: 'image/png',
    sha256,
    width: redacted.width,
    height: redacted.height,
    data_base64: bytesToBase64(bytes),
    redaction_verified: true,
  });
}
