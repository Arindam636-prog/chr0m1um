import { describe, expect, it } from 'vitest';
import { summarizeEvidence } from '../lib/privacy/evidenceSummary';
import { protectSegments } from '../lib/privacy/protectSegments';
import { mergeVisualDetections } from '../lib/privacy/visualEvidence';
import type { RawSensitiveEntity } from '../lib/privacy/types';

function record(type: RawSensitiveEntity['entity']['type'], value: string, id: string, extra: Partial<RawSensitiveEntity> = {}): RawSensitiveEntity {
  return { entity: { entity_id: id, type, source: 'DOM', confidence: .9, element_id: id, region_id: null }, rawValue: value, start: 0, end: value.length, field: 'TEXT', optionIndex: null, ...extra };
}
describe('privacy evidence counting', () => {
  it('merges DOM, label and OCR duplicates without losing distinct values', () => {
    const summary = summarizeEvidence([
      record('EMAIL', 'demo@example.com', 'dom'), record('EMAIL', 'demo@example.com', 'label'), record('EMAIL', 'demo@example.com', 'ocr'),
      record('EMAIL', 'other@example.com', 'other'),
    ]);
    expect(summary.uniqueItems.EMAIL).toBe(2);
    expect(summary.detectorHits.EMAIL).toBe(4);
    expect(JSON.stringify(summary)).not.toContain('@');
  });
  it('one face in several crops counts once; two faces remain two', () => {
    const summary = summarizeEvidence([
      record('FACE', '', 'viewport', { evidenceId: 'face_0' }), record('FACE', '', 'img', { evidenceId: 'face_0' }), record('FACE', '', 'figure', { evidenceId: 'face_0' }), record('FACE', '', 'other', { evidenceId: 'face_1' }),
    ]);
    expect(summary.uniqueItems.FACE).toBe(2);
    expect(summary.detectorHits.FACE).toBe(4);
  });
  it('separates contextual-only guesses from corroborated evidence', () => {
    const summary = summarizeEvidence([record('ADDRESS', 'possible location', 'a', { contextual: true }), record('EMAIL', 'demo@example.com', 'b', { contextual: true }), record('EMAIL', 'demo@example.com', 'c')]);
    expect(summary.reviewItems).toEqual({ ADDRESS: 1 });
  });
  it('keeps uncorroborated OCR classifications in review, not confirmed names', () => {
    const raw = record('UPI_ID', 'misread@example', 'ocr');
    raw.entity.source = 'OCR';
    expect(summarizeEvidence([raw]).reviewItems).toEqual({ UPI_ID: 1 });
  });
  it('merges the same face across resolutions without shrinking masks or merging separate faces', () => {
    const merged = mergeVisualDetections([
      { type: 'FACE', confidence: .8, viewportBox: { x: 10, y: 10, width: 50, height: 50 } },
      { type: 'FACE', confidence: .9, viewportBox: { x: 12, y: 8, width: 52, height: 50 } },
      { type: 'FACE', confidence: .9, viewportBox: { x: 100, y: 10, width: 50, height: 50 } },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.viewportBox).toEqual({ x: 10, y: 8, width: 54, height: 52 });
  });
  it('does not classify existing redaction markers or skip surrounding private text', async () => {
    const seen: string[] = [];
    const output = await protectSegments('Name: <PERSON_NAME> Contact private@example.com using LOCAL_EMAIL_1', (text) => {
      seen.push(text);
      return Promise.resolve({ text: text.replace('private@example.com', '[EMAIL_1]'), placeholders: text.includes('@') ? ['[EMAIL_1]'] : [] });
    });
    expect(seen.join('')).not.toContain('<PERSON_NAME>');
    expect(seen.join('')).not.toContain('LOCAL_EMAIL_1');
    expect(seen.join('')).toContain('private@example.com');
    expect(output.text).toContain('<PERSON_NAME>');
    expect(output.text).not.toContain('private@example.com');
    expect(output.placeholders).toEqual(['[EMAIL_1]']);
  });
});
