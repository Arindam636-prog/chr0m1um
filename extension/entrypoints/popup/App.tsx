import { useEffect, useMemo, useState } from 'react';

import type {
  AgentCommandResponse,
  ExtensionRequest,
  PublicAgentState,
} from '../../lib/messaging/protocol';

const EMPTY_STATE: PublicAgentState = {
  phase: 'IDLE',
  running: false,
  task: '',
  origin: null,
  sessionId: null,
  privacySummary: {},
  blockedVisualRegions: 0,
  localProcessingMs: null,
  clientMetrics: {
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
  },
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

const SECRET_TYPES = [
  ['EMAIL', 'Email'],
  ['PHONE', 'Phone'],
  ['PERSON_NAME', 'Name'],
  ['GIVEN_NAME', 'First name'],
  ['SURNAME', 'Last name'],
  ['ADDRESS', 'Address'],
  ['UPI_ID', 'UPI ID'],
  ['PASSWORD', 'Password'],
  ['OTP', 'OTP'],
] as const;

async function send(message: ExtensionRequest): Promise<AgentCommandResponse> {
  return browser.runtime.sendMessage(message);
}

export function App() {
  const extensionVersion = browser.runtime.getManifest().version;
  const [agent, setAgent] = useState<PublicAgentState>(EMPTY_STATE);
  const [task, setTask] = useState('');
  const [secretKind, setSecretKind] = useState('EMAIL');
  const [secretValue, setSecretValue] = useState('');
  const [uiError, setUiError] = useState<string | null>(null);
  const [clarification, setClarification] = useState('');
  const protectedCount = useMemo(
    () => Object.values(agent.privacySummary).reduce((sum, count) => sum + count, 0),
    [agent.privacySummary],
  );

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const reply = await send({ type: 'GET_AGENT_STATE' });
        if (!active) return;
        setAgent(reply.state);
        if (reply.state.task) setTask((current) => current || reply.state.task);
      } catch {
        if (active) setUiError('The background agent is unavailable.');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 500);
    const health = () => void send({ type: 'CHECK_BACKEND_HEALTH' }).then((reply) => {
      if (active) setAgent(reply.state);
    }).catch(() => undefined);
    health();
    const healthTimer = window.setInterval(health, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.clearInterval(healthTimer);
    };
  }, []);

  async function start() {
    setUiError(null);
    const reply = await send({ type: 'START_AGENT', task });
    setAgent(reply.state);
    if (!reply.ok) setUiError(reply.error ?? 'The task could not be started.');
  }

  async function stop() {
    const reply = await send({ type: 'STOP_AGENT' });
    setAgent(reply.state);
  }

  async function addSecret() {
    if (!secretValue.trim()) return;
    const reply = await send({ type: 'SET_SECRET', kind: secretKind, value: secretValue });
    setAgent(reply.state);
    if (reply.ok) setSecretValue('');
    else setUiError(reply.error ?? 'The secret could not be stored.');
  }

  async function confirm(confirmed: boolean) {
    const actionId = agent.pendingConfirmation?.action.action_id;
    if (!actionId) return;
    const reply = await send({ type: 'CONFIRM_ACTION', actionId, confirmed });
    setAgent(reply.state);
    if (!reply.ok) setUiError(reply.error ?? 'The confirmation expired.');
  }

  async function answerClarification() {
    const actionId = agent.pendingConfirmation?.action.action_id;
    if (!actionId || !clarification.trim()) return;
    const reply = await send({
      type: 'ANSWER_CLARIFICATION',
      actionId,
      answer: clarification,
    });
    setAgent(reply.state);
    if (reply.ok) setClarification('');
    else setUiError(reply.error ?? 'The clarification request expired.');
  }

  return (
    <main>
      <header>
        <div className="mark" aria-hidden="true">CS</div>
        <div className="brand-copy">
          <h1>ContextShield</h1>
          <p>Autonomous browsing, private by architecture</p>
        </div>
        <span className={`phase phase-${agent.phase.toLowerCase()}`}>{agent.phase}</span>
      </header>

      <div className={`service-status service-${agent.backendStatus.toLowerCase()}`} role="status">
        <i aria-hidden="true" />
        <span>{agent.backendStatus === 'ONLINE' ? 'Local + Qwen modes ready' : agent.backendStatus === 'OFFLINE' ? 'Device-local mode ready' : 'Checking optional Qwen service…'}</span>
        {agent.backendDetail && <small>{agent.backendDetail}</small>}
      </div>

      <section className="task-card">
        <label htmlFor="task">What should the agent do?</label>
        <textarea
          id="task"
          value={task}
          onChange={(event) => setTask(event.target.value)}
          placeholder="Choose the cheapest option and continue"
          maxLength={4_000}
          rows={3}
          required
        />
        <div className="actions">
          <button className="primary" type="button" disabled={agent.running || !task.trim()} onClick={() => void start()}>
            {agent.running ? 'Agent running…' : 'Start agent'}
          </button>
          <button className="danger" type="button" disabled={!agent.running} onClick={() => void stop()}>
            Stop
          </button>
        </div>
        {agent.origin && <p className="origin" title={agent.origin}>{agent.origin}</p>}
      </section>

      <section>
        <div className="section-title">
          <h2>Local secret vault</h2>
          <span>Memory only</span>
        </div>
        <p className="hint">Values stay in this extension. The server sees only LOCAL_* handles.</p>
        <div className="secret-row">
          <select aria-label="Secret type" value={secretKind} onChange={(event) => setSecretKind(event.target.value)}>
            {SECRET_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input
            aria-label="Secret value"
            type={secretKind === 'PASSWORD' || secretKind === 'OTP' ? 'password' : 'text'}
            value={secretValue}
            onChange={(event) => setSecretValue(event.target.value)}
            placeholder="Stored locally"
          />
          <button className="secondary compact" type="button" onClick={() => void addSecret()}>Add</button>
        </div>
        {agent.secretHandles.length > 0 && (
          <div className="handles">
            {agent.secretHandles.map((handle) => <code key={handle}>{handle}</code>)}
            <button className="link-button" type="button" onClick={() => void send({ type: 'CLEAR_SECRETS' }).then((reply) => setAgent(reply.state))}>Clear</button>
          </div>
        )}
      </section>

      {agent.pendingConfirmation && (
        <section className="confirmation" role="alertdialog" aria-label="Action confirmation">
          <div className="section-title">
            <h2>{agent.pendingConfirmation.kind === 'CLARIFICATION' ? 'Information needed' : 'Confirmation required'}</h2>
            <span>Local gate</span>
          </div>
          <p>{agent.pendingConfirmation.prompt}</p>
          <p className="action-reason">Reason: {agent.pendingConfirmation.action.reason}</p>
          {agent.pendingConfirmation.kind === 'CLARIFICATION' ? (
            <>
              <label className="sr-only" htmlFor="clarification">Your answer</label>
              <input
                id="clarification"
                className="clarification-input"
                value={clarification}
                onChange={(event) => setClarification(event.target.value)}
                placeholder="Type a short answer"
                maxLength={1_000}
              />
              <div className="actions">
                <button className="primary" type="button" disabled={!clarification.trim()} onClick={() => void answerClarification()}>Send answer</button>
                <button className="danger" type="button" onClick={() => void stop()}>Stop</button>
              </div>
            </>
          ) : (
            <div className="actions">
              <button className="primary" type="button" onClick={() => void confirm(true)}>Allow once</button>
              <button className="danger" type="button" onClick={() => void confirm(false)}>Deny</button>
            </div>
          )}
        </section>
      )}

      {(protectedCount > 0 || agent.serverPreview) && (
        <section>
          <div className="section-title">
            <h2>Privacy boundary</h2>
            <span>{protectedCount} protected</span>
          </div>
          <h3>Detected locally</h3>
          <div className="privacy-grid">
            {Object.entries(agent.privacySummary).map(([category, count]) => (
              <div key={category}><span>{category.replaceAll('_', ' ')}</span><strong>{count}</strong></div>
            ))}
            {agent.blockedVisualRegions > 0 && <div><span>Blocked visual regions</span><strong>{agent.blockedVisualRegions}</strong></div>}
          </div>
          <div className="boundary-row"><span>Page structure</span><b className="sent">Sent sanitized</b></div>
          <div className="boundary-row"><span>Raw detected values</span><b className="blocked">Never sent</b></div>
          {agent.localProcessingMs !== null && <p className="hint">Local privacy pass: {agent.localProcessingMs} ms</p>}
          {agent.serverPreview && (
            <details>
              <summary>Actual server view</summary>
              <pre>{agent.serverPreview}</pre>
            </details>
          )}
        </section>
      )}

      {agent.clientMetrics.steps > 0 && (
        <section>
          <div className="section-title">
            <h2>Client performance</h2>
            <span>{agent.clientMetrics.steps} steps</span>
          </div>
          <div className="metrics-grid">
            <div><span>Screen read</span><strong>{Math.round(agent.clientMetrics.observationMs)} ms</strong></div>
            <div><span>Screenshot</span><strong>{Math.round(agent.clientMetrics.screenshotCaptureMs)} ms</strong></div>
            <div><span>Vision + redaction</span><strong>{Math.round(agent.clientMetrics.visualInferenceAndRedactionMs)} ms</strong></div>
            <div><span>PII classification</span><strong>{Math.round(agent.clientMetrics.privacyClassificationMs)} ms</strong></div>
            <div><span>Local planning</span><strong>{Math.round(agent.clientMetrics.localPlanningMs)} ms</strong></div>
            <div><span>Qwen planning</span><strong>{Math.round(agent.clientMetrics.serverPlanningMs)} ms</strong></div>
            <div><span>Pixel records</span><strong>{agent.clientMetrics.pixelRecords}</strong></div>
            <div><span>Total</span><strong>{Math.round(agent.clientMetrics.totalMs)} ms</strong></div>
          </div>
        </section>
      )}

      {agent.timeline.length > 0 && (
        <section>
          <div className="section-title">
            <h2>Agent activity</h2>
            <span>Safe log</span>
          </div>
          <ol className="timeline">
            {agent.timeline.map((entry) => (
              <li key={entry.id}>
                <i aria-hidden="true" />
                <div><strong>{entry.message}</strong>{entry.safeDetail && <small>{entry.safeDetail}</small>}</div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(agent.resultSummary || agent.error || uiError) && (
        <section className={agent.error || uiError ? 'result error-result' : 'result success-result'} aria-live="polite">
          <strong>{agent.error || uiError ? 'Stopped safely' : 'Task complete'}</strong>
          <p>{agent.error ?? uiError ?? agent.resultSummary}</p>
        </section>
      )}

      <footer>Raw page state and vault values stay on this device. · v{extensionVersion}</footer>
    </main>
  );
}
