import {
  ArrowDownIcon as ArrowDown,
  ArrowRightIcon as ArrowRight,
  BrowserIcon as Browser,
  CheckIcon as Check,
  CheckCircleIcon as CheckCircle,
  ClipboardIcon as Clipboard,
  CloudIcon as Cloud,
  CodeIcon as Code,
  CpuIcon as Cpu,
  CursorClickIcon as CursorClick,
  EyeIcon as Eye,
  FingerprintIcon as Fingerprint,
  GaugeIcon as Gauge,
  LockKeyIcon as LockKey,
  PlayIcon as Play,
  ScanIcon as Scan,
  ShieldCheckIcon as ShieldCheck,
  SparkleIcon as Sparkle,
  TerminalWindowIcon as TerminalWindow,
  WarningIcon as Warning,
  XIcon as X,
} from '@phosphor-icons/react';
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';

const API_HEALTH_URL = 'http://127.0.0.1:8000/health';

type HealthState = 'checking' | 'online' | 'partial' | 'offline';

interface HealthResponse {
  model_backend?: string;
  planner_ready?: boolean;
}

interface Metric {
  value: string;
  scope: string;
}

interface Evidence {
  generated_at: string;
  metrics: Partial<Record<string, Metric>>;
  caveat: string;
}

interface DemoRoute {
  index: string;
  time: string;
  title: string;
  description: string;
  prompt: string;
  href: string;
  signal: string;
}

const steps = [
  {
    number: '01',
    eyebrow: 'Observe',
    title: 'The browser reads the page.',
    body: 'DOM, ARIA, pixels and visible controls are collected locally. Raw screen state never enters a server request.',
    detail: 'Page structure + screenshot',
    icon: Eye,
  },
  {
    number: '02',
    eyebrow: 'Detect',
    title: 'Small models find what is private.',
    body: 'YOLOX finds faces. PP-OCR reads visual text. Rampart classifies names, emails, phones and contextual PII.',
    detail: 'YOLOX + PP-OCR + Rampart',
    icon: Scan,
  },
  {
    number: '03',
    eyebrow: 'Protect',
    title: 'Identity becomes a local handle.',
    body: 'Pixels are masked and values become handles such as LOCAL_EMAIL_1. The secret stays inside the extension vault.',
    detail: 'Irreversible local redaction',
    icon: Fingerprint,
  },
  {
    number: '04',
    eyebrow: 'Reason',
    title: 'Qwen plans from the safe view.',
    body: 'The server sees a strict sanitized schema and returns one typed action. It never receives cookies, credentials or raw DOM.',
    detail: 'SanitizedContext only',
    icon: Cloud,
  },
  {
    number: '05',
    eyebrow: 'Verify',
    title: 'The browser keeps the final say.',
    body: 'Every action is grounded, policy-checked, confirmed when risky, executed locally and verified against a fresh observation.',
    detail: 'Allow, confirm or fail closed',
    icon: ShieldCheck,
  },
];

const demoRoutes: DemoRoute[] = [
  {
    index: '01',
    time: '90 sec',
    title: 'Prove the privacy boundary',
    description: 'Show a face, password and PII staying local while the server receives only counts and handles.',
    prompt: 'Summarize what is safe on this page without exposing personal or sensitive information.',
    href: 'privacy-proof.html',
    signal: 'FACE + PII + PASSWORD',
  },
  {
    index: '02',
    time: '2 min',
    title: 'Run the autonomous loop',
    description: 'Choose a fare, fill a local secret, continue, request confirmation and verify the visible outcome.',
    prompt: 'Choose the cheapest morning fare, fill my email, continue, and place the order.',
    href: 'checkout.html',
    signal: 'PLAN + ACT + VERIFY',
  },
  {
    index: '03',
    time: '60 sec',
    title: 'Ground common controls',
    description: 'Use one request across a dropdown, checkbox and radio button without relying on site-specific selectors.',
    prompt: 'Select Python from the first dropdown, select Option 2, select the Blue radio button, and stop.',
    href: 'general-controls.html',
    signal: 'SELECT + CHECK + RADIO',
  },
  {
    index: '04',
    time: '90 sec',
    title: 'Make it fail safely',
    description: 'Mutate the page after planning. The stale command is rejected instead of touching the wrong control.',
    prompt: 'Click Arm stale-state mutation, then click Continue to finish task.',
    href: 'fail-closed.html',
    signal: 'STALE ACTION BLOCKED',
  },
];

