import { useEffect, useState } from 'react';
import { ArrowRightIcon as ArrowRight, CheckIcon as Check, CloudIcon as Cloud, EyeSlashIcon as EyeSlash, MonitorIcon as Monitor, PlayIcon as Play, ShieldCheckIcon as ShieldCheck, StopIcon as Stop, LockKeyIcon as LockKey, ArrowSquareOutIcon as ArrowSquareOut } from '@phosphor-icons/react';
import type { AgentCommandResponse, ExtensionRequest, PublicAgentState } from '../../lib/messaging/protocol';
import { PrivacyProof } from './PrivacyProof';
import { DEMO_TASK, DEMO_URL, statusCopy, storySteps } from './demoStory';

const EMPTY_STATE: PublicAgentState = {
  phase: 'IDLE', running: false, task: '', origin: null, sessionId: null,
  privacySummary: {}, blockedVisualRegions: 0, localProcessingMs: null,
  clientMetrics: { steps: 0, pixelRecords: 0, modelInitializationMs: 0, observationMs: 0, screenshotCaptureMs: 0, visualInferenceAndRedactionMs: 0, privacyClassificationMs: 0, localPlanningMs: 0, serverPlanningMs: 0, actionExecutionMs: 0, verificationMs: 0, totalMs: 0 },
  serverPreview: null, timeline: [], pendingConfirmation: null, secretHandles: [], lastAction: null, resultSummary: null, error: null, backendStatus: 'CHECKING', backendDetail: null,
};
const SECRET_TYPES = [['EMAIL', 'Email'], ['PHONE', 'Phone'], ['PERSON_NAME', 'Name'], ['GIVEN_NAME', 'First name'], ['SURNAME', 'Last name'], ['ADDRESS', 'Address'], ['UPI_ID', 'UPI ID'], ['PASSWORD', 'Password'], ['OTP', 'OTP'], ['USERNAME', 'Username'], ['TEXT', 'Generic text']] as const;
const STEP_ICONS = [Monitor, EyeSlash, Cloud, ArrowRight];

async function send(message: ExtensionRequest): Promise<AgentCommandResponse> {
  return browser.runtime.sendMessage(message);
}

