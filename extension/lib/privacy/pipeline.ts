import {
  SanitizedContextSchema,
  type SanitizedElement,
  type SensitiveEntityType,
} from '@contextshield/shared';

import { detectSensitiveText } from './deterministicDetectors';
import { decidePolicy } from './policyEngine';
import type { ContextualPiiScanner } from './rampartScanner';
import { redactText } from './textRedactor';
import { localizeTaskFieldValues } from './taskHandles';
import { summarizeEvidence } from './evidenceSummary';
import type {
  LocalPageObservation,
  PrivacyPipelineResult,
  RawSensitiveEntity,
  SecretVaultAdapter,
  SensitiveField,
} from './types';

export class PrivacyPipelineUnavailableError extends Error {
  override readonly name = 'PrivacyPipelineUnavailableError';
  readonly code = 'PRIVACY_SCAN_FAILED' as const;
}

function inferHandleKind(inputType: string | null, label: string | null): string | undefined {
  const normalizedLabel = label?.toLowerCase() ?? '';
  if (inputType === 'email' || normalizedLabel.includes('email')) return 'EMAIL';
  if (inputType === 'tel' || normalizedLabel.includes('phone')) return 'PHONE';
  if (normalizedLabel.includes('mobile')) return 'PHONE';
  if (inputType === 'password' || normalizedLabel.includes('password')) return 'PASSWORD';
  if (normalizedLabel.includes('upi')) return 'UPI_ID';
  if (normalizedLabel.includes('first name')) return 'GIVEN_NAME';
  if (normalizedLabel.includes('last name')) return 'SURNAME';
  if (normalizedLabel.includes('address')) return 'ADDRESS';
  if (normalizedLabel.includes('username') || normalizedLabel.includes('user name')) return 'USERNAME';
  if (normalizedLabel.includes('name')) return 'PERSON_NAME';
  if (inputType === 'search' || normalizedLabel.includes('search')) return 'TEXT';
  if (inputType === 'text' && normalizedLabel.includes('text input')) return 'TEXT';
  return undefined;
}

