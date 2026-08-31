import type { SensitiveEntity, SensitiveEntityType } from '@contextshield/shared';

import type { RawSensitiveEntity, SensitiveField } from './types';

interface Candidate {
  type: SensitiveEntityType;
  value: string;
  start: number;
  end: number;
  confidence: number;
}

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const PHONE = /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/gu;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/gu;
const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/gu;
const IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/gu;
const UPI = /\b[A-Z0-9][A-Z0-9._-]{1,}@[A-Z]{2,}\b/giu;
const CARD = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/gu;
const AADHAAR = /(?<!\d)(?:\d{4}[ -]?){2}\d{4}(?!\d)/gu;
const OTP = /\b(?:otp|one[ -]?time password|verification code|security code)\b\D{0,12}(\d{4,8})/giu;
const PASSWORD = /\b(?:password|passcode|pin)\s*[:=]\s*([^\s,;]+)/giu;
const ACCOUNT = /\b(?:account|customer|employee|patient)\s*(?:id|number|no\.?|code)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{4,24})\b/giu;
const PERSON = /\b(?:name|patient|account holder|employee)\s*[:=-]\s*([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){1,3})/giu;
const ADDRESS = /\b(?:address|residing at|located at)\s*[:=-]\s*([^\n]{8,160})/giu;
const MEDICAL = /\b(?:diagnosis|medical condition|patient history)\s*[:=-]\s*([^\n]{3,120})/giu;

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
] as const;
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
] as const;

export function passesLuhn(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function passesVerhoeff(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 12 || /^0/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  let checksum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const character = digits[digits.length - index - 1];
    if (character === undefined) return false;
    const permutation = VERHOEFF_P[index % 8]?.[Number(character)];
    if (permutation === undefined) return false;
    checksum = VERHOEFF_D[checksum]?.[permutation] ?? -1;
  }
  return checksum === 0;
}

export function passesGstinChecksum(value: string): boolean {
  if (value.length !== 15) return false;
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let factor = 2;
  let sum = 0;
  for (let index = 13; index >= 0; index -= 1) {
    const codePoint = alphabet.indexOf(value[index] ?? '');
    if (codePoint < 0) return false;
    const product = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const checkCodePoint = (36 - (sum % 36)) % 36;
  return alphabet[checkCodePoint] === value[14];
}

function addMatches(
  candidates: Candidate[],
  text: string,
  expression: RegExp,
  type: SensitiveEntityType,
  confidence: number,
  validator: (value: string) => boolean = () => true,
  captureGroup = 0,
): void {
  expression.lastIndex = 0;
  for (const match of text.matchAll(expression)) {
    const value = match[captureGroup];
    if (!value || !validator(value)) continue;
    const whole = match[0];
    const groupOffset = captureGroup === 0 ? 0 : whole.indexOf(value);
    const start = match.index + Math.max(groupOffset, 0);
    candidates.push({ type, value, start, end: start + value.length, confidence });
  }
}

function overlaps(left: Candidate, right: Candidate): boolean {
  return left.start < right.end && right.start < left.end;
}

function collectCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  addMatches(candidates, text, EMAIL, 'EMAIL', 0.99);
  addMatches(candidates, text, PHONE, 'PHONE', 0.96);
  addMatches(candidates, text, PAN, 'PAN', 0.98);
  addMatches(candidates, text, GSTIN, 'GSTIN', 0.99, passesGstinChecksum);
  addMatches(candidates, text, IFSC, 'IFSC', 0.97);
  addMatches(candidates, text, UPI, 'UPI_ID', 0.94);
  addMatches(candidates, text, CARD, 'PAYMENT_CARD', 0.99, passesLuhn);
  addMatches(candidates, text, AADHAAR, 'AADHAAR_LIKE', 0.99, passesVerhoeff);
  addMatches(candidates, text, OTP, 'OTP', 0.98, undefined, 1);
  addMatches(candidates, text, PASSWORD, 'PASSWORD', 0.99, undefined, 1);
  addMatches(candidates, text, ACCOUNT, 'ACCOUNT_ID', 0.88, undefined, 1);
  addMatches(candidates, text, PERSON, 'PERSON_NAME', 0.79, undefined, 1);
  addMatches(candidates, text, ADDRESS, 'ADDRESS', 0.82, undefined, 1);
  addMatches(candidates, text, MEDICAL, 'MEDICAL', 0.86, undefined, 1);

  const priority: Record<SensitiveEntityType, number> = {
    PASSWORD: 100,
    OTP: 101,
    PAYMENT_CARD: 98,
    AADHAAR_LIKE: 97,
    EMAIL: 96,
    GSTIN: 95,
    PAN: 94,
    IFSC: 93,
    UPI_ID: 92,
    PHONE: 91,
    ACCOUNT_ID: 90,
    PERSON_NAME: 80,
    ADDRESS: 79,
    MEDICAL: 78,
    FACE: 0,
    PRIVATE_DOCUMENT: 0,
    OTHER: 0,
  };
  const accepted: Candidate[] = [];
  for (const candidate of candidates.sort(
    (left, right) => priority[right.type] - priority[left.type] || left.start - right.start,
  )) {
    if (!accepted.some((existing) => overlaps(candidate, existing))) accepted.push(candidate);
  }
  return accepted.sort((left, right) => left.start - right.start);
}

export function detectSensitiveText(
  text: string,
  field: SensitiveField,
  source: SensitiveEntity['source'],
  elementId: string | null,
  nextEntityId: () => string,
  optionIndex: number | null = null,
): RawSensitiveEntity[] {
  return collectCandidates(text).map((candidate) => ({
    entity: {
      entity_id: nextEntityId(),
      type: candidate.type,
      source,
      confidence: candidate.confidence,
      element_id: elementId,
      region_id: null,
    },
    rawValue: candidate.value,
    start: candidate.start,
    end: candidate.end,
    field,
    optionIndex,
  }));
}
