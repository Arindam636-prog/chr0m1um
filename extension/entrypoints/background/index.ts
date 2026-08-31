import type {
  AgentAction,
  AgentStartResponse,
  VerificationResult,
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
  startAgent,
  stepAgent,
  verifyAgent,
} from '../../lib/network/privacyGateway';
import { LocalPrivacyPipeline } from '../../lib/privacy/pipeline';
import { OffscreenRampartBridge } from '../../lib/privacy/offscreenRampartBridge';
import { OffscreenVisualBridge } from '../../lib/privacy/offscreenVisualBridge';
import type { VisualAnalysisResult } from '../../lib/privacy/visualPrivacyScanner';
import type { LocalPageObservation } from '../../lib/privacy/types';
import { fuseScreenState } from '../../lib/perception/fuseScreenState';
import { SecretVault } from '../../lib/vault/secretVault';
import { finishRepresentsSuccess } from '../../lib/agent/completionGuard';
import { planLocalAction } from '../../lib/agent/localController';
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
let pendingInteraction:
  | { kind: 'CONFIRMATION'; actionId: string; resolve: (confirmed: boolean) => void }
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
  } satisfies ExtensionRequest);
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

function awaitConfirmation(action: AgentAction, generation: number): Promise<boolean> {
  state.pendingConfirmation = {
    kind: 'CONFIRMATION',
    action,
    prompt: confirmationPrompt(action),
  };
  setPhase('WAITING_CONFIRMATION', 'Waiting for local user confirmation', action.type);
  return new Promise((resolve) => {
    pendingInteraction = {
      kind: 'CONFIRMATION',
      actionId: action.action_id,
      resolve: (confirmed) => {
        if (generation !== runGeneration) return resolve(false);
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
): Promise<VerificationResult> {
  const resolvedValue =
    action.type === 'TYPE_HANDLE' ? vault.resolve(action.handle) : undefined;
  const executed: ContentResponse = await browser.tabs.sendMessage(tabId, {
    type: 'EXECUTE_ACTION_V2',
    action,
    snapshotId: local.observation.snapshot_id,
    origin: local.observation.origin,
    fingerprint: local.fingerprint,
    resolvedValue,
    confirmed,
  } satisfies ExtensionRequest);
  if (!executed.ok || executed.kind !== 'VERIFICATION') throw new Error('ACTION_FAILED');
  return executed.result;
}

async function runAgent(task: string, generation: number): Promise<void> {
  const runStarted = performance.now();
  try {
    const backendOnline = await refreshBackendHealth();
    timeline(
      backendOnline ? 'Optional reasoning service is available' : 'Running in device-local mode',
      backendOnline ? 'Complex reasoning can use sanitized context' : 'Simple tasks do not require the server',
    );
    if (!privacyPipeline) {
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
    const activeRunDeadline = Date.now() + MAX_ACTIVE_RUN_MS;
    const tab = await activeHttpTab();
    let approvedOrigin = tab.origin;
    state.origin = approvedOrigin;
    setPhase('OBSERVE', 'Current page identified locally', approvedOrigin);
    await ensureContentScript(tab.id);
    timeline('Content script ready');

    let sessionId: string | null = null;
    let previousActionMarker: ActionProgressMarker | null = null;
    const visualCache = new Map<string, VisualAnalysisResult>();
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
        'Running full-viewport local vision and OCR',
        `${visualCandidateCount} visible pixel surfaces`,
      );
      visualScanner ??= new OffscreenVisualBridge();
      const visualKey = JSON.stringify({
        url: local.observation.url,
        viewport: local.observation.viewport,
        regions: local.observation.visual_regions.map((region) => [
          region.id,
          region.kind,
          region.bbox,
        ]),
      });
      let visualCacheHit = false;
      let visual: VisualAnalysisResult;
      const cached = visualCache.get(visualKey);
      if (cached) {
        visual = cached;
        visualCacheHit = true;
        timeline('Reused the verified local pixel analysis', 'The visual surfaces did not change');
      } else {
        visual = await visualScanner.analyze(local);
        visualCache.clear();
        visualCache.set(visualKey, visual);
      }
      const visualElements = visual.visualElements ?? [];
      state.clientMetrics.pixelRecords += visualElements.length;
      if (!visualCacheHit) {
        addMetric('modelInitializationMs', visual.timings?.modelInitializationMs ?? 0);
        addMetric('screenshotCaptureMs', visual.timings?.captureMs ?? 0);
        addMetric(
          'visualInferenceAndRedactionMs',
          visual.timings?.inferenceAndRedactionMs ?? 0,
        );
      }
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
        'Visual privacy scan complete',
        `${visualElements.length} pixel records · ${visual.safeVisualCrops.length} verified safe crops`,
      );

      setPhase('SANITIZE', 'Checking sensitive information locally');
      const privacy = await privacyPipeline.sanitize(
        local,
        taskWithClarifications(task, clarifications),
      );
      state.privacySummary = privacy.context.privacy_summary;
      state.blockedVisualRegions = privacy.blockedVisualRegions;
      state.localProcessingMs = Math.round(privacy.processingMs * 100) / 100;
      addMetric('privacyClassificationMs', privacy.processingMs);
      state.serverPreview = privacy.serverPreview;
      state.secretHandles = vault.handles();
      const entityCount = Object.values(privacy.context.privacy_summary).reduce(
        (total, count) => total + count,
        0,
      );
      timeline('Sensitive entities protected', `${entityCount} classifications`);
      timeline('Safe context created', 'Only the server preview can cross the gateway');

      const localPlanStarted = performance.now();
      const localAction: AgentAction | null = sessionId
        ? null
        : planLocalAction(privacy.context);
      addMetric('localPlanningMs', performance.now() - localPlanStarted);
      if (!localAction && !backendOnline) throw new Error('AGENT_SERVER_REQUIRED');
      setPhase(
        'PLAN',
        localAction ? 'Planning a grounded action entirely on this device' : 'Sending sanitized context and planning next action',
      );
      const serverPlanningStarted = performance.now();
      const plan: AgentStartResponse | null = localAction
        ? null
        : sessionId
          ? await stepAgent(AGENT_ENDPOINT, sessionId, privacy.context, vault.values())
          : await startAgent(AGENT_ENDPOINT, privacy.context, vault.values());
      if (!localAction) addMetric('serverPlanningMs', performance.now() - serverPlanningStarted);
      if (generation !== runGeneration) return;
      const activeSessionId: string | null = plan?.session_id ?? null;
      if (activeSessionId) {
        sessionId = activeSessionId;
        state.sessionId = activeSessionId;
      }
      const action = localAction ?? plan?.action;
      if (!action) throw new Error('PLANNER_FAILED');
      state.lastAction = action;
      timeline(
        localAction ? 'Local controller returned a structured action' : 'Server returned a structured action',
        action.type,
      );

      if (action.type === 'FINISH') {
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
      let verification = await executeInTab(tab.id, local, action, confirmed);
      if (verification.error === 'CONFIRMATION_REQUIRED') {
        confirmed = await awaitConfirmation(action, generation);
        if (!confirmed) {
          verification = { ...verification, error: 'ACTION_FAILED' };
        } else {
          setPhase('EXECUTE', 'Executing confirmed action locally', action.type);
          verification = await executeInTab(tab.id, local, action, true);
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
      if (localAction) {
        timeline('Local verification accepted', 'No raw page state left this device');
        if (
          action.type === 'SCROLL' ||
          (action.type === 'CLICK' && action.reason.includes('exact named button'))
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
      const safeMessage: Record<string, string> = {
        NO_ACTIVE_TAB: 'No active browser tab is available.',
        UNSUPPORTED_PAGE: 'Open a normal HTTP(S) page before starting.',
        CONTENT_UNAVAILABLE: 'The page does not allow the local content script.',
        PERCEPTION_FAILED: 'Local page perception failed; nothing was transmitted.',
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
  state.phase = 'IDLE';
  state.running = true;
  state.task = task;
  state.origin = null;
  state.sessionId = null;
  state.privacySummary = {};
  state.blockedVisualRegions = 0;
  state.localProcessingMs = null;
  state.clientMetrics = emptyClientMetrics();
  state.serverPreview = null;
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
    async (message: ExtensionRequest): Promise<AgentCommandResponse | undefined> => {
      await Promise.resolve();
      if (message.type === 'GET_AGENT_STATE') return response(true);
      if (message.type === 'CHECK_BACKEND_HEALTH') {
        const online = await refreshBackendHealth();
        return response(online, online ? undefined : state.backendDetail ?? undefined);
      }
      if (message.type === 'SET_SECRET') {
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
        vault.clear();
        state.secretHandles = [];
        timeline('Memory-only secret vault cleared');
        return response(true);
      }
      if (message.type === 'STOP_AGENT') {
        runGeneration += 1;
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
          pendingInteraction.actionId !== message.actionId
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
      if (message.type === 'START_AGENT') {
        const task = message.task.trim();
        if (!task) return response(false, 'Task is required.');
        if (state.running) return response(false, 'An agent task is already running.');
        runGeneration += 1;
        resetRunState(task);
        const generation = runGeneration;
        void runAgent(task, generation);
        return response(true);
      }
      return undefined;
    },
  );
});
