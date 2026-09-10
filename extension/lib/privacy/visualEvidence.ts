import type { BBox } from '@contextshield/shared';

interface VisualDetection { type: 'FACE' | 'PRIVATE_DOCUMENT'; confidence: number; viewportBox: BBox }

/** One identity per overlapping visual detection across viewport and crops. */
export function mergeVisualDetections<T extends VisualDetection>(detections: readonly T[]): Array<T & { evidenceId: string }> {
  const merged: Array<T & { evidenceId: string }> = [];
  for (const detection of [...detections].sort((a, b) => b.confidence - a.confidence)) {
    const duplicate = merged.find((item) => {
      if (item.type !== detection.type) return false;
      const a = item.viewportBox, b = detection.viewportBox;
      const area = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      return area / Math.max(1, a.width * a.height + b.width * b.height - area) > 0.45;
    });
    if (duplicate) {
      // Union the boxes: merging counts must never shrink the protected area.
      const a = duplicate.viewportBox, b = detection.viewportBox;
      duplicate.viewportBox = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x), height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) };
    } else merged.push({ ...detection, viewportBox: { ...detection.viewportBox }, evidenceId: `visual_${merged.length}` });
  }
  return merged;
}
