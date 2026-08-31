import {
  PageObservationSchema,
  type PageElement,
  type PageObservation,
} from '@contextshield/shared';

import type {
  LocalPageObservation,
  LocalPrivateValue,
  LocalVisualHint,
} from '../privacy/types';

const PAGE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable="true"]',
  '[role]',
  '[tabindex]:not([tabindex="-1"])',
  'h1',
  'h2',
  'h3',
  'p',
  'li',
  'td',
  'th',
  'label',
  'img',
].join(',');

const VISUAL_SELECTOR = [
  'canvas',
  'img',
  'embed[type="application/pdf"]',
  '[data-contextshield-visual-control]',
].join(',');

const stableIds = new WeakMap<HTMLElement, string>();
let nextStableId = 0;
let nextSnapshotId = 0;

export interface PerceptionSnapshot extends LocalPageObservation {
  elementIndex: Map<string, HTMLElement>;
}

function idFor(element: HTMLElement): string {
  const existing = stableIds.get(element);
  if (existing) return existing;
  const id = `el_${++nextStableId}`;
  stableIds.set(element, id);
  return id;
}

function snapshotId(): string {
  const random = new Uint32Array(4);
  crypto.getRandomValues(random);
  nextSnapshotId += 1;
  return `snap_${Array.from(random, (value) => value.toString(16).padStart(8, '0')).join('')}_${nextSnapshotId}`;
}

function finiteRect(element: HTMLElement): DOMRect | null {
  const rect = element.getBoundingClientRect();
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ? rect : null;
}

function isVisible(element: HTMLElement, rect: DOMRect): boolean {
  const style = getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    !element.hidden
  );
}

function isEnabled(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return false;
  return !(
    'disabled' in element &&
    (element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement).disabled
  );
}

function inferredRole(element: HTMLElement): string {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit.slice(0, 64);
  if (element instanceof HTMLAnchorElement) return 'link';
  if (element instanceof HTMLButtonElement) return 'button';
  if (element instanceof HTMLElement && element.tagName === 'SUMMARY') return 'button';
  if (element instanceof HTMLSelectElement) return 'combobox';
  if (element instanceof HTMLTextAreaElement || element.isContentEditable) return 'textbox';
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') return 'checkbox';
    if (element.type === 'radio') return 'radio';
    if (element.type === 'submit' || element.type === 'button') return 'button';
    return 'textbox';
  }
  if (/^H[1-6]$/.test(element.tagName)) return 'heading';
  if (element instanceof HTMLImageElement) return 'img';
  return element.tagName.toLowerCase();
}

function normalizedText(value: string | null | undefined, maxLength: number): string | null {
  const normalized = value?.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return normalized || null;
}

function safeText(element: HTMLElement): string | null {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.isContentEditable
  ) {
    return null;
  }
  if (element instanceof HTMLImageElement) return normalizedText(element.alt, 2_000);
  return normalizedText(element.innerText, 2_000);
}

function adjacentControlText(element: HTMLInputElement): string | null {
  const collect = (start: ChildNode | null, direction: 'next' | 'previous'): string | null => {
    const parts: string[] = [];
    let node = start;
    for (let inspected = 0; node && inspected < 8; inspected += 1) {
      if (node instanceof HTMLBRElement) break;
      if (
        node instanceof HTMLInputElement ||
        node instanceof HTMLSelectElement ||
        node instanceof HTMLTextAreaElement ||
        node instanceof HTMLButtonElement
      ) break;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = normalizedText(node.textContent, 500);
        if (text) parts.push(text);
      } else if (node instanceof HTMLElement) {
        const text = normalizedText(node.innerText || node.textContent, 500);
        if (text) parts.push(text);
      }
      node = direction === 'next' ? node.nextSibling : node.previousSibling;
    }
    if (direction === 'previous') parts.reverse();
    return normalizedText(parts.join(' '), 500);
  };

  // Many public test sites use `<input> checkbox 1<br>` without a label.
  // Reading every text node in the parent merges all choices into one label.
  return collect(element.nextSibling, 'next') ?? collect(element.previousSibling, 'previous');
}

