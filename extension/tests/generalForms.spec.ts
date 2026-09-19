import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import { chromium, expect, test } from '@playwright/test';

import type { AgentCommandResponse } from '../lib/messaging/protocol';

const PORT = 8000;
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

function listen(server: Server): Promise<void> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolveListen);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function json(response: ServerResponse, payload: unknown): void {
  response.writeHead(200, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
  });
  response.end(JSON.stringify(payload));
}

test('grounds and completes dropdown, checkbox, and radio tasks without clarification loops', async () => {
  test.setTimeout(180_000);
  let sequence = 0;
  const payloads: string[] = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/health') {
      json(response, { status: 'ok', service: 'contextshield-agent', model_backend: 'mock' });
      return;
    }
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><title>General form fixture</title>
        <main>
          <select id="language"><option>JAVA</option><option>C#</option><option>Python</option><option>SQL</option></select>
          <section><input id="option-1" type="checkbox" value="option-1"> Option 1</section>
          <section><input id="option-2" type="checkbox" value="option-2"> Option 2</section>
          <section><input id="green" type="radio" name="color" value="green" checked> Green</section>
          <section><input id="blue" type="radio" name="color" value="blue"> Blue</section>
        </main>
        <aside id="third-party-extension-root"><button>Injected tool</button></aside>`);
      return;
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST',
        'access-control-allow-headers': 'content-type',
      });
      response.end();
      return;
    }
    if (!request.url?.startsWith('/v1/agent/')) return void response.writeHead(404).end();
    const raw = await body(request);
    payloads.push(raw);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (request.url === '/v1/agent/verify') {
      json(response, { session_id: SESSION_ID, state: 'OBSERVE', accepted: true });
      return;
    }
    const safeContext = (request.url === '/v1/agent/start' ? parsed : parsed.context) as {
      snapshot_id: string;
      elements: Array<{
        id: string;
        role: string;
        selected: boolean | null;
        selected_option: string | null;
        control_value: string | null;
        options: string[];
      }>;
    };
    sequence += 1;
    const base = { action_id: `act_general_${sequence}`, snapshot_id: safeContext.snapshot_id };
    const language = safeContext.elements.find((element) => element.role === 'combobox');
    const optionTwo = safeContext.elements.find((element) => element.control_value === 'option-2');
    const blue = safeContext.elements.find((element) => element.control_value === 'blue');
    if (language?.selected_option !== 'Python') {
      json(response, { session_id: SESSION_ID, state: 'EXECUTE', action: { ...base, type: 'SELECT', element_id: language?.id, option: 'Python', reason: 'Choose the requested Python option' } });
    } else if (!optionTwo?.selected) {
      json(response, { session_id: SESSION_ID, state: 'EXECUTE', action: { ...base, type: 'CLICK', element_id: optionTwo?.id, reason: 'Select Option 2' } });
    } else if (!blue?.selected) {
      json(response, { session_id: SESSION_ID, state: 'EXECUTE', action: { ...base, type: 'CLICK', element_id: blue?.id, reason: 'Select the blue radio button' } });
    } else {
      json(response, { session_id: SESSION_ID, state: 'COMPLETE', action: { ...base, type: 'FINISH', reason: 'All requested control states are verified', summary: 'Python, Option 2, and Blue are selected.' } });
    }
  });
  await listen(server);

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${resolve('.output/chrome-mv3')}`,
      `--load-extension=${resolve('.output/chrome-mv3')}`,
    ],
  });

  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).hostname;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.evaluate(() => browser.storage.local.set({ contextshieldPiiMode: 'deterministic' }));
    await popup.getByLabel('What should the agent do?').fill(
      'Select Python from the first dropdown, select option 2, select the blue radio button, and stop.',
    );
    const target = await context.newPage();
    await target.goto(`http://127.0.0.1:${PORT}/`);
    await target.bringToFront();
    await popup.getByRole('button', { name: 'Start agent' }).evaluate((button: HTMLButtonElement) => button.click());

    await expect.poll(async () => {
      const reply: AgentCommandResponse = await popup.evaluate(() =>
        browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
      );
      if (reply.state.phase === 'FAILED') throw new Error(reply.state.error ?? 'Agent failed');
      return reply.state.phase;
    }, { timeout: 150_000 }).toBe('COMPLETE');

    await expect(target.locator('#language')).toHaveValue('Python');
    await expect(target.locator('#option-2')).toBeChecked();
    await expect(target.locator('#blue')).toBeChecked();
    // Exact form controls are now handled entirely on-device. The mock Qwen
    // endpoint should receive no page context at all for this task.
    expect(payloads).toHaveLength(0);
    await popup.locator('.activity-details > summary').click();
    await expect(popup.getByText('Local controller returned a structured action').first()).toBeVisible();
    await expect(popup.getByText('Server ready', { exact: true })).toBeVisible();
  } finally {
    await context.close();
    await close(server);
  }
});

test('accepts a typed clarification and sanitizes it before replanning', async () => {
  test.setTimeout(120_000);
  let sequence = 0;
  const tasks: string[] = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/health') {
      json(response, { status: 'ok', service: 'contextshield-agent', model_backend: 'mock' });
      return;
    }
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>Clarification fixture</title><main><p>Two similar controls are available.</p></main>');
      return;
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST',
        'access-control-allow-headers': 'content-type',
      });
      response.end();
      return;
    }
    if (!request.url?.startsWith('/v1/agent/')) return void response.writeHead(404).end();
    const raw = await body(request);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (request.url === '/v1/agent/verify') {
      json(response, { session_id: SESSION_ID, state: 'OBSERVE', accepted: true });
      return;
    }
    const safeContext = (request.url === '/v1/agent/start' ? parsed : parsed.context) as {
      task: string;
      snapshot_id: string;
    };
    tasks.push(safeContext.task);
    sequence += 1;
    const base = { action_id: `act_clarify_${sequence}`, snapshot_id: safeContext.snapshot_id };
    if (!safeContext.task.includes('User clarification: first dropdown')) {
      json(response, { session_id: SESSION_ID, state: 'EXECUTE', action: { ...base, type: 'ASK_USER', question: 'Which dropdown should I use?', reason: 'The requested target is ambiguous' } });
    } else {
      json(response, { session_id: SESSION_ID, state: 'COMPLETE', action: { ...base, type: 'FINISH', reason: 'The ambiguity was resolved', summary: 'Clarification received and task safely resolved.' } });
    }
  });
  await listen(server);

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${resolve('.output/chrome-mv3')}`,
      `--load-extension=${resolve('.output/chrome-mv3')}`,
    ],
  });
  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).hostname;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.evaluate(() => browser.storage.local.set({ contextshieldPiiMode: 'deterministic' }));
    await popup.getByLabel('What should the agent do?').fill('Use the correct dropdown.');
    const target = await context.newPage();
    await target.goto(`http://127.0.0.1:${PORT}/`);
    await target.bringToFront();
    await popup.getByRole('button', { name: 'Start agent' }).evaluate((button: HTMLButtonElement) => button.click());

    await expect(popup.getByRole('heading', { name: 'One detail needed' })).toBeVisible({ timeout: 60_000 });
    await popup.getByLabel('Your answer').fill('first dropdown');
    await target.bringToFront();
    await popup.getByRole('button', { name: 'Send answer' }).evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(async () => {
      const reply: AgentCommandResponse = await popup.evaluate(() =>
        browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
      );
      return reply.state.phase;
    }, { timeout: 60_000 }).toBe('COMPLETE');
    expect(tasks.at(-1)).toContain('User clarification: first dropdown');
  } finally {
    await context.close();
    await close(server);
  }
});