export function App() {
  const [agent, setAgent] = useState<PublicAgentState>(EMPTY_STATE);
  const [task, setTask] = useState('');
  const [secretKind, setSecretKind] = useState('EMAIL');
  const [secretValue, setSecretValue] = useState('');
  const [clarification, setClarification] = useState('');
  const [uiError, setUiError] = useState<string | null>(null);
  const [view, setView] = useState<'task' | 'proof'>('task');
  const [frozen, setFrozen] = useState(false);
  const judgeView = new URLSearchParams(window.location.search).get('view') === 'privacy';
  const copy = statusCopy(agent);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const reply = await send({ type: 'GET_AGENT_STATE' });
        if (!active || frozen) return;
        setAgent(reply.state);
        if (reply.state.task) setTask((current) => current || reply.state.task);
      } catch { if (active) setUiError('Reload the extension, then try again.'); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 500);
    const health = () => void send({ type: 'CHECK_BACKEND_HEALTH' }).then((reply) => { if (active && !frozen) setAgent(reply.state); }).catch(() => undefined);
    health();
    const healthTimer = window.setInterval(health, 10_000);
    return () => { active = false; window.clearInterval(timer); window.clearInterval(healthTimer); };
  }, [frozen]);

  async function command(message: ExtensionRequest) {
    setUiError(null);
    try {
      const reply = await send(message);
      setAgent(reply.state);
      if (!reply.ok) setUiError(reply.error ?? 'The request could not be completed.');
      return reply;
    } catch { setUiError('The extension could not respond. Reload it and try again.'); }
  }
  async function addSecret() {
    if (!secretValue.trim()) return;
    const reply = await command({ type: 'SET_SECRET', kind: secretKind, value: secretValue });
    if (reply?.ok) setSecretValue('');
  }
  function confirm(confirmed: boolean) {
    const actionId = agent.pendingConfirmation?.action.action_id;
    if (actionId) void command({ type: 'CONFIRM_ACTION', actionId, confirmed });
  }
  async function answer() {
    const actionId = agent.pendingConfirmation?.action.action_id;
    if (!actionId || !clarification.trim()) return;
    const reply = await command({ type: 'ANSWER_CLARIFICATION', actionId, answer: clarification });
    if (reply?.ok) setClarification('');
  }
  const openProof = () => browser.tabs.create({ url: browser.runtime.getURL('/popup.html') + '?view=privacy' });

  return <main className={judgeView ? 'judge-proof-page' : 'extension-shell'}>
    <header className="app-header"><div className="brand"><span className="brand-symbol"><ShieldCheck size={24} weight="duotone" aria-hidden="true" /></span><div><h1>ContextShield</h1><p>{judgeView ? 'Chr0m1um / SIH 26171' : 'Your browser. Your privacy.'}</p></div></div>
      {judgeView ? <button className="secondary" aria-pressed={frozen} onClick={() => setFrozen(!frozen)}>{frozen ? 'Resume live view' : 'Freeze view'}</button> : <span className={`phase phase-${agent.phase.toLowerCase()}`}>{agent.running ? 'Working' : agent.phase === 'COMPLETE' ? 'Done' : agent.error ? 'Stopped' : 'Ready'}</span>}
    </header>
    {judgeView ? <><p className="view-note">{frozen ? 'Display frozen for presenting. The agent itself is not paused.' : 'Review after the run. Keep the target website active while the agent works.'}</p>{uiError && <p role="alert">{uiError}</p>}<PrivacyProof agent={agent} expanded /></> : <>
      <nav className="view-switch" aria-label="Extension views"><button aria-pressed={view === 'task'} onClick={() => setView('task')}>Agent</button><button aria-pressed={view === 'proof'} onClick={() => setView('proof')}>Privacy proof</button></nav>
      {view === 'proof' ? <><div className="proof-toolbar"><span>See what was protected</span><button className="secondary" disabled={agent.running} onClick={() => void openProof()}>Open judge view <ArrowSquareOut aria-hidden="true" /></button></div><PrivacyProof agent={agent} /></> : <>
        <section className="run-status" aria-live="polite"><h2>{copy.title}</h2><p>{copy.detail}</p></section>
        <ol className="story-steps" aria-label="How this task runs">{storySteps(agent).map((step, index) => {
          const Icon = STEP_ICONS[index] ?? Monitor;
          return <li key={step.label} className={step.active ? 'active-step' : step.done ? 'done-step' : ''} aria-current={step.active ? 'step' : undefined}><div className="step-icon">{step.done && !step.active ? <Check size={18} weight="bold" aria-hidden="true" /> : <Icon size={20} aria-hidden="true" />}</div><strong>{step.label}</strong><small>{step.place}</small></li>;
        })}</ol>
        {agent.serverPreview && !agent.running && <button className="proof-cta" onClick={() => void openProof()}><span><ShieldCheck size={22} aria-hidden="true" /><span><strong>Show the privacy proof</strong><small>What stayed local. What the server could see.</small></span></span><ArrowSquareOut size={20} aria-hidden="true" /></button>}
        <section className="task-card"><div className="task-label"><label htmlFor="task">What should the agent do?</label><button className="text-button" disabled={agent.running} onClick={() => setTask(DEMO_TASK)}>Use demo task</button></div><textarea id="task" rows={3} maxLength={4000} value={task} disabled={agent.running} onChange={(event) => setTask(event.target.value)} placeholder="Choose the cheapest morning fare…" />
          <div className="actions"><button className="primary" disabled={agent.running || !task.trim()} onClick={() => void command({ type: 'START_AGENT', task })}><Play weight="fill" aria-hidden="true" />{agent.running ? 'Agent running…' : 'Start agent'}</button><button className="stop-button" disabled={!agent.running} onClick={() => void command({ type: 'STOP_AGENT' })}><Stop weight="fill" aria-hidden="true" />Stop</button></div>
          {agent.running && <p className="hint">Keep this website active until the task stops.</p>}
        </section>
        {agent.pendingConfirmation && <section className="confirmation"><h3>{agent.pendingConfirmation.kind === 'CLARIFICATION' ? 'One detail needed' : 'Allow this action?'}</h3><p>{agent.pendingConfirmation.prompt}</p>
          {agent.pendingConfirmation.kind === 'CLARIFICATION' ? <><label htmlFor="clarification">Your answer</label><input id="clarification" value={clarification} onChange={(event) => setClarification(event.target.value)} /><div className="actions"><button className="primary" disabled={!clarification.trim()} onClick={() => void answer()}>Send answer</button><button className="secondary" onClick={() => void command({ type: 'STOP_AGENT' })}>Cancel task</button></div></> : <div className="actions"><button className="primary" onClick={() => confirm(true)}>Allow once</button><button className="secondary" onClick={() => confirm(false)}>Deny</button></div>}
          <details><summary>Why am I being asked?</summary><p>{agent.pendingConfirmation.action.reason}</p></details>
        </section>}
        {(agent.resultSummary || agent.error || uiError) && <section className={`result ${agent.error || uiError ? 'error-result' : 'success-result'}`} role="status"><strong>{agent.error || uiError ? 'Stopped safely' : 'Task complete'}</strong><p>{agent.error ?? uiError ?? `${agent.verifiedActions ?? 0} browser actions checked. View the privacy proof next.`}</p>{agent.resultSummary && !agent.error && <details><summary>Result details</summary><p>{agent.resultSummary}</p></details>}</section>}
        <div className="demo-shortcut"><div><strong>3-minute judge demo</strong><span>One page. A real server-planned task.</span></div><button className="text-button" disabled={agent.running} onClick={() => void browser.tabs.create({ url: DEMO_URL })}>Open demo <ArrowSquareOut aria-hidden="true" /></button></div>
        <details className="vault"><summary><LockKey size={16} aria-hidden="true" /> Private values <span>{agent.secretHandles.length ? `${agent.secretHandles.length} stored` : 'Optional'}</span></summary><p className="hint">For tasks that need your details. Original values stay in this extension; the planner only gets references.</p><div className="secret-row"><label className="sr-only" htmlFor="secret-kind">Secret type</label><select id="secret-kind" value={secretKind} onChange={(event) => setSecretKind(event.target.value)}>{SECRET_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label className="sr-only" htmlFor="secret-value">Secret value</label><input id="secret-value" type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} autoComplete="off" placeholder="Stored only here" /><button className="secondary" onClick={() => void addSecret()}>Add</button></div>{agent.secretHandles.length > 0 && <div className="handles">{agent.secretHandles.map((handle) => <code key={handle}>{handle}</code>)}<button className="text-button" onClick={() => void command({ type: 'CLEAR_SECRETS' })}>Clear vault</button></div>}</details>
        <details className="technical-details activity-details"><summary>Technical details and activity</summary><p>{agent.backendDetail}</p><p>{agent.origin}</p><div className="metrics-grid"><div><span>Total task time</span><strong>{(agent.clientMetrics.totalMs / 1000).toFixed(1)} s</strong></div><div><span>Local vision + redaction</span><strong>{Math.round(agent.clientMetrics.visualInferenceAndRedactionMs)} ms</strong></div><div><span>PII classification</span><strong>{Math.round(agent.clientMetrics.privacyClassificationMs)} ms</strong></div><div><span>Server planning</span><strong>{Math.round(agent.clientMetrics.serverPlanningMs)} ms</strong></div></div><p className="hint">Measured runtime timings, not benchmark accuracy or memory scores.</p><ol className="timeline">{agent.timeline.map((entry) => <li key={entry.id}><strong>{entry.message}</strong>{entry.safeDetail && <small>{entry.safeDetail}</small>}</li>)}</ol></details>
      </>}
      <footer><span className={`connection connection-${agent.backendStatus.toLowerCase()}`} /><span>{agent.backendStatus === 'ONLINE' ? 'Server ready' : agent.backendStatus === 'CHECKING' ? 'Checking server…' : 'Server offline: start START.command'}</span><span className="release-version">v{browser.runtime.getManifest().version}</span></footer>
    </>}
  </main>;
}
