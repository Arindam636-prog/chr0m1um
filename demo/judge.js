const API_HEALTH_URL = 'http://127.0.0.1:8000/health';

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

async function refreshHealth() {
  const status = document.querySelector('#backend-status');
  const detail = document.querySelector('#health-detail');
  if (!status || !detail) return;

  status.textContent = 'Checking';
  status.className = 'status-tag status-checking';
  detail.textContent = 'The page is checking the local service at 127.0.0.1:8000.';

  try {
    const response = await fetch(API_HEALTH_URL, {
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error('Health check failed');
    const health = await response.json();
    const plannerReady = health.planner_ready !== false;
    status.textContent = plannerReady ? 'Online' : 'API only';
    status.className = `status-tag ${plannerReady ? 'status-ready' : 'status-caution'}`;
    const mode = health.model_backend === 'llama'
      ? (plannerReady ? 'Qwen3-VL ready' : 'Qwen3-VL unavailable')
      : 'Predictable mock planner';
    setText('#planner-mode', mode);
    detail.textContent = plannerReady
      ? 'The local agent API and its configured planner are responding.'
      : 'The API is responding, but Qwen is not. Exact local control tasks can still run.';
  } catch {
    status.textContent = 'Offline';
    status.className = 'status-tag status-offline';
    setText('#planner-mode', 'Not connected');
    detail.textContent = 'Start the stack with START.command, then refresh this check.';
  }
}

async function loadEvidence() {
  try {
    const response = await fetch('evidence.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Evidence unavailable');
    const evidence = await response.json();
    for (const [key, metric] of Object.entries(evidence.metrics ?? {})) {
      setText(`[data-metric="${key}"]`, metric.value);
      setText(`[data-scope="${key}"]`, metric.scope);
    }
    const generated = new Date(evidence.generated_at);
    const readableDate = Number.isNaN(generated.getTime())
      ? 'date unavailable'
      : generated.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    setText('#evidence-updated', `Loaded from benchmarks/results/latest.json, generated ${readableDate}.`);
    if (evidence.caveat) setText('#evidence-caveat', evidence.caveat);
  } catch {
    setText('#evidence-updated', 'The benchmark snapshot is unavailable. Run npm run sync:demo-evidence.');
    for (const element of document.querySelectorAll('[data-metric]')) element.textContent = 'Unavailable';
  }
}

function promptFor(button) {
  const container = button.closest('li, article');
  return container?.querySelector('[data-prompt]')?.textContent?.trim() ?? '';
}

function copyPrompt(button) {
  const prompt = promptFor(button);
  if (!prompt) return;
  const original = button.textContent;
  const helper = document.createElement('textarea');
  helper.value = prompt;
  helper.setAttribute('readonly', '');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  document.body.append(helper);
  helper.select();
  const copied = document.execCommand('copy');
  helper.remove();
  if (!copied && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(prompt).catch(() => undefined);
  }
  button.textContent = copied ? 'Copied' : 'Copy requested';
  window.setTimeout(() => { button.textContent = original; }, 1800);
}

document.querySelector('#refresh-health')?.addEventListener('click', () => void refreshHealth());
for (const button of document.querySelectorAll('[data-copy-prompt]')) {
  button.addEventListener('click', () => copyPrompt(button));
}

void Promise.all([refreshHealth(), loadEvidence()]);
