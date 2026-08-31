import type {
  AgentAction,
  SensitiveEntityType,
  VerificationResult,
} from '@contextshield/shared';

import type { LocalPageObservation } from '../privacy/types';

export type AgentPhase =
  | 'IDLE'
  | 'OBSERVE'
  | 'SANITIZE'
  | 'PLAN'
  | 'EXECUTE'
  | 'VERIFY'
  | 'WAITING_CONFIRMATION'
  | 'COMPLETE'
  | 'FAILED'
  | 'STOPPED';

export interface TimelineEntry {
  id: string;
  at: number;
  phase: AgentPhase;
  message: string;
  safeDetail?: string;
}

export interface PendingConfirmation {
  kind: 'CONFIRMATION' | 'CLARIFICATION';
  action: AgentAction;
  prompt: string;
}

export interface ClientStageMetrics {
  steps: number;
  pixelRecords: number;
  modelInitializationMs: number;
  observationMs: number;
  screenshotCaptureMs: number;
  visualInferenceAndRedactionMs: number;
  privacyClassificationMs: number;
  localPlanningMs: number;
  serverPlanningMs: number;
  actionExecutionMs: number;
  verificationMs: number;
  totalMs: number;
}

export interface PublicAgentState {
  phase: AgentPhase;
  running: boolean;
  task: string;
  origin: string | null;
  sessionId: string | null;
  privacySummary: Partial<Record<SensitiveEntityType, number>>;
  blockedVisualRegions: number;
  localProcessingMs: number | null;
  clientMetrics: ClientStageMetrics;
  serverPreview: string | null;
  timeline: TimelineEntry[];
  pendingConfirmation: PendingConfirmation | null;
  secretHandles: string[];
  lastAction: AgentAction | null;
  resultSummary: string | null;
  error: string | null;
  backendStatus: 'CHECKING' | 'ONLINE' | 'OFFLINE';
  backendDetail: string | null;
}

export type ExtensionRequest =
  | { type: 'PING_CONTENT_V2' }
  | { type: 'OBSERVE_PAGE_V2' }
  | {
      type: 'EXECUTE_ACTION_V2';
      action: AgentAction;
      snapshotId: string;
      origin: string;
      fingerprint: string;
      resolvedValue?: string;
      confirmed: boolean;
    }
  | { type: 'START_AGENT'; task: string }
  | { type: 'STOP_AGENT' }
  | { type: 'GET_AGENT_STATE' }
  | { type: 'CHECK_BACKEND_HEALTH' }
  | { type: 'SET_SECRET'; kind: string; value: string }
  | { type: 'CLEAR_SECRETS' }
  | { type: 'CONFIRM_ACTION'; actionId: string; confirmed: boolean }
  | { type: 'ANSWER_CLARIFICATION'; actionId: string; answer: string };

export type ContentResponse =
  | { ok: true; kind: 'PING'; origin: string; protocolVersion: 2 }
  | { ok: true; kind: 'OBSERVATION'; local: LocalPageObservation }
  | { ok: true; kind: 'VERIFICATION'; result: VerificationResult }
  | { ok: false; error: string };

export interface AgentCommandResponse {
  ok: boolean;
  state: PublicAgentState;
  handle?: string;
  error?: string;
}
