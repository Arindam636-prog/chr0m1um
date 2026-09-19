import {
  AgentActionSchema,
  type AgentAction,
  type SanitizedContext,
  type VerificationResult,
} from "@contextshield/shared";
import type { LocalPageObservation } from "../privacy/types";
import type { SecretVault, ReleaseScope } from "../vault/secretVault";
import { digest } from "./actionLedger";

/** Both planners use this boundary. A reference to a secret is never authority to use it. */
export async function privateFillGate(input: {
  action: AgentAction;
  local: LocalPageObservation;
  context: SanitizedContext;
  vault: SecretVault;
  tab: number;
  run: number;
  purpose: string;
  confirmed: boolean;
  current: () => boolean;
  preflight: () => Promise<VerificationResult>;
}): Promise<{ value?: string; error?: VerificationResult["error"] }> {
  const { action, local, context, vault } = input;
  if (
    !AgentActionSchema.safeParse(action).success ||
    action.type !== "TYPE_HANDLE"
  )
    return { error: "INVALID_AGENT_ACTION" };
  const field = context.elements.find(
    (element) => element.id === action.element_id,
  );
  const localField = local.observation.elements.find(
    (element) => element.id === action.element_id,
  );
  if (
    !input.current() ||
    !local.documentId ||
    context.origin !== local.observation.origin ||
    action.snapshot_id !== local.observation.snapshot_id ||
    context.snapshot_id !== action.snapshot_id
  )
    return { error: "STALE_SNAPSHOT" };
  if (
    !field?.enabled ||
    !localField?.visible ||
    field.value_handle !== action.handle ||
    !(["input", "textarea"].includes(localField.tag) || (localField.role === 'textbox' && localField.input_type === 'text'))
  )
    return { error: "PRIVACY_ASSERTION_FAILED" };
  // No resolution or cross-context dispatch of the secret occurs before consent.
  if (!input.confirmed) return { error: "CONFIRMATION_REQUIRED" };
  const scope: ReleaseScope = {
    run: input.run,
    tab: input.tab,
    document: local.documentId,
    origin: context.origin,
    target: field.id,
    fieldType: field.input_type ?? localField.tag,
    purpose: input.purpose,
    actionDigest: await digest(action),
    snapshot: action.snapshot_id,
    fingerprint: local.fingerprint,
  };
  const checked = await input.preflight();
  if (!checked.success) return { error: checked.error ?? "ACTION_FAILED" };
  if (!input.current()) return { error: "STALE_SNAPSHOT" };
  const grantId = vault.approveOnce(action.handle, scope);
  const value = vault.resolve(action.handle, { grantId, scope });
  return value === undefined
    ? { error: "PRIVACY_ASSERTION_FAILED" }
    : { value };
}