const publicTests = [
  {
    label: 'Best first test',
    title: 'Selenium web form',
    url: 'https://www.selenium.dev/selenium/web/web-form.html',
    prompt: 'Fill the Text input with ContextShield public test, select Two from the Dropdown, check the Default checkbox, and do not submit.',
  },
  {
    label: 'Most deterministic',
    title: 'The Internet checkboxes',
    url: 'https://the-internet.herokuapp.com/checkboxes',
    prompt: 'Select the first checkbox and clear the second checkbox.',
  },
  {
    label: 'External stress test',
    title: 'The Internet dropdown',
    url: 'https://the-internet.herokuapp.com/dropdown',
    prompt: 'Select Option 2 from the dropdown and stop.',
  },
];

const fallbackMetrics: Record<string, Metric> = {
  visual: { value: '167 / 167', scope: 'Expected interactables across 60 controlled screens' },
  pii: { value: '100% / 100%', scope: 'Precision / recall on 295 labelled synthetic cases' },
  redaction: { value: '100 / 100', scope: 'Controlled sensitive pixel masks verified' },
  latency: { value: '3.67 s', scope: 'Median controlled task latency' },
  resources: { value: '99.6 MB', scope: 'Packaged Chrome extension release' },
};

function copyText(value: string, onCopied: () => void) {
  void navigator.clipboard.writeText(value).then(onCopied).catch(() => {
    const helper = document.createElement('textarea');
    helper.value = value;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.append(helper);
    helper.select();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Required for browsers that deny the modern Clipboard API in a local development context.
    const copied = document.execCommand('copy');
    helper.remove();
    if (copied) onCopied();
  });
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span className="brand-c">C</span>
      <span className="brand-s">S</span>
      <span className="brand-scan" />
    </span>
  );
}

