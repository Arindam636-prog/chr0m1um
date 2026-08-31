import { z } from 'zod';

const HttpUrlSchema = z
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'Only HTTP(S) URLs are supported');

export const BBoxSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  })
  .strict();

export const PerceptionSourceSchema = z.enum(['DOM', 'VISION', 'OCR']);

export const ViewportSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const PageElementSchema = z
  .object({
    id: z.string().regex(/^el_[A-Za-z0-9_-]+$/),
    role: z.string().min(1).max(64),
    tag: z.string().min(1).max(32),
    text: z.string().max(2_000).nullable(),
    label: z.string().max(500).nullable(),
    input_type: z.string().max(32).nullable(),
    bbox: BBoxSchema,
    visible: z.boolean(),
    enabled: z.boolean(),
    selected: z.boolean().nullable(),
    value_present: z.boolean(),
    options: z.array(z.string().min(1).max(500)).max(500),
    selected_option: z.string().min(1).max(500).nullable().default(null),
    control_value: z.string().min(1).max(500).nullable().default(null),
    dom_index: z.number().int().nonnegative().default(0),
    sources: z.array(PerceptionSourceSchema).min(1).max(3).optional(),
  })
  .strict();

export const VisualRegionSchema = z
  .object({
    id: z.string().regex(/^region_[A-Za-z0-9_-]+$/),
    kind: z.enum(['CANVAS', 'IMAGE', 'PDF', 'VISUAL_CONTROL', 'UNKNOWN']),
    bbox: BBoxSchema,
    requires_analysis: z.boolean(),
  })
  .strict();

export const PageObservationSchema = z
  .object({
    snapshot_id: z.string().regex(/^snap_[A-Za-z0-9_-]+$/),
    origin: HttpUrlSchema.max(2_048),
    url: HttpUrlSchema.max(8_192),
    viewport: ViewportSchema,
    elements: z.array(PageElementSchema).max(2_000),
    visual_regions: z.array(VisualRegionSchema).max(200),
    timestamp: z.number().int().nonnegative(),
  })
  .strict();

export const SensitiveEntityTypeSchema = z.enum([
  'EMAIL',
  'PHONE',
  'PAN',
  'GSTIN',
  'IFSC',
  'UPI_ID',
  'PAYMENT_CARD',
  'OTP',
  'PASSWORD',
  'AADHAAR_LIKE',
  'ACCOUNT_ID',
  'PERSON_NAME',
  'ADDRESS',
  'MEDICAL',
  'FACE',
  'PRIVATE_DOCUMENT',
  'OTHER',
]);

export const SensitiveEntitySchema = z
  .object({
    entity_id: z.string().regex(/^pii_[A-Za-z0-9_-]+$/),
    type: SensitiveEntityTypeSchema,
    source: z.enum(['DOM', 'OCR', 'VISION', 'INPUT_METADATA']),
    confidence: z.number().min(0).max(1),
    element_id: PageElementSchema.shape.id.nullable(),
    region_id: VisualRegionSchema.shape.id.nullable(),
  })
  .strict();

export const PolicyKindSchema = z.enum([
  'KEEP',
  'ABSTRACT',
  'LOCAL_HANDLE',
  'SANITIZED_CROP',
  'DROP',
  'ASK',
]);

export const PolicyDecisionSchema = z
  .object({
    entity_id: SensitiveEntitySchema.shape.entity_id,
    decision: PolicyKindSchema,
    replacement: z.string().max(128).nullable(),
  })
  .strict();

export const SanitizedElementSchema = z
  .object({
    id: PageElementSchema.shape.id,
    role: z.string().min(1).max(64),
    text: z.string().max(2_000).nullable(),
    label: z.string().max(500).nullable(),
    input_type: z.string().max(32).nullable(),
    value_handle: z.string().regex(/^LOCAL_[A-Z0-9_]+$/).nullable(),
    enabled: z.boolean(),
    selected: z.boolean().nullable(),
    value_present: z.boolean(),
    options: z.array(z.string().min(1).max(500)).max(500),
    selected_option: z.string().min(1).max(500).nullable().default(null),
    control_value: z.string().min(1).max(500).nullable().default(null),
    dom_index: z.number().int().nonnegative().default(0),
    bbox: BBoxSchema.nullable().optional(),
    sources: z.array(PerceptionSourceSchema).min(1).max(3).optional(),
  })
  .strict();

export const SafeVisualCropSchema = z
  .object({
    id: z.string().regex(/^crop_[A-Za-z0-9_-]+$/),
    mime_type: z.enum(['image/png', 'image/jpeg']),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive().max(4_096),
    height: z.number().int().positive().max(4_096),
    data_base64: z.string().max(2_000_000),
    redaction_verified: z.literal(true),
  })
  .strict();

