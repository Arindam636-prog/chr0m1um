import type { PolicyDecision } from '@contextshield/shared';

import type { RawSensitiveEntity } from './types';

export function redactText(
  text: string | null,
  entities: readonly RawSensitiveEntity[],
  decisions: ReadonlyMap<string, PolicyDecision>,
): string | null {
  if (text === null) return null;
  let output = text;
  const sorted = [...entities].sort((left, right) => right.start - left.start);
  for (const raw of sorted) {
    const decision = decisions.get(raw.entity.entity_id);
    if (!decision) throw new Error(`Missing privacy policy for ${raw.entity.entity_id}`);
    if (decision.decision === 'KEEP') continue;
    const replacement = decision.replacement ?? `<${raw.entity.type}>`;
    output = `${output.slice(0, raw.start)}${replacement}${output.slice(raw.end)}`;
  }
  return output;
}

