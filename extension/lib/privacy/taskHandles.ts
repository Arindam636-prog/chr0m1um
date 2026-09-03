import type { SecretVaultAdapter } from './types';

interface TaskValueMatch {
  start: number;
  end: number;
  kind: string;
  value: string;
}

const FIELD_START = '(?:first\\s+name|last\\s+name|full\\s+name|email(?:\\s+address)?|mobile(?:\\s+number)?|phone(?:\\s+number)?|current\\s+address|address|upi(?:\\s+id)?|user\\s*name|text\\s+input|search(?:\\s+(?:query|box))?)';
const VALUE_END = `(?=\\s*(?:,|;|$|\\.\\s+(?=[A-Z])|\\band\\s+(?=${FIELD_START}\\b)))`;

const TASK_FIELDS: ReadonlyArray<{ kind: string; expression: RegExp }> = [
  { kind: 'GIVEN_NAME', expression: new RegExp(`\\bfirst\\s+name\\s*(?:is|=|:)?\\s*(?:"([^"]{1,200})"|'([^']{1,200})'|([^,;\\n]{1,200}?)${VALUE_END})`, 'gi') },
  { kind: 'SURNAME', expression: new RegExp(`\\blast\\s+name\\s*(?:is|=|:)?\\s*(?:"([^"]{1,200})"|'([^']{1,200})'|([^,;\\n]{1,200}?)${VALUE_END})`, 'gi') },
  { kind: 'PERSON_NAME', expression: new RegExp(`\\bfull\\s+name\\s*(?:is|=|:)?\\s*(?:"([^"]{1,200})"|'([^']{1,200})'|([^,;\\n]{1,200}?)${VALUE_END})`, 'gi') },
  { kind: 'EMAIL', expression: new RegExp(`\\bemail(?:\\s+address)?\\s*(?:is|=|:)?\\s*(?:"([^"]{1,200})"|'([^']{1,200})'|([^,;\\n]{1,200}?)${VALUE_END})`, 'gi') },
  { kind: 'PHONE', expression: new RegExp(`\\b(?:mobile|phone)(?:\\s+number)?\\s*(?:is|=|:)?\\s*(?:"([^"]{1,200})"|'([^']{1,200})'|([^,;\\n]{1,200}?)${VALUE_END})`, 'gi') },
  { kind: 'ADDRESS', expression: new RegExp(`\\b(?:current\\s+address|address)\\s*(?:is|=|:)?\\s*(?:"([^"]{1,200})"|'([^']{1,200})'|([^,;\\n]{1,200}?)${VALUE_END})`, 'gi') },
  { kind: 'UPI_ID', expression: new RegExp(`\\bupi(?:\\s+id)?\\s*(?:is|=|:)?\\s*(?:"([^"]{1,200})"|'([^']{1,200})'|([^,;\\n]{1,200}?)${VALUE_END})`, 'gi') },
  { kind: 'USERNAME', expression: new RegExp(`\\buser\\s*name\\s*(?:is|=|:|with)?\\s*(?:"([^"]{1,200})"|'([^']{1,200})'|([^,;\\n]{1,200}?)${VALUE_END})`, 'gi') },
  { kind: 'TEXT', expression: new RegExp(`\\b(?:text\\s+input|search(?:\\s+(?:query|box))?)\\s*(?:is|=|:|with)?\\s*(?:"([^"]{1,200})"|'([^']{1,200})'|([^,;\\n]{1,200}?)${VALUE_END})`, 'gi') },
];

const ACTION_ONLY_VALUE = /^(?:my\s+)?(?:and\s+)?(?:continue|submit|stop|proceed|go|click|press|select|choose|fill|enter|use)(?:\s+.*)?$/i;

function isPlausibleFieldValue(kind: string, value: string): boolean {
  if (ACTION_ONLY_VALUE.test(value)) return false;
  if (kind === 'EMAIL') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (kind === 'PHONE') return value.replace(/\D/g, '').length >= 7;
  if (kind === 'UPI_ID') return /^[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}$/.test(value);
  if (kind === 'GIVEN_NAME' || kind === 'SURNAME' || kind === 'PERSON_NAME') {
    return /^[\p{L}][\p{L} .'-]{0,99}$/u.test(value) && !/\b(?:and|then)\b/i.test(value);
  }
  return value.length >= 4;
}

/** Converts task-supplied field values into memory-only handles before scanning/transmission. */
export function localizeTaskFieldValues(task: string, vault: SecretVaultAdapter): string {
  const matches: TaskValueMatch[] = [];
  for (const field of TASK_FIELDS) {
    field.expression.lastIndex = 0;
    for (const match of task.matchAll(field.expression)) {
      const captured = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      const value = captured.endsWith('.') ? captured.slice(0, -1).trimEnd() : captured;
      if (!value || /^LOCAL_[A-Z0-9_]+$/.test(value)) continue;
      if (!isPlausibleFieldValue(field.kind, value)) continue;
      const relativeStart = match[0].lastIndexOf(value);
      if (relativeStart < 0) continue;
      const start = match.index + relativeStart;
      matches.push({ start, end: start + value.length, kind: field.kind, value });
    }
  }

  let localized = task;
  for (const match of matches.sort((left, right) => right.start - left.start)) {
    const handle = vault.store(match.kind, match.value);
    localized = `${localized.slice(0, match.start)}${handle}${localized.slice(match.end)}`;
  }
  return localized;
}
