// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { extractObservation } from '../lib/perception/extractObservation';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
it('excludes cached rectangles inside closed details, while retaining the summary', () => {
  document.body.innerHTML = '<details><summary>Presenter controls</summary><h3>Hidden title</h3><p>Hidden instructions</p><img src="portrait.png" /></details>';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 10, y: 10, top: 10, left: 10, right: 110, bottom: 50, width: 100, height: 40, toJSON: () => ({}) }));
  const closed = extractObservation();
  expect(closed.observation.elements.map((element) => element.tag)).toEqual(['summary']);
  expect(closed.observation.visual_regions).toEqual([]);
  const details = document.querySelector('details');
  if (!details) throw new Error('Missing details');
  details.open = true;
  const opened = extractObservation();
  expect(opened.observation.elements.map((element) => element.tag)).toEqual(['summary', 'h3', 'p', 'img']);
  expect(opened.observation.visual_regions).toHaveLength(1);
});
