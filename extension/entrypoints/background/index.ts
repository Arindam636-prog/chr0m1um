import type {
  AgentAction,
  AgentStartResponse,
  VerificationResult,
  SanitizedContext,
} from '@contextshield/shared';

import { safeLogger } from '../../lib/logging/safeLogger';
import type {
  AgentCommandResponse,
  ClientStageMetrics,
  ContentResponse,
  ExtensionRequest,
  PublicAgentState,
} from '../../lib/messaging/protocol';
import {
  checkAgentHealth,
  PrivacyAssertionError,
  startAgent,
  stepAgent,
  verifyAgent,
} from '../../lib/network/privacyGateway';
import { LocalPrivacyPipeline } from '../../lib/privacy/pipeline';
import { OffscreenRampartBridge } from '../../lib/privacy/offscreenRampartBridge';
import { OffscreenVisualBridge } from '../../lib/privacy/offscreenVisualBridge';
import type { LocalPageObservation } from '../../lib/privacy/types';
import { fuseScreenState } from '../../lib/perception/fuseScreenState';
import { SecretVault } from '../../lib/vault/secretVault';
import { finishRepresentsSuccess } from '../../lib/agent/completionGuard';
import { planLocalAction } from '../../lib/agent/localController';
import { planRailwayRehearsal, RAILWAY_TASK } from '../../lib/agent/railwayRehearsal';
import { ActionLedger, digest, type LedgerEvent } from '../../lib/security/actionLedger';
import { privateFillGate } from '../../lib/security/privateFillGate';
import { PanelCommand } from '../../lib/messaging/panelCommands';
import {
  actionProgressMarker,
  isRepeatedNoProgress,
  type ActionProgressMarker,
} from '../../lib/agent/progressGuard';

const AGENT_ENDPOINT = new URL('http://127.0.0.1:8000');
const MAX_STEPS = 20;
const MAX_ACTIVE_RUN_MS = 120_000;

const vault = new SecretVault();
let privacyPipeline: LocalPrivacyPipeline | null = null;
let rampartScanner: OffscreenRampartBridge | null = null;
let visualScanner: OffscreenVisualBridge | null = null;
let runGeneration = 0;
let ledger = new ActionLedger();
async function recordAction(event: LedgerEvent, action: AgentAction): Promise<void> {
  const currentLedger = ledger;
  await currentLedger.append(event, action.type, await digest(action));
}
let pendingInteraction:
  | { kind: 'CONFIRMATION'; actionId: string; requestId: string; resolve: (confirmed: boolean) => void }
  | { kind: 'CLARIFICATION'; actionId: string; resolve: (answer: string | null) => void }
  | undefined;

const state: PublicAgentState = {
  phase: 'IDLE',
  running: false,
  task: '',
  origin: null,
  sessionId: null,
  privacySummary: {},
  blockedVisualRegions: 0,
  localProcessingMs: null,
  clientMetrics: emptyClientMetrics(),
  serverPreview: null,
  timeline: [],
  pendingConfirmation: null,
  secretHandles: [],
  lastAction: null,
  resultSummary: null,
  error: null,
  backendStatus: 'CHECKING',
  backendDetail: null,
};

function emptyClientMetrics(): ClientStageMetrics {
  return {
    steps: 0,
    pixelRecords: 0,
    modelInitializationMs: 0,
    observationMs: 0,
    screenshotCaptureMs: 0,
    visualInferenceAndRedactionMs: 0,
    privacyClassificationMs: 0,
    localPlanningMs: 0,
    serverPlanningMs: 0,
    actionExecutionMs: 0,
    verificationMs: 0,
    totalMs: 0,
  };
}

function addMetric(metric: keyof ClientStageMetrics, value: number): void {
  state.clientMetrics[metric] += Math.max(0, value);
}

function snapshotState(): PublicAgentState {
  return structuredClone(state);
}

function response(ok: boolean, error?: string, handle?: string): AgentCommandResponse {
  return { ok, state: snapshotState(), error, handle };
}

function timeline(message: string, safeDetail?: string): void {
  state.timeline.push({
    id: `event_${crypto.randomUUID().replaceAll('-', '')}`,
    at: Date.now(),
    phase: state.phase,
    message,
    safeDetail,
  });
  state.timeline = state.timeline.slice(-100);
}