function labelFor(element: HTMLElement): string | null {
  const aria = normalizedText(element.getAttribute('aria-label'), 500);
  if (aria) return aria;
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    const normalized = normalizedText(label, 500);
    if (normalized) return normalized;
  }
  if (
    (element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement) &&
    element.labels?.[0]
  ) {
    return normalizedText(element.labels[0].textContent, 500);
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    // React form libraries often render a visual label in a sibling column
    // without `for`/`aria-labelledby`. Walk only a few local containers and
    // accept the label only when it is unambiguous inside that form row.
    let ancestor = element.parentElement;
    for (let depth = 0; ancestor && depth < 4; depth += 1) {
      const labels = Array.from(ancestor.querySelectorAll('label'));
      if (labels.length === 1) {
        const nearby = normalizedText(labels[0]?.textContent, 500);
        if (nearby) {
          const placeholder = normalizedText(element.getAttribute('placeholder'), 500);
          return placeholder && nearby.toLowerCase() !== placeholder.toLowerCase()
            ? normalizedText(`${nearby} ${placeholder}`, 500)
            : nearby;
        }
      }
      if (labels.length > 1) break;
      ancestor = ancestor.parentElement;
    }
  }
  if (
    element instanceof HTMLInputElement &&
    (element.type === 'checkbox' || element.type === 'radio')
  ) {
    const adjacentText = adjacentControlText(element);
    if (adjacentText) return adjacentText;
    const semanticValue = normalizedText(element.value, 500);
    if (semanticValue && semanticValue.toLowerCase() !== 'on') return semanticValue;
  }
  return (
    normalizedText(element.getAttribute('title'), 500) ??
    normalizedText(element.getAttribute('placeholder'), 500)
  );
}

function selectedOptionFor(element: HTMLElement): string | null {
  if (!(element instanceof HTMLSelectElement)) return null;
  const option = element.selectedOptions.item(0);
  return normalizedText(option?.textContent, 500);
}

function controlValueFor(element: HTMLElement): string | null {
  if (!(element instanceof HTMLInputElement)) return null;
  if (element.type !== 'checkbox' && element.type !== 'radio') return null;
  const value = normalizedText(element.value, 500);
  return value?.toLowerCase() === 'on' ? null : value;
}

function inputType(element: HTMLElement): string | null {
  if (element instanceof HTMLInputElement) return element.type.slice(0, 32);
  if (element instanceof HTMLTextAreaElement || element.isContentEditable) return 'text';
  if (element instanceof HTMLSelectElement) return 'select';
  return null;
}

function isValueBearing(element: HTMLElement): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.isContentEditable
  );
}

function valueFor(element: HTMLElement): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.type === 'checkbox' || element.type === 'radio') return '';
    return element.value;
  }
  if (element instanceof HTMLSelectElement) return element.value;
  if (element.isContentEditable) return element.innerText;
  return '';
}

function selectedFor(element: HTMLElement): boolean | null {
  if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
    return element.checked;
  }
  return element.getAttribute('aria-selected') === null
    ? null
    : element.getAttribute('aria-selected') === 'true';
}

function optionsFor(element: HTMLElement): string[] {
  if (!(element instanceof HTMLSelectElement)) return [];
  return Array.from(element.options)
    .map((option) => normalizedText(option.textContent, 500))
    .filter((option): option is string => option !== null)
    .slice(0, 500);
}

function hashFingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `fp_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function pageFingerprint(observation: PageObservation): string {
  return hashFingerprint(
    JSON.stringify({
      origin: observation.origin,
      url: observation.url,
      viewport: observation.viewport,
      elements: observation.elements.map((element) => [
        element.id,
        element.role,
        element.text,
        element.label,
        element.enabled,
        element.selected,
        element.value_present,
        element.options,
        element.selected_option,
        element.control_value,
      ]),
    }),
  );
}

const INJECTED_UI_PATTERN = /(?:^|[-_\s])(weava|web[-_]?highlighter|chrome[-_]?extension|browser[-_]?extension|third[-_]?party[-_]?extension|extension[-_]?root|extension[-_]?toolbar)(?:$|[-_\s])/i;

function looksLikeInjectedUi(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 16; depth += 1) {
    // Highlighter extensions sometimes tag BODY/HTML globally. Such a marker
    // must not hide every genuine website control from the page observation.
    if (current === document.body || current === document.documentElement) break;
    if (current.hasAttribute('data-contextshield-ignore')) return true;
    const identity = [
      current.id,
      current.className,
      current.getAttribute('data-extension-id'),
      current.getAttribute('data-weava-id'),
      current.tagName,
    ]
      .filter((value): value is string => typeof value === 'string')
      .join(' ');
    if (INJECTED_UI_PATTERN.test(identity)) return true;
    const root = current.getRootNode();
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host as HTMLElement : null);
  }
  return false;
}

function queryDeep(selector: string): HTMLElement[] {
  const matches: HTMLElement[] = [];
  const roots: Array<Document | ShadowRoot> = [document];
  for (let rootIndex = 0; rootIndex < roots.length && rootIndex < 101; rootIndex += 1) {
    const root = roots[rootIndex];
    if (!root) continue;
    try {
      for (const match of root.querySelectorAll(selector)) {
        if (match instanceof HTMLElement && !looksLikeInjectedUi(match)) matches.push(match);
      }
      for (const host of root.querySelectorAll('*')) {
        if (host instanceof HTMLElement && host.shadowRoot) roots.push(host.shadowRoot);
      }
    } catch {
      // A third-party widget can detach a shadow tree during traversal. Keep
      // the records already collected from the rest of the page.
      continue;
    }
  }
  return [...new Set(matches)];
}

function visualKind(element: HTMLElement): 'CANVAS' | 'IMAGE' | 'PDF' | 'VISUAL_CONTROL' {
  if (element instanceof HTMLCanvasElement) return 'CANVAS';
  if (element instanceof HTMLImageElement) return 'IMAGE';
  if (element.matches('embed[type="application/pdf"]')) return 'PDF';
  return 'VISUAL_CONTROL';
}

export function extractObservation(): PerceptionSnapshot {
  const elements: PageElement[] = [];
  const elementIndex = new Map<string, HTMLElement>();
  const privateValues: LocalPrivateValue[] = [];

  for (const [domIndex, element] of queryDeep(PAGE_SELECTOR).entries()) {
    if (elements.length >= 2_000) break;
    try {
      const rect = finiteRect(element);
      if (!rect || !isVisible(element, rect)) continue;
      const id = idFor(element);
      const value = valueFor(element);
      const valueBearing = isValueBearing(element);
      elements.push({
        id,
        role: inferredRole(element),
        tag: element.tagName.toLowerCase().slice(0, 32),
        text: safeText(element),
        label: labelFor(element),
        input_type: inputType(element),
        bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        visible: true,
        enabled: isEnabled(element),
        selected: selectedFor(element),
        value_present: valueBearing && value.trim().length > 0,
        options: optionsFor(element),
        selected_option: selectedOptionFor(element),
        control_value: controlValueFor(element),
        dom_index: domIndex,
        sources: ['DOM'],
      });
      elementIndex.set(id, element);
      if (valueBearing && value.trim()) {
        privateValues.push({ elementId: id, inputType: inputType(element) ?? 'text', value });
      }
    } catch {
      // Live pages mutate while they are being read. One detached or custom
      // element must not invalidate the rest of the local observation.
      continue;
    }
  }

  const visualRegions: PageObservation['visual_regions'] = [];
  const visualHints: LocalVisualHint[] = [];
  for (const element of queryDeep(VISUAL_SELECTOR)) {
    if (visualRegions.length >= 200) break;
    try {
      const rect = finiteRect(element);
      if (!rect || !isVisible(element, rect)) continue;
      if (
        rect.right <= 0 ||
        rect.bottom <= 0 ||
        rect.left >= window.innerWidth ||
        rect.top >= window.innerHeight
      ) continue;
      const regionId = `region_${visualRegions.length + 1}`;
      const sensitivity = element.dataset.contextshieldSensitive;
      visualRegions.push({
        id: regionId,
        kind: visualKind(element),
        bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        // Every visible pixel surface is inspected locally. The old selective
        // rule skipped ordinary <img> elements and was the main reason visual
        // privacy coverage differed between demo pages and real websites.
        requires_analysis: true,
      });
      if (sensitivity === 'face' || sensitivity === 'private-document') {
        visualHints.push({
          regionId,
          type: sensitivity === 'face' ? 'FACE' : 'PRIVATE_DOCUMENT',
        });
      }
    } catch {
      continue;
    }
  }

  const parsedObservation = PageObservationSchema.safeParse({
    snapshot_id: snapshotId(),
    origin: window.location.origin,
    url: window.location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    elements,
    visual_regions: visualRegions,
    timestamp: Date.now(),
  });
  if (!parsedObservation.success) {
    const issue = parsedObservation.error.issues[0];
    const path = issue?.path.join('_') || 'root';
    const code = issue?.code || 'unknown';
    throw new Error(`SCHEMA_${path}_${code}`);
  }
  const observation = parsedObservation.data;

  return {
    observation,
    privateValues,
    visualHints,
    ocrHints: [],
    safeVisualCrops: [],
    fingerprint: pageFingerprint(observation),
    elementIndex,
  };
}