const CONTEXTUAL_PERSON_OR_ADDRESS = new Set([
  'GIVEN_NAME',
  'SURNAME',
  'BUILDING_NUMBER',
  'STREET_NAME',
  'SECONDARY_ADDRESS',
]);
const PRIVATE_CONTROL_CUE = /\b(?:name|person|recipient|patient|customer|address|street|beneficiary|account holder|employee|doctor|contact)\b/i;
const GENERIC_CONTROL_VALUE = /^(?:(?:option|checkbox|radio(?:\s+button)?|button|item|choice|field|row)\s*(?:#|no\.?|number)?\s*\d+|[a-z0-9][a-z0-9+#._/-]{0,31})$/i;

function placeholderLabel(placeholder: string): string {
  return placeholder.replace(/^\[/, '').replace(/_\d+\]$/, '');
}

function isSafeControlFalsePositive(
  field: SensitiveField,
  role: string | null,
  value: string,
  contextLabel: string | null,
  placeholders: readonly string[],
): boolean {
  if (!['OPTION', 'CONTROL_VALUE', 'LABEL'].includes(field)) return false;
  if (!['combobox', 'checkbox', 'radio', 'button', 'option'].includes(role ?? '')) return false;
  if (PRIVATE_CONTROL_CUE.test(contextLabel ?? '')) return false;
  if (!GENERIC_CONTROL_VALUE.test(value.trim())) return false;
  return (
    placeholders.length > 0 &&
    placeholders.every((placeholder) =>
      CONTEXTUAL_PERSON_OR_ADDRESS.has(placeholderLabel(placeholder)),
    )
  );
}

function mappedContextualType(placeholder: string): SensitiveEntityType {
  const label = placeholderLabel(placeholder);
  if (label === 'GIVEN_NAME' || label === 'SURNAME') return 'PERSON_NAME';
  if (label === 'PHONE') return 'PHONE';
  if (label === 'EMAIL') return 'EMAIL';
  if (label === 'CREDIT_CARD') return 'PAYMENT_CARD';
  if (label === 'BANK_ACCOUNT' || label === 'ROUTING_NUMBER') return 'ACCOUNT_ID';
  if (
    label === 'BUILDING_NUMBER' ||
    label === 'STREET_NAME' ||
    label === 'SECONDARY_ADDRESS'
  ) return 'ADDRESS';
  return 'OTHER';
}

export class LocalPrivacyPipeline {
  constructor(
    private readonly vault: SecretVaultAdapter,
    private readonly contextualScanner?: ContextualPiiScanner,
  ) {}

  async sanitize(local: LocalPageObservation, task: string): Promise<PrivacyPipelineResult> {
    const started = performance.now();
    let sequence = 0;
    const nextEntityId = () => `pii_${++sequence}`;
    const rawEntities: RawSensitiveEntity[] = [];

    const detect = (
      value: string | null,
      field: SensitiveField,
      elementId: string | null,
      optionIndex: number | null = null,
      source: 'DOM' | 'OCR' = 'DOM',
    ): void => {
      if (!value) return;
      rawEntities.push(
        ...detectSensitiveText(
          value,
          field,
          field === 'PRIVATE_VALUE' ? 'INPUT_METADATA' : source,
          elementId,
          nextEntityId,
          optionIndex,
        ),
      );
    };

    detect(task, 'TASK', null);
    for (const element of local.observation.elements) {
      const source = element.sources?.includes('OCR') && !element.sources.includes('DOM') ? 'OCR' : 'DOM';
      detect(element.text, 'TEXT', element.id, null, source);
      detect(element.label, 'LABEL', element.id, null, source);
      element.options.forEach((option, index) => detect(option, 'OPTION', element.id, index, source));
      detect(element.control_value, 'CONTROL_VALUE', element.id, null, source);
    }

    for (const privateValue of local.privateValues) {
      const before = rawEntities.length;
      detect(privateValue.value, 'PRIVATE_VALUE', privateValue.elementId);
      const input = local.observation.elements.find((element) => element.id === privateValue.elementId);
      const kind = inferHandleKind(privateValue.inputType, input?.label ?? null);
      const metadataType = privateValue.inputType === 'password' ? 'PASSWORD'
        : ['GIVEN_NAME', 'SURNAME', 'PERSON_NAME'].includes(kind ?? '') ? 'PERSON_NAME'
          : kind === 'ADDRESS' ? 'ADDRESS' : null;
      if (rawEntities.length === before && metadataType) {
        rawEntities.push({
          entity: {
            entity_id: nextEntityId(),
            type: metadataType,
            source: 'INPUT_METADATA',
            confidence: 1,
            element_id: privateValue.elementId,
            region_id: null,
          },
          rawValue: privateValue.value,
          start: 0,
          end: privateValue.value.length,
          field: 'PRIVATE_VALUE',
          optionIndex: null,
        });
      }
    }

    for (const element of local.observation.elements) {
      if (element.input_type !== 'password') continue;
      const alreadyDetected = rawEntities.some(
        (raw) => raw.entity.element_id === element.id && raw.entity.type === 'PASSWORD',
      );
      if (!alreadyDetected) {
        rawEntities.push({
          entity: {
            entity_id: nextEntityId(),
            type: 'PASSWORD',
            source: 'INPUT_METADATA',
            confidence: 1,
            element_id: element.id,
            region_id: null,
          },
          rawValue: '',
          start: 0,
          end: 0,
          field: 'PRIVATE_VALUE',
          optionIndex: null,
        });
      }
    }

    const hintedRegions = new Set(local.visualHints.map((hint) => hint.regionId));
    for (const hint of local.visualHints) {
      rawEntities.push({
        entity: {
          entity_id: nextEntityId(),
          type: hint.type,
          source: 'VISION',
          confidence: 1,
          element_id: null,
          region_id: hint.regionId,
        },
        rawValue: '',
        start: 0,
        end: 0,
        field: 'VISUAL',
        optionIndex: null,
        evidenceId: hint.evidenceId,
      });
    }
    for (const hint of local.ocrHints) {
      rawEntities.push({
        entity: {
          entity_id: nextEntityId(),
          type: hint.type,
          source: 'OCR',
          confidence: hint.confidence,
          element_id: null,
          region_id: hint.regionId,
        },
        rawValue: hint.rawValue ?? '',
        start: 0,
        end: 0,
        field: 'VISUAL',
        optionIndex: null,
      });
    }
    for (const region of local.observation.visual_regions) {
      if (!region.requires_analysis || hintedRegions.has(region.id)) continue;
      rawEntities.push({
        entity: {
          entity_id: nextEntityId(),
          type: 'PRIVATE_DOCUMENT',
          source: 'VISION',
          confidence: 0.5,
          element_id: null,
          region_id: region.id,
        },
        rawValue: '',
        start: 0,
        end: 0,
        field: 'VISUAL',
        optionIndex: null,
      });
    }

    const decisions = rawEntities.map((entity) => decidePolicy(entity, this.vault));
    if (decisions.length !== rawEntities.length) {
      throw new PrivacyPipelineUnavailableError('Every entity must receive one policy decision');
    }
    const decisionsById = new Map(decisions.map((decision) => [decision.entity_id, decision]));

    const entitiesFor = (
      elementId: string | null,
      field: SensitiveField,
      optionIndex: number | null = null,
    ) =>
      rawEntities.filter(
        (raw) =>
          raw.entity.element_id === elementId &&
          raw.field === field &&
          raw.optionIndex === optionIndex,
      );

    const privateValuesByElement = new Map(
      local.privateValues.map((privateValue) => [privateValue.elementId, privateValue]),
    );
    // Create vault entries from the already-deterministically-redacted task before
    // attaching value handles to empty controls. This keeps raw task values local
    // while making the matching handles available during element sanitization.
    let sanitizedTask = redactText(task, entitiesFor(null, 'TASK'), decisionsById) ?? '';
    sanitizedTask = localizeTaskFieldValues(sanitizedTask, this.vault);
    const fieldWords: Record<string, RegExp> = {
      EMAIL: /\bemail\b/i, PHONE: /\b(?:phone|mobile)\b/i, PERSON_NAME: /\b(?:full\s+)?name\b/i,
      GIVEN_NAME: /\bfirst\s+name\b/i, SURNAME: /\blast\s+name\b/i, ADDRESS: /\baddress\b/i,
      PASSWORD: /\bpassword\b/i, OTP: /\botp\b/i, UPI_ID: /\bupi\b/i, USERNAME: /\buser\s*name\b/i,
      TEXT: /\b(?:text\s+input|search)\b/i,
    };
    const sanitizedElements: SanitizedElement[] = local.observation.elements.map((element) => {
      const privateValue = privateValuesByElement.get(element.id);
      const desiredKind = inferHandleKind(element.input_type, element.label);
      const taskHandle = desiredKind ? sanitizedTask.match(new RegExp(`\\bLOCAL_${desiredKind}_[1-9][0-9]*\\b`))?.[0] : undefined;
      const requested = desiredKind && (taskHandle || (/\b(?:fill|enter|type|use|add|provide)\b/i.test(task) && fieldWords[desiredKind]?.test(task)));
      const matchingFields = local.observation.elements.filter((candidate) => !candidate.value_present && inferHandleKind(candidate.input_type, candidate.label) === desiredKind);
      const handle =
        !privateValue && !element.value_present && desiredKind && requested && matchingFields.length === 1
          ? (taskHandle ?? this.vault.firstHandle(desiredKind) ?? null)
          : null;
      const sanitizedOptions = element.options.map(
        (option, index) =>
          redactText(option, entitiesFor(element.id, 'OPTION', index), decisionsById) ?? '',
      );
      const selectedOptionIndex = element.selected_option === null
        ? -1
        : element.options.indexOf(element.selected_option);
      return {
        id: element.id,
        role: element.role,
        text: redactText(element.text, entitiesFor(element.id, 'TEXT'), decisionsById),
        label: redactText(element.label, entitiesFor(element.id, 'LABEL'), decisionsById),
        input_type: element.input_type,
        value_handle: handle,
        enabled: element.enabled,
        selected: element.selected,
        value_present: element.value_present,
        options: sanitizedOptions,
        selected_option:
          selectedOptionIndex >= 0 ? (sanitizedOptions[selectedOptionIndex] ?? null) : null,
        control_value: redactText(
          element.control_value,
          entitiesFor(element.id, 'CONTROL_VALUE'),
          decisionsById,
        ),
        dom_index: element.dom_index,
        bbox: element.bbox,
        sources: element.sources ?? ['DOM'],
      };
    });

    if (this.contextualScanner) {
      const targets: Array<{
        value: string;
        field: SensitiveField;
        elementId: string | null;
        optionIndex: number | null;
        role: string | null;
        contextLabel: string | null;
        apply: (safe: string) => void;
      }> = [];
      targets.push({
        value: sanitizedTask,
        field: 'TASK',
        elementId: null,
        optionIndex: null,
        role: null,
        contextLabel: null,
        apply: (safe) => {
          sanitizedTask = safe;
        },
      });
      sanitizedElements.forEach((element) => {
        if (element.text) {
          targets.push({
            value: element.text,
            field: 'TEXT',
            elementId: element.id,
            optionIndex: null,
            role: element.role,
            contextLabel: element.label,
            apply: (safe) => {
              element.text = safe;
            },
          });
        }
        if (element.label) {
          targets.push({
            value: element.label,
            field: 'LABEL',
            elementId: element.id,
            optionIndex: null,
            role: element.role,
            contextLabel: element.label,
            apply: (safe) => {
              element.label = safe;
            },
          });
        }
        element.options.forEach((option, optionIndex) => {
          targets.push({
            value: option,
            field: 'OPTION',
            elementId: element.id,
            optionIndex,
            role: element.role,
            contextLabel: element.label,
            apply: (safe) => {
              element.options[optionIndex] = safe;
              if (element.selected_option === option) element.selected_option = safe;
            },
          });
        });
        if (element.control_value) {
          targets.push({
            value: element.control_value,
            field: 'CONTROL_VALUE',
            elementId: element.id,
            optionIndex: null,
            role: element.role,
            contextLabel: element.label,
            apply: (safe) => {
              element.control_value = safe;
            },
          });
        }
      });

      let protections: Awaited<ReturnType<ContextualPiiScanner['protectMany']>>;
      try {
        protections = await this.contextualScanner.protectMany(targets.map((target) => target.value));
      } catch {
        throw new PrivacyPipelineUnavailableError('Contextual PII inference failed closed');
      }
      if (protections.length !== targets.length) {
        throw new PrivacyPipelineUnavailableError('Contextual PII output was incomplete');
      }
      protections.forEach((protection, index) => {
        const target = targets[index];
        if (!target) throw new PrivacyPipelineUnavailableError('Contextual PII target mismatch');
        const preserveOriginal = isSafeControlFalsePositive(
          target.field,
          target.role,
          target.value,
          target.contextLabel,
          protection.placeholders,
        );
        let protectedText = preserveOriginal ? target.value : protection.text;
        if (!preserveOriginal && target.field === 'TASK') {
          for (const localValue of protection.localValues ?? []) {
            if (!localValue.value || localValue.value === localValue.placeholder) continue;
            const handle = this.vault.store(placeholderLabel(localValue.placeholder), localValue.value);
            protectedText = protectedText.replaceAll(localValue.placeholder, handle);
          }
        }
        target.apply(protectedText);
        if (preserveOriginal) return;
        // Join adjacent model tokens (given name + surname, address parts) for
        // counting, while retaining every individual redaction decision.
        const spans = (protection.localValues ?? []).map((value) => ({
          ...value,
          type: mappedContextualType(value.placeholder),
          start: target.value.indexOf(value.value),
          end: target.value.indexOf(value.value) + value.value.length,
        })).filter((span) => span.value && span.start >= 0).sort((a, b) => a.start - b.start);
        const groupedValues = new Map<string, string>();
        for (let i = 0; i < spans.length; i += 1) {
          const first = spans[i];
          if (!first) continue;
          let end = first.end;
          const members = [first.placeholder];
          if (first.type === 'PERSON_NAME' || first.type === 'ADDRESS') {
            while (spans[i + 1]?.type === first.type) {
              const next = spans[i + 1];
              if (!next || next.start < end || !/^[\s,-]*$/.test(target.value.slice(end, next.start))) break;
              end = next.end;
              members.push(next.placeholder);
              i += 1;
            }
          }
          for (const placeholder of members) groupedValues.set(placeholder, target.value.slice(first.start, end));
        }
        for (const placeholder of protection.placeholders) {
          const mappedType = mappedContextualType(placeholder);
          const entityId = nextEntityId();
          rawEntities.push({
            entity: {
              entity_id: entityId,
              type: mappedType,
              source: 'DOM',
              confidence: 0.9,
              element_id: target.elementId,
              region_id: null,
            },
            rawValue: groupedValues.get(placeholder) ?? '',
            start: 0,
            end: 0,
            field: target.field,
            optionIndex: target.optionIndex,
            contextual: true,
          });
          decisions.push({ entity_id: entityId, decision: 'ABSTRACT', replacement: placeholder });
        }
      });
    }

    const evidence = summarizeEvidence(rawEntities);
    const privacySummary = evidence.uniqueItems;

    const context = SanitizedContextSchema.parse({
      task: sanitizedTask,
      origin: local.observation.origin,
      snapshot_id: local.observation.snapshot_id,
      elements: sanitizedElements,
      safe_visual_crops: local.safeVisualCrops,
      privacy_summary: privacySummary,
    });

    const blockedVisualRegions = new Set(rawEntities.filter(
      (raw) => raw.field === 'VISUAL' && decisionsById.get(raw.entity.entity_id)?.decision === 'DROP',
    ).map((raw) => raw.evidenceId ?? raw.entity.region_id)).size;

    return {
      context,
      entities: rawEntities.map((raw) => raw.entity),
      decisions,
      serverPreview: JSON.stringify(context, null, 2),
      blockedVisualRegions,
      processingMs: performance.now() - started,
      evidence,
    };
  }
}
