import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect, test } from '@playwright/test';
import type { AgentCommandResponse } from '../lib/messaging/protocol';

test('three-minute story with actual local models and Qwen', async () => {
  const info = test.info();
  test.skip(process.env.CONTEXTSHIELD_E2E_LIVE !== '1', 'Needs the local model server and demo site');
  test.setTimeout(180_000);
  const path = resolve(process.env.CONTEXTSHIELD_EXTENSION_DIR ?? '.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`] });
  const payloads: string[] = [];
  const measurement: Record<string, unknown> = { generatedAt: new Date().toISOString(), repeatIndex: info.repeatEachIndex, completed: false, scope: 'Cold client models, already-running Qwen server. Task timer excludes browser setup and screenshots. Synthetic judge workflow; no user-confirmation wait.' };
  context.on('request', (request) => { if (/\/v1\/agent\/(start|step)$/.test(request.url())) payloads.push(request.postData() ?? ''); });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup.html`);
    await popup.getByRole('button', { name: 'Use demo task', exact: true }).click();
    const target = await context.newPage();
    await target.goto('http://127.0.0.1:4173/judge-run.html');
    await target.screenshot({ path: 'test-results/judge-demo-before.png' });
    await target.bringToFront();
    const start = Date.now();
    await popup.getByRole('button', { name: 'Start agent', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(async () => {
      const reply: AgentCommandResponse = await popup.evaluate(() => browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }));
      if (reply.state.error) throw new Error(JSON.stringify({ error: reply.state.error, lastAction: reply.state.lastAction, timeline: reply.state.timeline, evidence: reply.state.proofEvidence }));
      if (reply.state.pendingConfirmation) throw new Error('Unexpected confirmation for preparing a test ticket');
      return reply.state.phase;
    }, { timeout: 155_000, intervals: [1000] }).toBe('COMPLETE');
    const final: AgentCommandResponse = await popup.evaluate(() => browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }));
    measurement.metrics = final.state.clientMetrics;
    await expect(target.locator('#fare')).toHaveValue('₹899 / Saver / 09:15');
    await expect(target.locator('#done')).toContainText('Ticket prepared');
    expect(final.state.contextDelivery?.requests).toBeGreaterThan(0);
    expect(final.state.proofDelivery?.status).toBe('ACKNOWLEDGED');
    expect(final.state.verifiedActions).toBeGreaterThanOrEqual(2);
    expect(final.state.proofEvidence?.uniqueItems.EMAIL).toBe(1);
    expect(final.state.proofEvidence?.uniqueItems.FACE).toBe(1);
    expect(final.state.proofEvidence?.uniqueItems.PASSWORD).toBe(1);
    for (const raw of ['privacy.fixture@example.com', 'NeverSendThis!', 'Context Shield']) {
      expect(final.state.proofPreview).not.toContain(raw);
      expect(payloads.join('\n')).not.toContain(raw);
    }
    expect(payloads.length).toBeGreaterThan(0);
    const judge = await context.newPage();
    await judge.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup.html?view=privacy`);
    await expect(judge.locator('.redacted-image img')).toBeVisible();
    const center = await judge.locator('.redacted-image img').evaluate((img: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const drawing = canvas.getContext('2d');
      if (!drawing) throw new Error('Canvas unavailable');
      drawing.drawImage(img, 0, 0);
      return [...drawing.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
    });
    expect(center).toEqual([0, 0, 0, 255]);
    for (const name of ['Name', 'Email', 'Password', 'Face']) {
      await expect(judge.locator('.protected-items > div').filter({ has: judge.getByText(name, { exact: true }) })).toContainText('1 hidden');
    }
    await judge.screenshot({ path: 'test-results/judge-demo-proof.png', fullPage: true });
    await judge.emulateMedia({ colorScheme: 'dark' });
    await judge.screenshot({ path: 'test-results/judge-demo-proof-dark.png', fullPage: true });
    await popup.setViewportSize({ width: 440, height: 600 });
    await expect(popup.getByRole('button', { name: 'Show the privacy proof' })).toBeInViewport();
    await popup.screenshot({ path: 'test-results/judge-demo-popup.png' });
    await popup.emulateMedia({ colorScheme: 'dark' });
    await popup.screenshot({ path: 'test-results/judge-demo-popup-dark.png' });
    console.log(JSON.stringify({ measuredMs: Date.now() - start, contextRequests: final.state.contextDelivery?.requests, evidence: final.state.proofEvidence, verifiedActions: final.state.verifiedActions, metrics: final.state.clientMetrics }));
    measurement.completed = true;
    measurement.contextRequests = final.state.contextDelivery?.requests;
    measurement.verifiedActions = final.state.verifiedActions;
    measurement.checkedRawTextLeakage = false;
    measurement.faceCenterRgba = center;
  } catch (error) { measurement.failure = String(error); throw error; }
  finally {
    await mkdir(resolve('../benchmarks/results'), { recursive: true });
    await writeFile(resolve(`../benchmarks/results/judge-repeat-${info.repeatEachIndex}.json`), JSON.stringify(measurement, null, 2) + '\n');
    await context.close();
  }
});

test('shipped controls still run locally and a stale action still stops', async () => {
  test.skip(process.env.CONTEXTSHIELD_E2E_LIVE !== '1', 'Needs the demo site');
  test.setTimeout(90_000);
  const path = resolve(process.env.CONTEXTSHIELD_EXTENSION_DIR ?? '.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`] });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup.html`);
    const target = await context.newPage();
    for (const scenario of [
      { page: 'general-controls.html', task: 'Select Python from the first dropdown, select Option 2, select the Blue radio button, and stop.', phase: 'COMPLETE' },
      { page: 'fail-closed.html', task: 'Click Arm stale-state mutation, then click Continue to finish task.', phase: 'FAILED' },
    ]) {
      await popup.getByLabel('What should the agent do?').fill(scenario.task);
      await target.goto(`http://127.0.0.1:4173/${scenario.page}`);
      await target.bringToFront();
      await popup.getByRole('button', { name: 'Start agent', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
      await expect.poll(async () => {
        const reply: AgentCommandResponse = await popup.evaluate(() => browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }));
        return reply.state.phase;
      }, { timeout: 30_000 }).toBe(scenario.phase);
      const reply: AgentCommandResponse = await popup.evaluate(() => browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }));
      if (scenario.phase === 'COMPLETE') {
        await expect(target.locator('#language')).toHaveValue('Python');
        await expect(target.locator('#option-2')).toBeChecked();
        await expect(target.locator('#blue')).toBeChecked();
        expect(reply.state.contextDelivery?.status).toBe('LOCAL_ONLY');
        expect(reply.state.contextDelivery?.requests).toBe(0);
      } else {
        expect(reply.state.error).toContain('stale action was blocked');
        expect(reply.state.resultSummary).toBeNull();
        expect(reply.state.proofPreview).toContain('Arm stale-state mutation');
        expect(reply.state.proofPreview).not.toContain('First dropdown');
      }
    }
  } finally { await context.close(); }
});
