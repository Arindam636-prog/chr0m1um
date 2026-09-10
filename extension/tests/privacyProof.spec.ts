import { resolve } from 'node:path';
import { chromium, expect, test, type Page } from '@playwright/test';
import fixture from '../../shared/fixtures/sanitized-context.json' with { type: 'json' };
import type { AgentCommandResponse, PublicAgentState } from '../lib/messaging/protocol';

async function displayState(page: Page, state: PublicAgentState) {
  await page.evaluate((next) => {
    // UI fixture only: isolate rendering from models, real pages and backend availability.
    browser.runtime.sendMessage = () => Promise.resolve({ ok: true, state: next });
  }, state);
}

test('judge view renders real-shaped sanitized data, delivery states and freeze control without originals', async () => {
  const extensionPath = resolve(process.env.CONTEXTSHIELD_EXTENSION_DIR ?? '.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    const baseUrl = `chrome-extension://${new URL(worker.url()).hostname}/popup.html`;
    const popup = await context.newPage();
    await popup.goto(baseUrl);
    const initial: AgentCommandResponse = await popup.evaluate(() => browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }));
    const newPage = context.waitForEvent('page');
    await popup.getByRole('button', { name: 'Privacy proof', exact: true }).click();
    await popup.getByRole('button', { name: 'Open judge view' }).click();
    const page = await newPage;
    await page.waitForURL(`${baseUrl}?view=privacy`);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await expect(page.getByText('Your next run appears here')).toBeVisible();
    await expect(page.getByText('Encryption protects the journey.', { exact: false })).toHaveCount(0);
    const delivery = { status: 'LOCAL_ONLY' as const, requests: 0, endpoint: 'http://127.0.0.1:8000' };
    const state: PublicAgentState = {
      ...initial.state,
      task: 'private-original@example.invalid',
      serverPreview: JSON.stringify(fixture),
      privacySummary: { EMAIL: 1, PASSWORD: 1 },
      contextDelivery: delivery,
    };
    await displayState(page, state);
    await expect(page.getByText('Handled on device · this context was not sent')).toBeVisible();
    await expect(page.locator('.safe-controls code')).toHaveText('LOCAL_EMAIL_1');
    await expect(page.locator('.safe-controls')).toContainText('Continue');
    await expect(page.locator('body')).not.toContainText('private-original@example.invalid');
    await expect(page.locator('pre')).not.toBeVisible();
    await expect(page.locator('.no-image')).toContainText('No image was included');
    await expect(page.getByRole('button', { name: 'Start agent', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Freeze view' }).click();
    const acknowledged = { ...state, contextDelivery: { ...delivery, status: 'ACKNOWLEDGED' as const, requests: 1 } };
    await displayState(page, acknowledged);
    await expect(page.getByText('Display frozen for presenting. The agent itself is not paused.')).toBeVisible();
    await expect(page.getByText('Handled on device · this context was not sent')).toBeVisible();
    await page.getByRole('button', { name: 'Resume live view' }).click();
    await expect(page.getByText('Server responded to this context', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/privacy-proof-judge-light.png', fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: 'test-results/privacy-proof-judge-dark.png', fullPage: true });
    const imageContext = { ...fixture, safe_visual_crops: [{
      id: 'crop_ui_test', mime_type: 'image/png', sha256: 'a'.repeat(64),
      width: 1, height: 1, redaction_verified: true,
      data_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=',
    }] };
    await displayState(page, { ...acknowledged, serverPreview: JSON.stringify(imageContext) });
    await expect(page.locator('.redacted-image img')).toHaveCount(1);
    await expect(page.locator('.redacted-image img')).toHaveAttribute('src', `data:image/png;base64,${imageContext.safe_visual_crops[0]?.data_base64}`);
    await displayState(page, { ...state, contextDelivery: { ...delivery, status: 'UNCONFIRMED', requests: 1 } });
    await expect(page.getByText('Request attempted · receipt not confirmed')).toBeVisible();
    await page.setViewportSize({ width: 420, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await displayState(popup, acknowledged);
    await popup.setViewportSize({ width: 440, height: 600 });
    await expect(popup.getByText('Server responded to this context', { exact: true })).toBeVisible();
    expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await popup.locator('.privacy-proof').screenshot({ path: 'test-results/privacy-proof-popup.png' });
    await displayState(popup, { ...state, running: true });
    await expect(popup.getByRole('button', { name: 'Open judge view' })).toBeDisabled();
  } finally {
    await context.close();
  }
});
