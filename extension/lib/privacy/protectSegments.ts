import type { ContextualProtection } from './rampartScanner';

// Only our fixed redaction vocabulary and opaque references are excluded.
// Ordinary surrounding text is still classified. This is not a PII allowlist.
const MARKER = /(<(?:PERSON_NAME|EMAIL|PHONE|ADDRESS|UPI_ID|PASSWORD|OTP|PAYMENT_CARD|AADHAAR_LIKE|PAN|ACCOUNT_ID|PRIVATE_DOCUMENT|FACE|OTHER)>|\bLOCAL_[A-Z0-9_]+\b|\[(?:GIVEN_NAME|SURNAME|EMAIL|PHONE|BUILDING_NUMBER|STREET_NAME|SECONDARY_ADDRESS)_\d+\])/g;

export async function protectSegments(
  text: string,
  protect: (part: string) => Promise<ContextualProtection>,
): Promise<ContextualProtection> {
  const output: ContextualProtection = { text: '', placeholders: [], localValues: [] };
  const parts = text.split(MARKER);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? '';
    if (index % 2 === 1 || !part.trim()) { output.text += part; continue; }
    const safe = await protect(part);
    output.text += safe.text;
    output.placeholders.push(...safe.placeholders);
    output.localValues?.push(...(safe.localValues ?? []));
  }
  return output;
}
