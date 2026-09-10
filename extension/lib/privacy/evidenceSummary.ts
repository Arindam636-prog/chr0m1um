import type { SensitiveEntityType } from '@contextshield/shared';
import type { PrivacyEvidence, RawSensitiveEntity } from './types';

function normalized(raw: RawSensitiveEntity): string {
  const text = raw.rawValue.normalize('NFKC').toLowerCase().trim();
  return raw.entity.type === 'PHONE' ? text.replace(/\D/g, '') : text.replace(/\s+/g, ' ');
}

/** Counting only: do not remove any redaction or policy decision. No raw values returned. */
export function summarizeEvidence(records: readonly RawSensitiveEntity[]): PrivacyEvidence {
  const result: PrivacyEvidence = { uniqueItems: {}, detectorHits: {}, reviewItems: {} };
  const groups = new Map<string, { type: SensitiveEntityType; contextual: boolean }>();
  for (const raw of records) {
    const type = raw.entity.type;
    result.detectorHits[type] = (result.detectorHits[type] ?? 0) + 1;
    const value = normalized(raw);
    // A detector-provided identity connects a face to all crops containing it.
    // Text values merge across DOM text, labels and OCR. Unknown values remain
    // separate unless tied to the same local element and field.
    const key = `${type}:${raw.evidenceId ?? (value ? `value:${value}` : `site:${raw.entity.element_id ?? raw.entity.region_id ?? raw.entity.entity_id}:${raw.optionIndex ?? ''}`)}`;
    const previous = groups.get(key);
    const needsReview = Boolean(raw.contextual) || raw.entity.source === 'OCR' || raw.entity.confidence < 0.6;
    groups.set(key, { type, contextual: needsReview && (previous?.contextual ?? true) });
  }
  for (const group of groups.values()) {
    result.uniqueItems[group.type] = (result.uniqueItems[group.type] ?? 0) + 1;
    if (group.contextual) result.reviewItems[group.type] = (result.reviewItems[group.type] ?? 0) + 1;
  }
  return result;
}
