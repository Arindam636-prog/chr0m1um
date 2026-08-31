import type { PolicyDecision, SensitiveEntityType } from '@contextshield/shared';

import type { RawSensitiveEntity, SecretVaultAdapter } from './types';

const DROP_TYPES = new Set<SensitiveEntityType>([
  'PASSWORD',
  'OTP',
  'PAYMENT_CARD',
  'AADHAAR_LIKE',
  'PRIVATE_DOCUMENT',
]);

export function decidePolicy(
  entity: RawSensitiveEntity,
  vault: SecretVaultAdapter,
): PolicyDecision {
  if (entity.field === 'PRIVATE_VALUE' || entity.field === 'TASK') {
    if (entity.rawValue) {
      const handle = vault.store(entity.entity.type, entity.rawValue);
      return {
        entity_id: entity.entity.entity_id,
        decision: 'LOCAL_HANDLE',
        replacement: handle,
      };
    }
  }

  if (DROP_TYPES.has(entity.entity.type)) {
    return {
      entity_id: entity.entity.entity_id,
      decision: 'DROP',
      replacement: `<${entity.entity.type}>`,
    };
  }

  if (entity.entity.type === 'FACE') {
    return {
      entity_id: entity.entity.entity_id,
      decision: 'DROP',
      replacement: '<FACE>',
    };
  }

  if (entity.entity.type === 'OTHER') {
    return {
      entity_id: entity.entity.entity_id,
      decision: 'ASK',
      replacement: null,
    };
  }

  return {
    entity_id: entity.entity.entity_id,
    decision: 'ABSTRACT',
    replacement: `<${entity.entity.type}>`,
  };
}

