import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';

import { chromium, expect, test } from '@playwright/test';

import type { AgentCommandResponse } from '../lib/messaging/protocol';

const PAGE_PORT = 8002;

function listen(server: Server): Promise<void> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(PAGE_PORT, '127.0.0.1', resolveListen);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

test('completes a grounded browser task while the Qwen service is offline', async () => {
  test.setTimeout(120_000);
  const server = createServer((request, response) => {
    if (request.url !== '/') return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>Offline local controller</title>
      <label><input id="one" type="checkbox"> Option 1</label>
      <label><input id="two" type="checkbox"> Option 2</label>`);
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
    await popup.getByLabel('What should the agent do?').fill('Select the second checkbox and stop.');
    const target = await context.newPage();
    await target.goto(`http://127.0.0.1:${PAGE_PORT}/`);
    await target.bringToFront();
    await popup.getByRole('button', { name: 'Start agent' }).evaluate((button: HTMLButtonElement) => button.click());

    await expect.poll(async () => {
      const reply: AgentCommandResponse = await popup.evaluate(() =>
        browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
      );
      if (reply.state.phase === 'FAILED') throw new Error(reply.state.error ?? 'Agent failed');
      return reply.state.phase;
    }, { timeout: 90_000 }).toBe('COMPLETE');

    await expect(target.locator('#one')).not.toBeChecked();
    await expect(target.locator('#two')).toBeChecked();
    await expect(popup.getByText('Server offline: start START.command')).toBeVisible();
    const reply: AgentCommandResponse = await popup.evaluate(() =>
      browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
    );
    expect(reply.state.sessionId).toBeNull();
    expect(reply.state.clientMetrics.serverPlanningMs).toBe(0);
  } finally {
    await context.close();
    await close(server);
  }
});
