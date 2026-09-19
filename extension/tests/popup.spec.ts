import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import { chromium, expect, test } from '@playwright/test';

import type { AgentCommandResponse } from '../lib/messaging/protocol';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveListen());
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

test('runs the complete private local-handle agent loop in real Chrome MV3', async () => {
  test.setTimeout(180_000);
  const extensionPath = resolve('.output/chrome-mv3');
  const rampartSmoke = process.env.CONTEXTSHIELD_E2E_RAMPART === '1';
  const pagePort = rampartSmoke ? 8001 : 8000;
  const agentPayloads: string[] = [];
  let actionSequence = 0;
  const server = createServer(async (request, response) => {
    if (request.url === '/health') {
      json(response, { status: 'ok', service: 'contextshield-agent', model_backend: 'mock' });
      return;
    }
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html>
        <title>ContextShield demo checkout</title>
        <label>Email <input type="email" /></label>
        <div data-contextshield-visual-control data-contextshield-sensitive="face"
             role="img" aria-label="Private profile image"
             style="width:120px;height:80px;background:#d4a574;color:#111">Private face</div>
        <button id="continue">Continue</button>
        <script>
          document.querySelector('#continue').addEventListener('click', () => {
            window.filledValueBeforeComplete = document.querySelector('input').value;
            document.body.innerHTML = '<h1>Demo complete</h1>';
          });
        </script>`);
      return;
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'content-type',
      });
      response.end();
      return;
    }
    if (request.url?.startsWith('/v1/agent/')) {
      const requestBody = await body(request);
      agentPayloads.push(requestBody);
      const parsed = JSON.parse(requestBody) as Record<string, unknown>;
      if (request.url === '/v1/agent/verify') {
        json(response, { session_id: SESSION_ID, state: 'OBSERVE', accepted: true });
        return;
      }
      const context = (request.url === '/v1/agent/start'
        ? parsed
        : parsed.context) as {
        snapshot_id: string;
        elements: Array<{
          id: string;
          role: string;
          text: string | null;
          value_handle: string | null;
          value_present: boolean;
        }>;
      };
      const email = context.elements.find((element) => element.value_handle);
      const continueButton = context.elements.find(
        (element) => element.role === 'button' && element.text?.includes('Continue'),
      );
      actionSequence += 1;
      const base = {
        action_id: `act_e2e_${actionSequence}`,
        snapshot_id: context.snapshot_id,
      };
      if (email) {
        json(response, {
          session_id: SESSION_ID,
          state: 'EXECUTE',
          action: {
            ...base,
            type: 'TYPE_HANDLE',
            element_id: email.id,
            handle: email.value_handle,
            reason: 'Fill the email through its local-only handle',
          },
        });
        return;
      }
      if (continueButton) {
        json(response, {
          session_id: SESSION_ID,
          state: 'EXECUTE',
          action: {
            ...base,
            type: 'CLICK',
            element_id: continueButton.id,
            reason: 'Continue to the completion page',
          },
        });
        return;
      }
      json(response, {
        session_id: SESSION_ID,
        state: 'COMPLETE',
        action: {
          ...base,
          type: 'FINISH',
          reason: 'The controlled demo reached its completion state',
          summary: 'The demo task completed without sending the email value.',
        },
      });
      return;
    }
    response.writeHead(404).end();
  });
  await listen(server, pagePort);

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).hostname;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    if (!rampartSmoke) {
      await popup.evaluate(() => browser.storage.local.set({ contextshieldPiiMode: 'deterministic' }));
    }
    await popup.locator('.vault > summary').click();
    await popup.locator('.activity-details > summary').click();
    await popup.getByLabel('Secret value').fill('private@example.com');
    await popup.getByRole('button', { name: 'Add' }).click();
    await expect(popup.locator('code', { hasText: 'LOCAL_EMAIL_1' })).toBeVisible();
    await popup.getByLabel('What should the agent do?').fill('Fill my email and continue');

    const target = await context.newPage();
    await target.goto(`http://127.0.0.1:${pagePort}/`);
    await target.bringToFront();
    await popup
      .getByRole('button', { name: 'Start agent' })
      .evaluate((button: HTMLButtonElement) => button.click());

    if (rampartSmoke) {
      const rampartOutcome = await Promise.race([
        popup.getByText('Rampart ONNX contextual PII model ready').waitFor({ timeout: 150_000 }).then(() => 'ready'),
        popup.locator('.phase-failed').waitFor({ timeout: 150_000 }).then(() => 'failed'),
      ]);
      if (rampartOutcome === 'failed') {
        throw new Error(`Rampart failed: ${await popup.locator('.error-result').innerText()}`);
      }
      const protectionOutcome = await Promise.race([
        popup.getByText('Safe context created').waitFor({ timeout: 150_000 }).then(() => 'ready'),
        popup.locator('.phase-failed').waitFor({ timeout: 150_000 }).then(() => 'failed'),
      ]);
      if (protectionOutcome === 'failed') {
        throw new Error(`Rampart protection failed: ${await popup.locator('.error-result').innerText()}`);
      }
      return;
    }

    await popup.getByRole('button', { name: 'Allow once' }).waitFor({ timeout: 150_000 });
    await popup.getByRole('button', { name: 'Allow once' }).evaluate((button: HTMLButtonElement) => button.click());
    const outcome = await Promise.race([
      popup.locator('.success-result').getByText('Task complete', { exact: true }).waitFor({ timeout: 150_000 }).then(() => 'complete'),
      popup.locator('.phase-failed').waitFor({ timeout: 150_000 }).then(() => 'failed'),
    ]);
    if (outcome === 'failed') {
      throw new Error(`Extension failed: ${await popup.locator('.error-result').innerText()}`);
    }
    await expect(popup.getByText('Page observed locally').first()).toBeVisible();
    await expect(popup.getByText('Safe context created').first()).toBeVisible();
    await expect(popup.getByText('Local controller returned a structured action').first()).toBeVisible();
    await expect(target.getByText('Demo complete')).toBeVisible();
    expect(await target.evaluate(() => (window as Window & { filledValueBeforeComplete?: string }).filledValueBeforeComplete)).toBe('private@example.com');
    expect(agentPayloads).toHaveLength(0);
    const finalState: AgentCommandResponse = await popup.evaluate(() =>
      browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
    );
    expect(finalState.state.serverPreview).not.toContain('private@example.com');
    expect(finalState.state.contextDelivery).toMatchObject({ status: 'LOCAL_ONLY', requests: 0 });
    expect(finalState.state.serverPreview).toContain('"redaction_verified": true');
    expect(finalState.state.clientMetrics.pixelRecords).toBeGreaterThanOrEqual(0);
  } finally {
    await context.close();
    await close(server);
  }
});
