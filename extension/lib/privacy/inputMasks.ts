import type { BBox, PageElement } from '@contextshield/shared';

/** Input values are local-only even when OCR/NER would consider them public. */
export function privateInputMasks(elements: readonly PageElement[]): BBox[] {
  return elements.filter((element) => {
    if (!element.visible) return false;
    if (element.input_type === 'password') return true;
    if (!element.value_present) return false;
    if (element.role === 'textbox' || element.tag === 'textarea') return true;
    return element.tag === 'input' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'hidden'].includes(element.input_type ?? 'text');
  }).map((element) => element.bbox);
}