export const SanitizedContextSchema = z
  .object({
    task: z.string().min(1).max(4_000),
    origin: HttpUrlSchema.max(2_048),
    snapshot_id: PageObservationSchema.shape.snapshot_id,
    elements: z.array(SanitizedElementSchema).max(2_000),
    safe_visual_crops: z.array(SafeVisualCropSchema).max(8),
    privacy_summary: z.partialRecord(
      SensitiveEntityTypeSchema,
      z.number().int().nonnegative(),
    ),
  })
  .strict();

const ActionBaseSchema = z.object({
  action_id: z.string().regex(/^act_[A-Za-z0-9_-]+$/),
  snapshot_id: PageObservationSchema.shape.snapshot_id,
  reason: z.string().min(1).max(1_000),
});

export const AgentActionSchema = z.discriminatedUnion('type', [
  ActionBaseSchema.extend({
    type: z.literal('CLICK'),
    element_id: PageElementSchema.shape.id,
  }).strict(),
  ActionBaseSchema.extend({
    type: z.literal('TYPE_HANDLE'),
    element_id: PageElementSchema.shape.id,
    handle: z.string().regex(/^LOCAL_[A-Z0-9_]+$/),
  }).strict(),
  ActionBaseSchema.extend({
    type: z.literal('SELECT'),
    element_id: PageElementSchema.shape.id,
    option: z.string().min(1).max(500),
  }).strict(),
  ActionBaseSchema.extend({
    type: z.literal('SCROLL'),
    direction: z.enum(['UP', 'DOWN']),
    amount: z.number().int().min(1).max(1_500),
  }).strict(),
  ActionBaseSchema.extend({
    type: z.literal('ASK_USER'),
    question: z.string().min(1).max(1_000),
  }).strict(),
  ActionBaseSchema.extend({
    type: z.literal('FINISH'),
    summary: z.string().min(1).max(2_000),
  }).strict(),
]);

export const VerificationResultSchema = z
  .object({
    action_id: ActionBaseSchema.shape.action_id,
    success: z.boolean(),
    page_changed: z.boolean(),
    new_snapshot_required: z.boolean(),
    error: z
      .enum([
        'PERCEPTION_FAILED',
        'PRIVACY_SCAN_FAILED',
        'REDACTION_FAILED',
        'PRIVACY_ASSERTION_FAILED',
        'NETWORK_FAILED',
        'MODEL_FAILED',
        'INVALID_AGENT_ACTION',
        'STALE_SNAPSHOT',
        'ELEMENT_NOT_FOUND',
        'CONFIRMATION_REQUIRED',
        'ACTION_FAILED',
        'VERIFICATION_FAILED',
      ])
      .nullable(),
  })
  .strict();

export const AgentStartResponseSchema = z
  .object({
    session_id: z.uuid(),
    state: z.enum(['OBSERVE', 'PLAN', 'EXECUTE', 'VERIFY', 'COMPLETE', 'FAILED']),
    action: AgentActionSchema,
  })
  .strict();

export const AgentStepRequestSchema = z
  .object({
    session_id: z.uuid(),
    context: SanitizedContextSchema,
  })
  .strict();

export const VerificationRequestSchema = z
  .object({
    session_id: z.uuid(),
    result: VerificationResultSchema,
  })
  .strict();

export const VerificationResponseSchema = z
  .object({
    session_id: z.uuid(),
    state: z.enum(['OBSERVE', 'PLAN', 'EXECUTE', 'VERIFY', 'COMPLETE', 'FAILED']),
    accepted: z.boolean(),
  })
  .strict();

export type BBox = z.infer<typeof BBoxSchema>;
export type PageElement = z.infer<typeof PageElementSchema>;
export type PageObservation = z.infer<typeof PageObservationSchema>;
export type SensitiveEntity = z.infer<typeof SensitiveEntitySchema>;
export type SensitiveEntityType = z.infer<typeof SensitiveEntityTypeSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type SanitizedElement = z.infer<typeof SanitizedElementSchema>;
export type SafeVisualCrop = z.infer<typeof SafeVisualCropSchema>;
export type SanitizedContext = z.infer<typeof SanitizedContextSchema>;
export type AgentAction = z.infer<typeof AgentActionSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type AgentStartResponse = z.infer<typeof AgentStartResponseSchema>;
export type AgentStepRequest = z.infer<typeof AgentStepRequestSchema>;
export type VerificationRequest = z.infer<typeof VerificationRequestSchema>;
export type VerificationResponse = z.infer<typeof VerificationResponseSchema>;