function setPhase(phase: PublicAgentState['phase'], message: string, safeDetail?: string): void {
  state.phase = phase;
  timeline(message, safeDetail);
}

function fail(message: string): void {
  vault.revokeGrants();
  state.running = false;
  state.error = message;
  state.pendingConfirmation = null;
  setPhase('FAILED', message);
}

async function refreshBackendHealth(): Promise<boolean> {
  state.backendStatus = 'CHECKING';
  try {
    const modelBackend = await checkAgentHealth(AGENT_ENDPOINT);
    state.backendStatus = 'ONLINE';
    state.backendDetail = modelBackend === 'llama' ? 'Qwen planner online' : `${modelBackend} planner online`;
    return true;
  } catch {
    state.backendStatus = 'OFFLINE';
    state.backendDetail = 'Local controls work; START.command enables Qwen reasoning';
    return false;
  }
}

async function activeHttpTab(): Promise<{ id: number; origin: string }> {
  const currentWindowTabs = await browser.tabs.query({ active: true, currentWindow: true });
  const currentHttpTab = currentWindowTabs.find(
    (tab) => tab.url && ['http:', 'https:'].includes(new URL(tab.url).protocol),
  );
  const fallbackTabs = currentHttpTab ? [] : await browser.tabs.query({ active: true });
  const tab = currentHttpTab ?? fallbackTabs.find(
    (candidate) =>
      candidate.url && ['http:', 'https:'].includes(new URL(candidate.url).protocol),
  );
  if (tab?.id === undefined || !tab.url) throw new Error('NO_ACTIVE_TAB');
  const url = new URL(tab.url);
  return { id: tab.id, origin: url.origin };
}

function isCurrentContentPong(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { ok?: unknown; kind?: unknown; protocolVersion?: unknown };
  return candidate.ok === true && candidate.kind === 'PING' && candidate.protocolVersion === 2;
}

