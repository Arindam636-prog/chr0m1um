import type { BBox, PageElement } from '@contextshield/shared';

function overlapRatio(left: BBox, right: BBox): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  const intersection = width * height;
  const smaller = Math.min(left.width * left.height, right.width * right.height);
  return smaller <= 0 ? 0 : intersection / smaller;
}

function normalizedName(element: PageElement): string {
  return [element.text, element.label, element.control_value]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function compatible(dom: PageElement, pixel: PageElement): boolean {
  if (overlapRatio(dom.bbox, pixel.bbox) < 0.3) return false;
  if (pixel.sources?.includes('VISION')) return dom.role === 'img' || dom.tag === 'img';
  const domName = normalizedName(dom);
  const pixelName = normalizedName(pixel);
  if (!domName || !pixelName) return false;
  return domName.includes(pixelName) || pixelName.includes(domName);
}

/**
 * Joins pixel-derived evidence to actionable DOM records while leaving visual-
 * only records disabled. A server action can therefore use a fused element ID,
 * but can never click an ungrounded OCR box.
 */
export function fuseScreenState(
  domElements: readonly PageElement[],
  pixelElements: readonly PageElement[],
): PageElement[] {
  const matchedPixelIds = new Set<string>();
  const fusedDom = domElements.map((dom) => {
    const matches = pixelElements.filter((pixel) => compatible(dom, pixel));
    if (matches.length === 0) return dom;
    for (const match of matches) matchedPixelIds.add(match.id);
    return {
      ...dom,
      sources: [
        ...new Set([
          ...(dom.sources ?? ['DOM']),
          ...matches.flatMap((match) => match.sources ?? []),
        ]),
      ].slice(0, 3),
    };
  });
  return [
    ...fusedDom,
    ...pixelElements.filter((pixel) => !matchedPixelIds.has(pixel.id)),
  ].slice(0, 2_000);
}
