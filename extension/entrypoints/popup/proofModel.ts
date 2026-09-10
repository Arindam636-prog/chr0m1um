import { SanitizedContextSchema, type SanitizedContext } from '@contextshield/shared';
import type { PublicAgentState } from '../../lib/messaging/protocol';

/** Render only the schema-checked sanitized preview, never the raw task or vault. */
export function readPrivacyPreview(preview: string | null): SanitizedContext | null {
  if (!preview) return null;
  try {
    const result = SanitizedContextSchema.safeParse(JSON.parse(preview));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function deliveryLabel(delivery: PublicAgentState['contextDelivery']): string {
  switch (delivery?.status) {
    case 'LOCAL_ONLY': return 'Handled on device · this context was not sent';
    case 'DISPATCHED': return 'Request dispatched · awaiting server response';
    case 'ACKNOWLEDGED': return 'Server responded to this context';
    case 'UNCONFIRMED': return 'Request attempted · receipt not confirmed';
    case 'PREPARED': return 'Prepared on device · not dispatched';
    default: return 'No delivery evidence yet';
  }
}