async function ensureContentScript(tabId: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const pong: unknown = await browser.tabs.sendMessage(tabId, {
        type: 'PING_CONTENT_V2',
      } satisfies ExtensionRequest);
      if (isCurrentContentPong(pong)) return;
    } catch {
      try {
        await browser.scripting.executeScript({
          target: { tabId },
          files: ['/content-scripts/content.js'],
        });
        const pong: unknown = await browser.tabs.sendMessage(tabId, {
          type: 'PING_CONTENT_V2',
        } satisfies ExtensionRequest);
        if (isCurrentContentPong(pong)) return;
      } catch {
        // A navigation can temporarily remove the execution context. Retry briefly.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('CONTENT_UNAVAILABLE');
}

async function observe(tabId: number): Promise<LocalPageObservation> {
  const observed: ContentResponse = await browser.tabs.sendMessage(tabId, {
    type: 'OBSERVE_PAGE_V2',
  } satisfies ExtensionRequest, { frameId: 0 });
  if (!observed.ok || observed.kind !== 'OBSERVATION') {
    throw new Error(observed.ok ? 'PERCEPTION_FAILED:INVALID_RESPONSE' : observed.error);
  }
  return observed.local;
}

function confirmationPrompt(action: AgentAction): string {
  if (action.type === 'CLICK') return `Allow the proposed high-risk click on ${action.element_id}?`;
  if (action.type === 'TYPE_HANDLE') {
    return `Allow a local secret handle to be entered into ${action.element_id}?`;
  }
  if (action.type === 'ASK_USER') return action.question;
  return 'Allow this proposed action?';
}

function awaitConfirmation(action: AgentAction, generation: number, prompt?: string): Promise<boolean> {
  const requestId = crypto.randomUUID();
  const expires = Date.now() + 300_000;
  void recordAction('APPROVAL_REQUESTED', action);
  state.pendingConfirmation = {
    requestId,
    kind: 'CONFIRMATION',
    action,
    prompt: prompt ?? confirmationPrompt(action),
  };
  setPhase('WAITING_CONFIRMATION', 'Waiting for local user confirmation', action.type);
  return new Promise((resolve) => {
    pendingInteraction = {
      kind: 'CONFIRMATION',
      requestId,
      actionId: action.action_id,
      resolve: (confirmed) => {
        if (generation !== runGeneration || Date.now() >= expires) return resolve(false);
        state.pendingConfirmation = null;
        pendingInteraction = undefined;
        resolve(confirmed);
      },
    };
  });
}

function awaitClarification(action: Extract<AgentAction, { type: 'ASK_USER' }>, generation: number): Promise<string | null> {
  state.pendingConfirmation = {
    kind: 'CLARIFICATION',
    action,
    prompt: action.question,
  };
  setPhase('WAITING_CONFIRMATION', 'Waiting for a local clarification', 'The answer will be sanitized locally');
  return new Promise((resolve) => {
    pendingInteraction = {
      kind: 'CLARIFICATION',
      actionId: action.action_id,
      resolve: (answer) => {
        if (generation !== runGeneration) return resolve(null);
        state.pendingConfirmation = null;
        pendingInteraction = undefined;
        resolve(answer);
      },
    };
  });
}

function taskWithClarifications(task: string, clarifications: readonly string[]): string {
  if (clarifications.length === 0) return task;
  const suffix = clarifications
    .slice(-3)
    .map((answer) => `User clarification: ${answer}`)
    .join('\n');
  const availableTaskLength = Math.max(1, 3_999 - suffix.length);
  return `${task.slice(0, availableTaskLength)}\n${suffix}`.slice(0, 4_000);
}

async function executeInTab(
  tabId: number,
  local: LocalPageObservation,
  action: AgentAction,
  confirmed: boolean,
  context: SanitizedContext,
  generation: number,
): Promise<VerificationResult> {
  const dispatch = async (resolvedValue?: string, preflight = false): Promise<VerificationResult> => {
  if (generation !== runGeneration || !state.running) throw new Error('ACTION_FAILED');
  const executed: ContentResponse = await browser.tabs.sendMessage(tabId, {
    type: 'EXECUTE_ACTION_V2',
    action,
    snapshotId: local.observation.snapshot_id,
    origin: local.observation.origin,
    fingerprint: local.fingerprint,
    resolvedValue,
    confirmed,
    documentId: local.documentId,
    preflight,
  } satisfies ExtensionRequest, { frameId: 0 });
  if (!executed.ok || executed.kind !== 'VERIFICATION') throw new Error('ACTION_FAILED');
  return executed.result;
  };
  let resolvedValue: string | undefined;
  if (action.type === 'TYPE_HANDLE') {
    const release = await privateFillGate({ action, local, context, vault, tab: tabId, run: generation,
      purpose: state.task, confirmed, current: () => generation === runGeneration && state.running,
      preflight: () => dispatch(undefined, true) });
    if (release.error) {
      if (release.error !== 'CONFIRMATION_REQUIRED') await recordAction('BLOCKED', action);
      return { action_id: action.action_id, success: false, page_changed: false, new_snapshot_required: true, error: release.error };
    }
    resolvedValue = release.value;
    await recordAction('AUTHORIZED', action);
  }
  const result = await dispatch(resolvedValue);
  if (result.error !== 'CONFIRMATION_REQUIRED') await recordAction(result.success ? 'EXECUTED' : 'BLOCKED', action);
  return result;
}

async function runAgent(task: string, generation: number): Promise<void> {
  const runStarted = performance.now();
  try {
    const backendOnline = await refreshBackendHealth();
    timeline(
      backendOnline ? 'Optional reasoning service is available' : 'Running in device-local mode',
      backendOnline ? 'Complex reasoning can use sanitized context' : 'Simple tasks do not require the server',
    );
    if (!privacyPipeline && !state.rehearsal) {
      const preferences = await browser.storage.local.get('contextshieldPiiMode');
      if (preferences.contextshieldPiiMode === 'deterministic') {
        privacyPipeline = new LocalPrivacyPipeline(vault);
        timeline('Contextual PII model disabled by explicit local test preference');
      } else {
        setPhase('SANITIZE', 'Loading the local contextual PII model');
        const modelStarted = performance.now();
        rampartScanner = new OffscreenRampartBridge();
        await rampartScanner.initialize();
        addMetric('modelInitializationMs', performance.now() - modelStarted);
        privacyPipeline = new LocalPrivacyPipeline(vault, rampartScanner);
        timeline('Rampart ONNX contextual PII model ready');
      }
    }
    let activeRunDeadline = Date.now() + (state.rehearsal ? 300_000 : MAX_ACTIVE_RUN_MS);
    const tab = await activeHttpTab();
    let approvedOrigin = tab.origin;
    state.origin = approvedOrigin;
    setPhase('OBSERVE', 'Current page identified locally', approvedOrigin);
    await ensureContentScript(tab.id);
    timeline('Content script ready');

    let sessionId: string | null = null;
    let previousActionMarker: ActionProgressMarker | null = null;
    let completedLocalClicks = 0;
    const requestedLocalClicks = Math.max(
      1,
      task.match(/\b(?:click|press)\b/gi)?.length ?? 0,
    );
    const clarifications: string[] = [];
    for (let step = 1; step <= MAX_STEPS && generation === runGeneration; step += 1) {
      if (Date.now() >= activeRunDeadline) throw new Error('AGENT_TIME_LIMIT');
      setPhase('OBSERVE', 'Reading page locally', `step ${step}`);
      state.clientMetrics.steps = step;
      await ensureContentScript(tab.id);
      const observationStarted = performance.now();
      let local = await observe(tab.id);
      addMetric('observationMs', performance.now() - observationStarted);
      if (local.observation.origin !== approvedOrigin) {
        const nextOrigin = local.observation.origin;
        const confirmed = await awaitConfirmation(
          {
            type: 'ASK_USER',
            action_id: `act_origin_${crypto.randomUUID().replaceAll('-', '')}`,
            snapshot_id: local.observation.snapshot_id,
            reason: 'A new website is a separate local privacy boundary.',
            question: `Continue this task on ${nextOrigin}?`,
          },
          generation,
        );
        if (!confirmed) {
          fail('The task stopped before entering the new website.');
          return;
        }
        approvedOrigin = nextOrigin;
        state.origin = approvedOrigin;
        timeline('New website approved locally', approvedOrigin);
      }
      timeline('Page observed locally', `${local.observation.elements.length} safe element records`);

      const visualCandidateCount = local.observation.visual_regions.filter(
        (region) => region.requires_analysis,
      ).length;
      setPhase(
        'SANITIZE',
        state.rehearsal ? 'Rehearsal: DOM-only privacy checks (vision disabled)' : 'Running full-viewport local vision and OCR',
        `${visualCandidateCount} visible pixel surfaces`,
      );
      visualScanner ??= new OffscreenVisualBridge();
      // Geometry does not prove that pixels are unchanged. Selected values,
      // canvas content and private text can change within the same rectangles.
      // Re-capture and re-sanitize each observation; retain only loaded models.
      const visual = state.rehearsal
        ? { visualElements: [], visualHints: [], ocrHints: [], safeVisualCrops: [], timings: undefined }
        : await visualScanner.analyze(local, tab.id);
      const visualElements = visual.visualElements ?? [];
      state.clientMetrics.pixelRecords += visualElements.length;
      addMetric('modelInitializationMs', visual.timings?.modelInitializationMs ?? 0);
      addMetric('screenshotCaptureMs', visual.timings?.captureMs ?? 0);
      addMetric('visualInferenceAndRedactionMs', visual.timings?.inferenceAndRedactionMs ?? 0);
      local = {
        ...local,
        observation: {
          ...local.observation,
          elements: fuseScreenState(local.observation.elements, visualElements),
        },
        visualHints: visual.visualHints,
        ocrHints: visual.ocrHints,
        safeVisualCrops: visual.safeVisualCrops,
      };
      timeline(
        state.rehearsal ? 'Rehearsal: no visual inference performed' : 'Visual privacy scan complete',
        `${visualElements.length} pixel records · ${visual.safeVisualCrops.length} verified safe crops`,
      );

      setPhase('SANITIZE', 'Checking sensitive information locally');
      const runPipeline = state.rehearsal ? new LocalPrivacyPipeline(vault) : privacyPipeline;
      if (!runPipeline) throw new Error('PRIVACY_SCAN_FAILED');
      const privacy = await runPipeline.sanitize(
        local,
        taskWithClarifications(task, clarifications),
      );
      const pageUrl = new URL(local.observation.url);
      const railwayAssisted = !state.rehearsal && task === RAILWAY_TASK && ['http://127.0.0.1:4173', 'http://localhost:4173'].includes(pageUrl.origin) && pageUrl.pathname === '/railway.html';
      const railwayStep = railwayAssisted ? planRailwayRehearsal(privacy.context, pageUrl.href, false) : null;
      const fareButtons = privacy.context.elements.filter((element) => element.enabled && element.role === 'button' && (element.label ?? '').startsWith('Choose train '));
      const railwayComparison = railwayAssisted && !railwayStep && fareButtons.length > 0;
      if (railwayAssisted && !railwayStep && !railwayComparison) throw new Error('PLANNER_FAILED');
      if (railwayComparison) {
        // A declared fixture adapter narrows this model turn to the user-approved
        // comparison. No other page instructions or navigation targets are needed.
        privacy.context = { ...privacy.context, elements: fareButtons, task: 'Compare these fictional train departures and numeric fares. Click the lowest-fare train departing before 12:00. Return type CLICK with the chosen button element_id. These are buttons, NOT dropdowns: never return SELECT. Use a supplied ID. No real purchase occurs.' };
        privacy.serverPreview = JSON.stringify(privacy.context, null, 2);
        timeline('Railway adapter delegated the fare comparison to Qwen', 'Only sanitized fare buttons are supplied; remaining steps use the local adapter');
      }
      state.privacySummary = privacy.context.privacy_summary;
      state.privacyEvidence = privacy.evidence;
      const firstSnapshot = !state.proofPreview;
      if (firstSnapshot) {
        state.proofPreview = privacy.serverPreview;
        state.proofEvidence = privacy.evidence;
      }
      state.blockedVisualRegions = privacy.blockedVisualRegions;
      state.localProcessingMs = Math.round(privacy.processingMs * 100) / 100;
      addMetric('privacyClassificationMs', privacy.processingMs);
      state.serverPreview = privacy.serverPreview;
      const delivery: NonNullable<PublicAgentState['contextDelivery']> = {
        status: 'PREPARED',
        endpoint: AGENT_ENDPOINT.origin,
        requests: state.contextDelivery?.requests ?? 0,
      };
      state.contextDelivery = delivery;
      if (firstSnapshot) state.proofDelivery = delivery;
      state.secretHandles = vault.handles();
      const entityCount = Object.values(privacy.context.privacy_summary).reduce(
        (total, count) => total + count,
        0,
      );
      timeline('Sensitive entities protected', `${entityCount} classifications`);
      timeline('Safe context created', 'Only the server preview can cross the gateway');

      const localPlanStarted = performance.now();
      const localAction: AgentAction | null = state.rehearsal
        ? planRailwayRehearsal(privacy.context, local.observation.url)
        : railwayAssisted ? railwayStep : sessionId ? null : planLocalAction(privacy.context);
      if (state.rehearsal && !localAction) throw new Error('PLANNER_FAILED');
      addMetric('localPlanningMs', performance.now() - localPlanStarted);
      if (!localAction && !backendOnline) throw new Error('AGENT_SERVER_REQUIRED');
      setPhase(
        'PLAN',
        localAction ? 'Planning a grounded action entirely on this device' : 'Sending sanitized context and planning next action',
      );
      const serverPlanningStarted = performance.now();
      let plan: AgentStartResponse | null = null;
      if (localAction) {
        delivery.status = 'LOCAL_ONLY';
      } else {
        const onDispatch = () => {
          delivery.status = 'DISPATCHED';
          delivery.requests += 1;
        };
        try {
          plan = sessionId
            ? await stepAgent(AGENT_ENDPOINT, sessionId, privacy.context, vault.values(), undefined, onDispatch)
            : await startAgent(AGENT_ENDPOINT, privacy.context, vault.values(), undefined, onDispatch);
          delivery.status = 'ACKNOWLEDGED';
        } catch (error) {
          if (delivery.status === 'DISPATCHED') delivery.status = 'UNCONFIRMED';
          throw error;
        }
      }
      if (!localAction) addMetric('serverPlanningMs', performance.now() - serverPlanningStarted);
      if (generation !== runGeneration) return;
      const activeSessionId: string | null = plan?.session_id ?? null;
      if (activeSessionId) {
        sessionId = activeSessionId;
        state.sessionId = activeSessionId;
      }
      const action = localAction ?? plan?.action;
      if (!action) throw new Error('PLANNER_FAILED');
      if (railwayComparison && (action.type !== 'CLICK' || !fareButtons.some((field) => field.id === action.element_id))) throw new Error('PLANNER_FAILED');
      state.lastAction = action;
      timeline(
        localAction ? 'Local controller returned a structured action' : 'Server returned a structured action',
        action.type,
      );

      if (action.type === 'FINISH') {
        if (task === RAILWAY_TASK && !local.observation.elements.some((element) => element.role === 'heading' && element.text === 'Simulated booking complete')) {
          fail('The planner stopped before the simulated ticket was visible. The booking is not complete.');
          return;
        }
        if (
          (!localAction && plan?.state === 'FAILED') ||
          (!localAction && !finishRepresentsSuccess(action.reason, action.summary, privacy.context))
        ) {
          fail('The planner could not find a grounded way to complete this task.');
          return;
        }
        state.resultSummary = action.summary;
        state.running = false;
        state.clientMetrics.totalMs = performance.now() - runStarted;
        setPhase('COMPLETE', 'Task complete', action.summary);
        return;
      }

      const currentActionMarker = actionProgressMarker(action, privacy.context);
      if (isRepeatedNoProgress(previousActionMarker, currentActionMarker)) {
        fail(
          'The same action produced no visible page change, so the task was stopped to prevent a loop.',
        );
        return;
      }

      let confirmed = false;
      if (action.type === 'ASK_USER') {
        const answer = await awaitClarification(action, generation);
        if (!answer) {
          fail('The task stopped while waiting for the requested information.');
          return;
        }
        clarifications.push(answer);
        timeline('Clarification received locally', 'Sensitive values will be removed before planning');
        confirmed = true;
      }

      setPhase('EXECUTE', 'Validating the proposed action locally', action.type);
      const actionStarted = performance.now();
      let verification = await executeInTab(tab.id, local, action, confirmed, privacy.context, generation);
      if (verification.error === 'CONFIRMATION_REQUIRED') {
        const target = 'element_id' in action ? local.observation.elements.find((element) => element.id === action.element_id) : undefined;
        const fieldName = (target?.label || target?.text || 'unnamed field').slice(0, 90);
        const category = action.type === 'TYPE_HANDLE' ? action.handle.replace(/^LOCAL_/, '').replace(/_\d+$/, '') : 'high-impact action';
        const consentStarted = Date.now();
        confirmed = await awaitConfirmation(action, generation,
          `${local.observation.origin} · ${fieldName}\nAllow ${category} for this exact action, once? ${action.type === 'TYPE_HANDLE' ? 'The destination page can read the filled value. Only approve a site you trust.' : 'Check the page before approving.'}`);
        activeRunDeadline += Date.now() - consentStarted;
        if (generation !== runGeneration) return;
        if (!confirmed) {
          await recordAction('DENIED', action);
          verification = { ...verification, error: 'ACTION_FAILED' };
        } else {
          setPhase('EXECUTE', 'Executing confirmed action locally', action.type);
          verification = await executeInTab(tab.id, local, action, true, privacy.context, generation);
        }
      }
      addMetric('actionExecutionMs', performance.now() - actionStarted);

      setPhase('VERIFY', 'Verifying action result locally', verification.success ? 'passed' : 'blocked');
      const verificationStarted = performance.now();
      if (verification.error === 'STALE_SNAPSHOT') {
        fail('Page changed after planning; the stale action was blocked.');
        return;
      }
      if (!verification.success) {
        fail(`Action blocked safely: ${verification.error ?? 'VERIFICATION_FAILED'}`);
        return;
      }
      state.verifiedActions = (state.verifiedActions ?? 0) + 1;
      state.lastVerifiedAction = action.type;
      if (localAction) {
        timeline('Local verification accepted', 'No raw page state left this device');
        if (action.type === 'CLICK') completedLocalClicks += 1;
        if (
          action.type === 'SCROLL' ||
          (
            action.type === 'CLICK' &&
            action.reason.includes('exact named button') &&
            completedLocalClicks >= requestedLocalClicks
          )
        ) {
          state.resultSummary = 'The requested local browser action completed successfully.';
          state.running = false;
          addMetric('verificationMs', performance.now() - verificationStarted);
          state.clientMetrics.totalMs = performance.now() - runStarted;
          setPhase('COMPLETE', 'Task complete', state.resultSummary);
          return;
        }
      } else {
        if (!activeSessionId) throw new Error('PLANNER_FAILED');
        const verified = await verifyAgent(AGENT_ENDPOINT, activeSessionId, verification);
        timeline('Verification result accepted by server', verified.state);
        if (verified.state === 'FAILED') {
          fail('The server rejected the local verification result.');
          return;
        }
      }
      addMetric('verificationMs', performance.now() - verificationStarted);
      state.clientMetrics.totalMs = performance.now() - runStarted;
      previousActionMarker = currentActionMarker;
    }

    if (generation === runGeneration) fail('The agent reached its safe step limit.');
  } catch (error) {
    safeLogger.error('Agent', 'run failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    if (generation === runGeneration) {
      state.clientMetrics.totalMs = performance.now() - runStarted;
      const code = error instanceof Error ? error.message : 'UNKNOWN_FAILURE';
      if (error instanceof PrivacyAssertionError) {
        fail('The outbound privacy check rejected this context; it was not sent to the planner.');
        return;
      }
      const safeMessage: Record<string, string> = {
        NO_ACTIVE_TAB: 'No active browser tab is available.',
        UNSUPPORTED_PAGE: 'Open a normal HTTP(S) page before starting.',
        CONTENT_UNAVAILABLE: 'The page does not allow the local content script.',
        PERCEPTION_FAILED: 'Local page perception failed; nothing was transmitted.',
        TARGET_TAB_CHANGED: 'The active tab changed. Return to the task website and start again.',
        ORIGIN_CHANGED: 'The page origin changed; the action was stopped.',
        ACTION_FAILED: 'Local action execution failed safely.',
        PLANNER_FAILED: 'The local planner could not process this page; no action was taken.',
        AGENT_SERVER_FAILED: 'The local agent service failed. Run START.command, then try again.',
        AGENT_SERVER_OFFLINE: 'The local services are offline. Run START.command once, then try again.',
        AGENT_SERVER_REQUIRED: 'This task needs the optional local Qwen reasoning service. Run START.command once, then try again.',
        AGENT_TIMEOUT: 'The local planner took too long, so the task was stopped safely.',
        AGENT_TIME_LIMIT: 'The task reached its two-minute safety deadline and was stopped.',
        PRIVACY_SCAN_FAILED: 'A local privacy model failed; nothing was transmitted.',
        REDACTION_FAILED: 'Visual redaction could not be verified; nothing was transmitted.',
      };
      const knownCode = Object.keys(safeMessage).find((candidate) => code.startsWith(candidate));
      fail(
        (knownCode ? safeMessage[knownCode] : undefined) ??
          'The agent failed closed before completing the task.',
      );
    }
  }
}

function resetRunState(task: string): void {
  vault.revokeGrants();
  ledger = new ActionLedger();
  void ledger.append('RUN_STARTED');
  state.ledger = undefined;
  state.phase = 'IDLE';
  state.running = true;
  state.task = task;
  state.origin = null;
  state.sessionId = null;
  state.privacySummary = {};
  state.privacyEvidence = undefined;
  state.proofPreview = null;
  state.proofEvidence = undefined;
  state.verifiedActions = 0;
  state.lastVerifiedAction = null;
  state.blockedVisualRegions = 0;
  state.localProcessingMs = null;
  state.clientMetrics = emptyClientMetrics();
  state.serverPreview = null;
  state.contextDelivery = undefined;
  state.proofDelivery = undefined;
  state.timeline = [];
  state.pendingConfirmation = null;
  state.secretHandles = vault.handles();
  state.lastAction = null;
  state.resultSummary = null;
  state.error = null;
  state.backendStatus = 'CHECKING';
  state.backendDetail = null;
  timeline('Task received');
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    async (untrusted: unknown, sender): Promise<AgentCommandResponse | undefined> => {
      await Promise.resolve();
      if (sender.id !== browser.runtime.id || sender.url?.split('?')[0] !== browser.runtime.getURL('/popup.html')) return undefined;
      const parsed = PanelCommand.safeParse(untrusted);
      if (!parsed.success) return response(false, 'Invalid local command.');
      const message = parsed.data;
      if (message.type === 'GET_AGENT_STATE') return response(true);
      if (message.type === 'GET_LEDGER') { state.ledger = await ledger.proof(); return response(true); }
      if (message.type === 'LOAD_DEMO_PROFILE') {
        if (state.running) return response(false, 'Stop the task before replacing the vault.');
        vault.clear();
        vault.store('PERSON_NAME', 'Demo Traveller');
        vault.store('EMAIL', 'traveller@example.test');
        vault.store('PHONE', '9000000000');
        state.secretHandles = vault.handles();
        return response(true);
      }
      if (message.type === 'CHECK_BACKEND_HEALTH') {
        const online = await refreshBackendHealth();
        return response(online, online ? undefined : state.backendDetail ?? undefined);
      }
      if (message.type === 'SET_SECRET') {
        if (state.running) return response(false, 'Stop the task before changing private values.');
        try {
          const handle = vault.store(message.kind, message.value);
          state.secretHandles = vault.handles();
          timeline('Local secret added to the memory-only vault', handle);
          return response(true, undefined, handle);
        } catch {
          return response(false, 'Secret type and value are required.');
        }
      }
      if (message.type === 'CLEAR_SECRETS') {
        if (state.running) return response(false, 'Stop the task before clearing private values.');
        vault.clear();
        await ledger.append('VAULT_CLEARED');
        state.secretHandles = [];
        timeline('Memory-only secret vault cleared');
        return response(true);
      }
      if (message.type === 'STOP_AGENT') {
        runGeneration += 1;
        vault.revokeGrants();
        await ledger.append('STOPPED');
        if (pendingInteraction?.kind === 'CONFIRMATION') pendingInteraction.resolve(false);
        else if (pendingInteraction?.kind === 'CLARIFICATION') pendingInteraction.resolve(null);
        pendingInteraction = undefined;
        state.pendingConfirmation = null;
        state.running = false;
        setPhase('STOPPED', 'Task stopped locally');
        return response(true);
      }
      if (message.type === 'CONFIRM_ACTION') {
        if (
          !pendingInteraction ||
          pendingInteraction.kind !== 'CONFIRMATION' ||
          pendingInteraction.actionId !== message.actionId || pendingInteraction.requestId !== message.requestId
        ) {
          return response(false, 'The confirmation request is no longer active.');
        }
        pendingInteraction.resolve(message.confirmed);
        return response(true);
      }
      if (message.type === 'ANSWER_CLARIFICATION') {
        const answer = message.answer.trim().slice(0, 1_000);
        if (!answer) return response(false, 'Please enter an answer first.');
        if (
          !pendingInteraction ||
          pendingInteraction.kind !== 'CLARIFICATION' ||
          pendingInteraction.actionId !== message.actionId
        ) {
          return response(false, 'The clarification request is no longer active.');
        }
        pendingInteraction.resolve(answer);
        return response(true);
      }
      {
        const task = message.task.trim();
        if (!task) return response(false, 'Task is required.');
        if (message.rehearsal && task !== RAILWAY_TASK) return response(false, 'Local rehearsal supports only the prepared railway task. Load the synthetic profile to restore it, or turn rehearsal off.');
        if (state.running) return response(false, 'An agent task is already running.');
        runGeneration += 1;
        resetRunState(task);
        state.rehearsal = message.rehearsal === true;
        const generation = runGeneration;
        void runAgent(task, generation);
        return response(true);
      }
    },
  );
});
