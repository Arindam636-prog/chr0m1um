import {
  AgentStartResponseSchema,
  AgentStepRequestSchema,
  SanitizedContextSchema,
  VerificationRequestSchema,
  VerificationResponseSchema,
  type AgentStartResponse,
  type SanitizedContext,
  type VerificationResponse,
  type VerificationResult,
} from '@contextshield/shared';

const MAX_PAYLOAD_BYTES = 2_500_000;
const AGENT_REQUEST_TIMEOUT_MS = 45_000;
const SUSPICIOUS_KEY = /(?:raw_dom|raw_screenshot|cookie|authorization|password|otp|token)/i;
const OBVIOUS_SENSITIVE_VALUE = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b[A-Z]{5}\d{4}[A-Z]\b/,
  /\b[A-Z0-9][A-Z0-9._-]{1,}@[A-Z]{2,}\b/i,
  /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/,
  /\b(?:\d[ -]*?){13,19}\b/,
  /\b(?:password|otp)\s*[:=]\s*\S+/i,
];

export class PrivacyAssertionError extends Error {
  override readonly name = 'PrivacyAssertionError';
}

function assertEndpoint(endpoint: URL): void {
  const isLocal = endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost';
  if (endpoint.protocol !== 'https:' && !isLocal) {
    throw new PrivacyAssertionError('Only HTTPS or loopback endpoints are permitted');
  }
}

function inspectPayload(value: SanitizedContext, knownSecrets: readonly string[]): void {
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD_BYTES) {
    throw new PrivacyAssertionError('Sanitized payload exceeds size limit');
  }

  for (const secret of knownSecrets) {
    if (secret && serialized.includes(secret)) {
      throw new PrivacyAssertionError('A known local secret is present in the payload');
    }
  }

  const humanText = [
    value.task,
    ...value.elements.flatMap((element) => [
      element.text,
      element.label,
      element.selected_option,
      element.control_value,
      ...element.options,
    ]),
  ]
    .filter((part): part is string => typeof part === 'string')
    .join('\n');
  if (OBVIOUS_SENSITIVE_VALUE.some((pattern) => pattern.test(humanText))) {
    throw new PrivacyAssertionError('Payload appears to contain an unsanitized sensitive value');
  }

  const visit = (node: unknown, parentKey?: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, parentKey));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      const isPrivacyCategoryCount = parentKey === 'privacy_summary';
      if (!isPrivacyCategoryCount && SUSPICIOUS_KEY.test(key)) {
        throw new PrivacyAssertionError(`Forbidden outbound property: ${key}`);
      }
      visit(child, key);
    }
  };
  visit(value);
}

function serverResponseError(response: Response): Error {
  if (response.status === 502) return new Error('PLANNER_FAILED');
  if (response.status >= 500) return new Error('AGENT_SERVER_FAILED');
  return new Error(`Agent server returned HTTP ${response.status}`);
}

async function fetchAgent(
  fetchImpl: typeof fetch,
  input: URL,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(input, {
      ...init,
      signal: AbortSignal.timeout(AGENT_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      throw new Error('AGENT_TIMEOUT', { cause: error });
    }
    throw new Error('AGENT_SERVER_OFFLINE', { cause: error });
  }
}

export async function checkAgentHealth(
  endpoint: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  assertEndpoint(endpoint);
  let response: Response;
  try {
    response = await fetchImpl(new URL('/health', endpoint), {
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(3_000),
    });
  } catch (error) {
    throw new Error('AGENT_SERVER_OFFLINE', { cause: error });
  }
  if (!response.ok) throw new Error('AGENT_SERVER_OFFLINE');
  const payload = await response.json() as {
    model_backend?: unknown;
    planner_ready?: unknown;
  };
  if (payload.planner_ready === false) throw new Error('AGENT_SERVER_OFFLINE');
  return typeof payload.model_backend === 'string' ? payload.model_backend : 'local';
}

/** The only module allowed to send agent context to the backend. */
export async function startAgent(
  endpoint: URL,
  context: SanitizedContext,
  knownSecrets: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<AgentStartResponse> {
  assertEndpoint(endpoint);
  const safeContext = SanitizedContextSchema.parse(context);
  inspectPayload(safeContext, knownSecrets);

  const response = await fetchAgent(fetchImpl, new URL('/v1/agent/start', endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(safeContext),
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) {
    throw serverResponseError(response);
  }
  return AgentStartResponseSchema.parse(await response.json());
}

export async function stepAgent(
  endpoint: URL,
  sessionId: string,
  context: SanitizedContext,
  knownSecrets: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<AgentStartResponse> {
  assertEndpoint(endpoint);
  const request = AgentStepRequestSchema.parse({ session_id: sessionId, context });
  inspectPayload(request.context, knownSecrets);
  const response = await fetchAgent(fetchImpl, new URL('/v1/agent/step', endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw serverResponseError(response);
  return AgentStartResponseSchema.parse(await response.json());
}

export async function verifyAgent(
  endpoint: URL,
  sessionId: string,
  result: VerificationResult,
  fetchImpl: typeof fetch = fetch,
): Promise<VerificationResponse> {
  assertEndpoint(endpoint);
  const request = VerificationRequestSchema.parse({ session_id: sessionId, result });
  const response = await fetchAgent(fetchImpl, new URL('/v1/agent/verify', endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw serverResponseError(response);
  return VerificationResponseSchema.parse(await response.json());
}
