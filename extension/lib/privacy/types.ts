import type {
  PageObservation,
  PolicyDecision,
  SafeVisualCrop,
  SanitizedContext,
  SensitiveEntity,
  SensitiveEntityType,
} from '@contextshield/shared';

export type SensitiveField =
  | 'TASK'
  | 'TEXT'
  | 'LABEL'
  | 'OPTION'
  | 'SELECTED_OPTION'
  | 'CONTROL_VALUE'
  | 'PRIVATE_VALUE'
  | 'VISUAL';

export interface RawSensitiveEntity {
  entity: SensitiveEntity;
  rawValue: string;
  start: number;
  end: number;
  field: SensitiveField;
  optionIndex: number | null;
}

export interface LocalPrivateValue {
  elementId: string;
  inputType: string;
  value: string;
}

export interface LocalVisualHint {
  regionId: string;
  type: 'FACE' | 'PRIVATE_DOCUMENT';
}

export interface LocalOcrHint {
  regionId: string;
  type: SensitiveEntityType;
  confidence: number;
}

export interface LocalPageObservation {
  observation: PageObservation;
  privateValues: LocalPrivateValue[];
  visualHints: LocalVisualHint[];
  ocrHints: LocalOcrHint[];
  safeVisualCrops: SafeVisualCrop[];
  fingerprint: string;
}

export interface PrivacyPipelineResult {
  context: SanitizedContext;
  entities: SensitiveEntity[];
  decisions: PolicyDecision[];
  serverPreview: string;
  blockedVisualRegions: number;
  processingMs: number;
}

export interface SecretVaultAdapter {
  store(kind: string, value: string): string;
  firstHandle(kind: string): string | undefined;
}