function StatusBeacon() {
  const [status, setStatus] = useState<HealthState>('checking');
  const [planner, setPlanner] = useState('Connecting to local stack');

  async function refresh() {
    setStatus('checking');
    setPlanner('Checking local services');
    try {
      const response = await fetch(API_HEALTH_URL, {
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) throw new Error('Health check failed');
      const health = (await response.json()) as HealthResponse;
      const ready = health.planner_ready !== false;
      setStatus(ready ? 'online' : 'partial');
      setPlanner(
        health.model_backend === 'llama'
          ? ready
            ? 'Qwen3-VL ready'
            : 'Agent API ready, Qwen unavailable'
          : 'Predictable mock planner',
      );
    } catch {
      setStatus('offline');
      setPlanner('Run START.command to connect');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <button className={`status-beacon status-${status}`} type="button" onClick={() => void refresh()}>
      <span className="status-light" />
      <span>
        <strong>{status === 'online' ? 'System live' : status === 'checking' ? 'System check' : status === 'partial' ? 'Partial mode' : 'System offline'}</strong>
        <small>{planner}</small>
      </span>
    </button>
  );
}

function Nav() {
  const [open, setOpen] = useState(false);
  const items = [
    ['System', '#how-it-works'],
    ['Privacy proof', '#proof'],
    ['Benchmarks', '#benchmarks'],
    ['Judge route', '#judge-run'],
  ];

  return (
    <header className="site-header">
      <a className="brand" href="#top" aria-label="ContextShield home">
        <BrandMark />
        <span className="brand-type">ContextShield</span>
      </a>
      <nav className={open ? 'nav-links nav-open' : 'nav-links'} aria-label="Primary navigation">
        {items.map(([label, href]) => (
          <a href={href} key={href} onClick={() => setOpen(false)}>{label}</a>
        ))}
      </nav>
      <div className="nav-actions">
        <StatusBeacon />
        <a className="nav-proof" href="privacy-proof.html">Open lab <ArrowRight weight="bold" /></a>
        <button
          className="menu-toggle"
          type="button"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X /> : <span>Menu</span>}
        </button>
      </div>
    </header>
  );
}

function PrivacyAperture() {
  const reducedMotion = useReducedMotion();
  return (
    <div className="aperture-wrap" aria-label="Animated diagram of private screen data becoming sanitized context">
      <div className="aperture-topline">
        <span><span className="pulse-dot" /> Live privacy pass</span>
        <span>121.9 ms</span>
      </div>
      <div className="aperture-stage">
        <div className="raw-screen">
          <div className="screen-chrome"><i /><i /><i /><span>customer.portal</span></div>
          <div className="screen-body">
            <div className="mini-profile">
              <img src="assets/fictional-profile.png" alt="Fictional profile used by the privacy demonstration" />
              <div><strong>Arindam Mukherjee</strong><span>private.customer</span></div>
            </div>
            <div className="raw-field"><span>Email</span><strong>privacy.fixture@example.com</strong></div>
            <div className="raw-field"><span>Mobile</span><strong>+91 98765 43210</strong></div>
            <div className="raw-field"><span>Password</span><strong>••••••••••••</strong></div>
          </div>
          <motion.div
            className="scan-line"
            animate={reducedMotion ? undefined : { top: ['12%', '88%', '12%'] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="face-box"
            animate={reducedMotion ? undefined : { opacity: [0.55, 1, 0.55] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <span>FACE 0.97</span>
          </motion.div>
          <motion.div
            className="redaction-slab slab-one"
            animate={reducedMotion ? undefined : { scaleX: [0, 1, 1, 0] }}
            transition={{ duration: 5, repeat: Infinity, times: [0, 0.18, 0.82, 1] }}
          />
          <motion.div
            className="redaction-slab slab-two"
            animate={reducedMotion ? undefined : { scaleX: [0, 1, 1, 0] }}
            transition={{ duration: 5, delay: 0.2, repeat: Infinity, times: [0, 0.18, 0.82, 1] }}
          />
        </div>

        <div className="gateway-beam">
          <motion.span
            animate={reducedMotion ? undefined : { x: [-20, 92], opacity: [0, 1, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
          />
          <ShieldCheck weight="fill" />
          <small>STRICT<br />GATE</small>
        </div>

        <div className="safe-packet">
          <div className="packet-label"><CheckCircle weight="fill" /> SERVER VIEW</div>
          <code>
            <span>{'{'}</span>
            <em> role:</em> <b>textbox</b>,
            <br />
            <em> label:</em> <b>Email</b>,
            <br />
            <em> handle:</em> <b>LOCAL_EMAIL_1</b>,
            <br />
            <em> value_present:</em> <b>false</b>
            <br />
            <span>{'}'}</span>
          </code>
          <div className="packet-proof"><LockKey /> 0 raw values transmitted</div>
        </div>
      </div>
      <div className="aperture-footer">
        <span><Eye /> Browser can see</span>
        <i />
        <span><LockKey /> Server cannot identify</span>
      </div>
    </div>
  );
}

function Hero() {
  const reducedMotion = useReducedMotion();
  return (
    <section className="hero" id="top">
      <div className="hero-grid" aria-hidden="true" />
      <motion.div
        className="hero-copy"
        initial={reducedMotion ? false : { opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="hero-kicker"><Sparkle weight="fill" /> SIH 2026 / PS 26171 / WORKING PROTOTYPE</div>
        <h1>The agent sees everything.<br /><span>The server never does.</span></h1>
        <p>Local vision removes identity before Qwen plans a single verified browser action.</p>
        <div className="hero-actions">
          <a className="button button-primary" href="judge-run.html"><Play weight="fill" /> Launch 3-minute demo</a>
          <a className="button button-ghost" href="privacy-proof.html">Open privacy lab <ArrowRight /></a>
        </div>
        <dl className="hero-stats">
          <div><dt>100%</dt><dd>PII recall*</dd></div>
          <div><dt>100/100</dt><dd>redaction cases*</dd></div>
          <div><dt>3.67s</dt><dd>median task*</dd></div>
        </dl>
        <small className="hero-footnote">*Controlled prototype benchmark. Full scope below.</small>
      </motion.div>
      <motion.div
        className="hero-visual"
        initial={reducedMotion ? false : { opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.9, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
      >
        <PrivacyAperture />
      </motion.div>
      <a className="scroll-cue" href="#thesis"><span>Follow the signal</span><ArrowDown /></a>
    </section>
  );
}

function SignalRail() {
  const content = ['RAW SCREEN', 'LOCAL VISION', 'PII DETECTION', 'PIXEL REDACTION', 'SANITIZED CONTEXT', 'QWEN PLAN', 'LOCAL VERIFICATION'];
  return (
    <div className="signal-rail" aria-label="ContextShield processing sequence">
      <div className="signal-track">
        {[...content, ...content].map((item, index) => (
          <span key={`${item}-${index}`}>{item}<i /></span>
        ))}
      </div>
    </div>
  );
}

function Thesis() {
  return (
    <section className="thesis shell" id="thesis">
      <div className="section-index">00 / THESIS</div>
      <div className="thesis-copy">
        <p className="section-kicker">The privacy problem with cloud agents</p>
        <h2>Useful agents need context.<br /><span>Raw context reveals people.</span></h2>
      </div>
      <div className="thesis-aside">
        <p>Passwords, faces, health data and identity fields routinely sit beside the button an agent needs to click.</p>
        <p>ContextShield separates perception from reasoning, then makes that boundary enforceable in code.</p>
      </div>
    </section>
  );
}

function SystemSteps() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start 80%', 'end 70%'] });
  const lineScale = useSpring(scrollYProgress, { stiffness: 90, damping: 25 });
  return (
    <section className="system-section shell" id="how-it-works" ref={sectionRef}>
      <div className="section-intro">
        <div className="section-index">01 / SYSTEM</div>
        <div>
          <p className="section-kicker">A complete loop, explained simply</p>
          <h2>Five gates.<br />Zero blind trust.</h2>
        </div>
        <p>Every action starts with a fresh local observation and ends with visible local verification.</p>
      </div>
      <div className="system-timeline">
        <motion.div className="timeline-progress" style={{ scaleY: lineScale }} />
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <motion.article
              className="system-step"
              key={step.number}
              initial={{ opacity: 0.25, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{ duration: 0.5 }}
            >
              <div className="step-number">{step.number}</div>
              <div className="step-icon"><Icon weight="duotone" /></div>
              <div className="step-main"><span>{step.eyebrow}</span><h3>{step.title}</h3><p>{step.body}</p></div>
              <div className="step-detail"><Check weight="bold" /> {step.detail}</div>
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}

function PrivacyProof() {
  const [view, setView] = useState<'local' | 'server'>('local');
  return (
    <section className="proof-section" id="proof">
      <div className="shell">
        <div className="section-intro proof-intro">
          <div className="section-index">02 / PRIVACY PROOF</div>
          <div><p className="section-kicker">Do not take our word for it</p><h2>Flip the boundary.</h2></div>
          <p>One fixture. Two views. The difference is the product.</p>
        </div>
        <div className="proof-lab">
          <div className="proof-toolbar">
            <div className="proof-tabs" role="tablist" aria-label="Privacy proof view">
              <button type="button" role="tab" aria-selected={view === 'local'} onClick={() => setView('local')}><Eye /> Local device</button>
              <button type="button" role="tab" aria-selected={view === 'server'} onClick={() => setView('server')}><Cloud /> Actual server view</button>
            </div>
            <span className="proof-badge"><ShieldCheck weight="fill" /> Privacy boundary enforced</span>
          </div>
          <div className="proof-canvas">
            <motion.div
              className="proof-view"
              key={view}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
            >
              {view === 'local' ? (
                <>
                  <div className="local-portrait">
                    <img src="assets/fictional-profile.png" alt="Fictional person used for local face detection" />
                    <span className="detect-box"><i>FACE</i><b>0.97</b></span>
                  </div>
                  <div className="local-record">
                    <p className="code-label">RAW SCREEN STATE / DEVICE ONLY</p>
                    <dl>
                      <div><dt>Person name</dt><dd>Arindam Mukherjee</dd><span>PERSON</span></div>
                      <div><dt>Email</dt><dd>privacy.fixture@example.com</dd><span>EMAIL</span></div>
                      <div><dt>Mobile</dt><dd>+91 98765 43210</dd><span>PHONE</span></div>
                      <div><dt>UPI</dt><dd>private.user@oksbi</dd><span>FINANCIAL</span></div>
                      <div><dt>Password</dt><dd>••••••••••••</dd><span>SECRET</span></div>
                    </dl>
                    <p className="never-sent"><LockKey weight="fill" /> Never serialized. Never transmitted.</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="server-empty">
                    <div className="empty-orbit"><Cloud weight="duotone" /><span>0</span></div>
                    <h3>Zero identifying values</h3>
                    <p>The planner receives roles, labels, privacy counts and local handles only.</p>
                  </div>
                  <div className="server-json">
                    <p className="code-label">SANITIZED CONTEXT / ALLOWED OUTBOUND</p>
                    <pre><code>{`{
  "role": "textbox",
  "label": "Email",
  "value_handle": "LOCAL_EMAIL_1",
  "value_present": false,
  "safe_visual_crops": [],
  "privacy_summary": {
    "EMAIL": 1,
    "FACE": 1,
    "SECRET": 1
  }
}`}</code></pre>
                    <p className="packet-valid"><CheckCircle weight="fill" /> Passed strict SanitizedContext schema</p>
                  </div>
                </>
              )}
            </motion.div>
          </div>
          <div className="proof-footer">
            <div><strong>Try it live</strong><span>Open the fixture, start the extension, then expand “Actual server view”.</span></div>
            <a className="button button-primary" href="privacy-proof.html">Launch privacy proof <ArrowRight /></a>
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricTile({ name, metric, symbol }: { name: string; metric: Metric; symbol: string }) {
  return (
    <article className="metric-tile">
      <div className="metric-head"><span>{name}</span><i>{symbol}</i></div>
      <strong>{metric.value}</strong>
      <p>{metric.scope}</p>
    </article>
  );
}

function Benchmarks() {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('evidence.json', { cache: 'no-store', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Evidence unavailable');
        return response.json() as Promise<Evidence>;
      })
      .then(setEvidence)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const metrics = evidence?.metrics ?? fallbackMetrics;
  const generated = useMemo(() => {
    if (!evidence?.generated_at) return null;
    const date = new Date(evidence.generated_at);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
  }, [evidence]);

  return (
    <section className="benchmark-section shell" id="benchmarks">
      <div className="section-intro benchmark-intro">
        <div className="section-index">03 / MEASURED EVIDENCE</div>
        <div><p className="section-kicker">Built to match the SIH scoring weights</p><h2>Proof, with the scope attached.</h2></div>
        <p>{failed ? 'Showing the latest packaged snapshot.' : evidence ? `Live snapshot loaded from ${generated ?? 'the latest benchmark run'}.` : 'Loading the latest benchmark run...'}</p>
      </div>
      <div className="metric-grid" aria-live="polite">
        <MetricTile name="Visual context recall" metric={metrics.visual ?? fallbackMetrics.visual} symbol="25%" />
        <MetricTile name="PII precision / recall" metric={metrics.pii ?? fallbackMetrics.pii} symbol="20%" />
        <MetricTile name="Redaction verification" metric={metrics.redaction ?? fallbackMetrics.redaction} symbol="20%" />
        <MetricTile name="Median task latency" metric={metrics.latency ?? fallbackMetrics.latency} symbol="15%" />
        <MetricTile name="Client package" metric={metrics.resources ?? fallbackMetrics.resources} symbol="20%" />
      </div>
      <div className="evidence-note">
        <Warning weight="fill" />
        <div><strong>Honest benchmark boundary</strong><p>{evidence?.caveat ?? 'Controlled results validate the prototype. A larger human-reviewed visual dataset and extension-only resource isolation remain production evaluation work.'}</p></div>
      </div>
    </section>
  );
}

function CopyPrompt({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy-prompt"
      type="button"
      onClick={() => copyText(prompt, () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })}
    >
      {copied ? <Check weight="bold" /> : <Clipboard />}{copied ? 'Copied' : 'Copy prompt'}
    </button>
  );
}

function JudgeRoute() {
  return (
    <section className="route-section" id="judge-run">
      <div className="shell">
        <div className="section-intro route-intro">
          <div className="section-index">04 / LIVE DEMO</div>
          <div><p className="section-kicker">The judge route</p><h2>Six minutes.<br />Four decisive proofs.</h2></div>
          <p>Use these exact prompts for a repeatable presentation under judging pressure.</p>
        </div>
        <div className="route-list">
          {demoRoutes.map((route) => (
            <article className="route-row" key={route.index}>
              <div className="route-index">{route.index}</div>
              <div className="route-meta"><span>{route.time}</span><small>{route.signal}</small></div>
              <div className="route-body"><h3>{route.title}</h3><p>{route.description}</p><code>{route.prompt}</code></div>
              <div className="route-buttons"><CopyPrompt prompt={route.prompt} /><a href={route.href} aria-label={`Open ${route.title}`}>Open <ArrowRight /></a></div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Architecture() {
  return (
    <section className="architecture-section shell" id="architecture">
      <div className="section-intro architecture-intro">
        <div className="section-index">05 / ARCHITECTURE</div>
        <div><p className="section-kicker">The moat is the boundary</p><h2>Privacy enforced by shape.</h2></div>
        <p>Raw browser data has no field in the server contract. There is no raw fallback path.</p>
      </div>
      <div className="architecture-map">
        <div className="arch-side arch-browser">
          <span className="arch-label"><Browser weight="fill" /> TRUSTED DEVICE</span>
          <h3>Local privacy plane</h3>
          <ul>
            <li><Scan /> YOLOX face detection</li>
            <li><Code /> PP-OCR pixel text</li>
            <li><Fingerprint /> Rampart PII classification</li>
            <li><LockKey /> Secret vault and redaction</li>
            <li><CursorClick /> Action broker and verifier</li>
          </ul>
        </div>
        <div className="arch-gateway">
          <div className="gateway-ring ring-one" />
          <div className="gateway-ring ring-two" />
          <div className="gateway-core"><ShieldCheck weight="fill" /><strong>STRICT<br />SCHEMA</strong></div>
          <div className="gateway-in"><span /> SanitizedContext</div>
          <div className="gateway-out">TypedAction <span /></div>
        </div>
        <div className="arch-side arch-cloud">
          <span className="arch-label"><Cloud weight="fill" /> REASONING SERVER</span>
          <h3>Safe reasoning plane</h3>
          <ul>
            <li><CheckCircle /> Pydantic validation</li>
            <li><Cpu /> Qwen3-VL planning</li>
            <li><TerminalWindow /> One typed action</li>
            <li><Clipboard /> Sanitized trace</li>
            <li className="blocked"><X /> No cookies or credentials</li>
          </ul>
        </div>
      </div>
      <div className="arch-principle"><span>01</span><p><strong>The server proposes.</strong> The browser disposes.</p><span>02</span><p><strong>Every action is temporary.</strong> Every result is checked.</p></div>
    </section>
  );
}

function Impact() {
  const sectors = [
    ['Citizen services', 'Complex public forms, with identity fields kept on the citizen’s device.'],
    ['Healthcare + insurance', 'Repetitive portal work, without exposing raw patient or policy details.'],
    ['Enterprise operations', 'Governed HR and support automation, with local secrets and safe traces.'],
  ];
  return (
    <section className="impact-section shell">
      <div className="section-intro impact-intro">
        <div className="section-index">06 / IMPACT</div>
        <div><p className="section-kicker">Where normal cloud agents cannot go</p><h2>Sensitive workflows.<br />Practical automation.</h2></div>
        <p>Start with one department and fixed workflows. Grow into a managed privacy layer for the organisation.</p>
      </div>
      <div className="sector-list">
        {sectors.map(([title, text], index) => (
          <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{text}</p><ArrowRight /></article>
        ))}
      </div>
      <div className="business-line">
        <div><span>BEACHHEAD</span><strong>Measured departmental pilot</strong></div>
        <ArrowRight />
        <div><span>DEPLOYMENT</span><strong>Managed extension + private server</strong></div>
        <ArrowRight />
        <div><span>SUSTAINABILITY</span><strong>Policy packs, audits + signed updates</strong></div>
      </div>
    </section>
  );
}

function PublicTests() {
  return (
    <section className="public-section" id="public-tests">
      <div className="shell">
        <div className="section-intro public-intro">
          <div className="section-index">07 / PUBLIC-SITE TESTS</div>
          <div><p className="section-kicker">Beyond our own fixtures</p><h2>Take it into the open.</h2></div>
          <p>Use synthetic values only. Public practice pages can change, so run these after the controlled judge route.</p>
        </div>
        <div className="public-list">
          {publicTests.map((test, index) => (
            <article key={test.title}>
              <span className="public-number">0{index + 1}</span>
              <div><small>{test.label}</small><h3>{test.title}</h3><code>{test.prompt}</code></div>
              <div className="public-actions"><CopyPrompt prompt={test.prompt} /><a href={test.url} target="_blank" rel="noreferrer">Open site <ArrowRight /></a></div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Scope() {
  return (
    <section className="scope-section shell">
      <div className="scope-label"><Gauge weight="duotone" /> PROTOTYPE SCOPE</div>
      <div className="scope-side scope-proven">
        <span><CheckCircle weight="fill" /> PROVEN TODAY</span>
        <h2>One real privacy-preserving agent loop.</h2>
        <p>Local multimodal perception, contextual PII detection, pixel redaction, sanitized planning, confirmed execution, visible verification and fail-closed behavior.</p>
      </div>
      <div className="scope-side scope-limit">
        <span><Warning weight="fill" /> NOT CLAIMED</span>
        <h2>Universal compatibility is still research.</h2>
        <p>Browser-owned pages, inaccessible cross-origin frames, closed shadow roots and production-scale visual accuracy require more engineering and independent evaluation.</p>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="final-cta shell">
      <div className="final-signal" aria-hidden="true"><span /><span /><span /><span /><ShieldCheck weight="fill" /></div>
      <p className="section-kicker">The first proof takes 90 seconds</p>
      <h2>See what the server<br /><em>cannot</em> see.</h2>
      <div className="final-actions"><a className="button button-primary" href="privacy-proof.html"><Play weight="fill" /> Launch the privacy lab</a><a href="#judge-run">View judge route <ArrowRight /></a></div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="site-footer shell">
      <div className="footer-brand"><BrandMark /><div><strong>ContextShield</strong><span>Local-first browser intelligence</span></div></div>
      <p>Built for SIH 2026 / Problem Statement 26171</p>
      <div><a href="#architecture">Architecture</a><a href="#benchmarks">Benchmarks</a><a href="#top">Back to top <ArrowDown className="back-arrow" /></a></div>
    </footer>
  );
}

function App() {
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });
  const glowOpacity = useTransform(scrollYProgress, [0, 0.25, 0.65, 1], [0.65, 0.2, 0.4, 0.1]);

  return (
    <>
      <a className="skip-link" href="#main">Skip to the system</a>
      <motion.div className="page-progress" style={{ scaleX: progress }} />
      <motion.div className="ambient-glow" style={{ opacity: glowOpacity }} aria-hidden="true" />
      <Nav />
      <main id="main">
        <Hero />
        <SignalRail />
        <Thesis />
        <SystemSteps />
        <PrivacyProof />
        <Benchmarks />
        <JudgeRoute />
        <Architecture />
        <Impact />
        <PublicTests />
        <Scope />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}

export default App;
