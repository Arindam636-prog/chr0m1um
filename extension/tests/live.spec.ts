import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { chromium, expect, test } from '@playwright/test';
import type { BrowserContext, Page, Worker } from '@playwright/test';

import type { AgentCommandResponse } from '../lib/messaging/protocol';

const extensionPath = resolve(
  process.env.CONTEXTSHIELD_EXTENSION_DIR ?? '.output/chrome-mv3',
);

const liveResults: Array<{
  scenario: string;
  completed: boolean;
  endToEndMs: number;
  privacyMs: number | null;
  plannerRoundTripsMs: number[];
  clientMetrics: AgentCommandResponse['state']['clientMetrics'] | null;
  failure?: string;
}> = [];

// Failed attempts must remain in the denominator, even if an assertion throws
// before the scenario can append its success measurements.
test.afterEach(() => {
  const info = test.info();
  const tracked: Record<string, string> = {
    'completes the real checkout with Rampart and the local Qwen backend': 'autonomous-checkout',
    'summarizes the real privacy proof without sending raw private values': 'privacy-proof-summary',
    'completes general dropdown, checkbox, and radio controls with real Qwen': 'general-form-controls',
  };
  const scenario = tracked[info.title];
  if (scenario && info.status !== 'passed' && info.status !== 'skipped') {
    liveResults.push({ scenario, completed: false, endToEndMs: info.duration, privacyMs: null, plannerRoundTripsMs: [], clientMetrics: null, failure: info.error?.message ?? info.status });
  }
});

function captureContextShieldErrors(context: BrowserContext): void {
  const attach = (source: Page | Worker) => {
    source.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && /ContextShield|Rampart|Visual/.test(text)) {
        console.error(text);
      }
    });
  };
  for (const page of context.pages()) attach(page);
  for (const worker of context.serviceWorkers()) attach(worker);
  context.on('page', attach);
  context.on('serviceworker', attach);
}

function plannerRoundTrips(reply: AgentCommandResponse): number[] {
  const values: number[] = [];
  let startedAt: number | undefined;
  for (const entry of reply.state.timeline) {
    if (entry.message === 'Sending sanitized context and planning next action') {
      startedAt = entry.at;
    } else if (entry.message === 'Server returned a structured action' && startedAt) {
      values.push(entry.at - startedAt);
      startedAt = undefined;
    }
  }
  return values;
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower];
  const upperValue = sorted[upper] ?? lowerValue;
  if (lowerValue === undefined || upperValue === undefined) return null;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

test.afterAll(async () => {
  if (liveResults.length === 0) return;
  const completed = liveResults.filter((result) => result.completed).length;
  const endToEnd = liveResults.filter((result) => result.completed).map((result) => result.endToEndMs);
  const planner = liveResults.flatMap((result) => result.plannerRoundTripsMs);
  const privacy = liveResults
    .map((result) => result.privacyMs)
    .filter((value): value is number => value !== null);
  const stageValues = (
    key: keyof AgentCommandResponse['state']['clientMetrics'],
  ) => liveResults.flatMap((result) => result.clientMetrics ? [result.clientMetrics[key]] : []);
  const latencyByMode = Object.fromEntries(['local_only', 'server_assisted'].map((mode) => {
    const group = liveResults.filter((result) => (result.scenario === 'autonomous-checkout' ? 'server_assisted' : 'local_only') === mode);
    const successful = group.filter((result) => result.completed);
    return [mode, { attempted: group.length, completed: successful.length,
      task_ms_median: percentile(successful.flatMap((result) => result.clientMetrics ? [result.clientMetrics.totalMs] : []), .5),
      task_ms_p95: percentile(successful.flatMap((result) => result.clientMetrics ? [result.clientMetrics.totalMs] : []), .95),
      scope: 'Successful task timers only; failures retained in attempts. Cold client models, warm server; automated confirmation.' }];
  }));
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    model_backend: 'Qwen3-VL-4B-Instruct via local llama.cpp',
    scenarios: liveResults,
    task_completion: {
      completed,
      attempted: liveResults.length,
      rate: completed / liveResults.length,
    },
    performance: {
      latency_by_mode: latencyByMode,
      scope: 'Legacy end_to_end fields include browser setup and assertions and mix modes. Use latency_by_mode for task timings. Planner round trips include deterministic server transitions, NOT isolated model inference.',
      end_to_end_task_latency_ms_median: percentile(endToEnd, 0.5),
      end_to_end_task_latency_ms_p95: percentile(endToEnd, 0.95),
      planner_round_trip_latency_ms_median: percentile(planner, 0.5),
      planner_round_trip_latency_ms_p95: percentile(planner, 0.95),
      final_privacy_pass_latency_ms_median: percentile(privacy, 0.5),
      client_stages_ms_median: {
        model_initialization: percentile(stageValues('modelInitializationMs'), 0.5),
        observation: percentile(stageValues('observationMs'), 0.5),
        screenshot_capture: percentile(stageValues('screenshotCaptureMs'), 0.5),
        visual_inference_and_redaction: percentile(
          stageValues('visualInferenceAndRedactionMs'),
          0.5,
        ),
        privacy_classification: percentile(stageValues('privacyClassificationMs'), 0.5),
        local_planning: percentile(stageValues('localPlanningMs'), 0.5),
        server_planning: percentile(stageValues('serverPlanningMs'), 0.5),
        action_execution: percentile(stageValues('actionExecutionMs'), 0.5),
        verification: percentile(stageValues('verificationMs'), 0.5),
      },
      pixel_records_median: percentile(stageValues('pixelRecords'), 0.5),
    },
  };
  await mkdir(resolve('../benchmarks/results'), { recursive: true });
  await writeFile(
    resolve('../benchmarks/results/live-product.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
});

test('completes the real checkout with Rampart and the local Qwen backend', async () => {
  test.skip(
    process.env.CONTEXTSHIELD_E2E_LIVE !== '1',
    'Opt-in smoke test requires the locally running ContextShield stack',
  );
  test.setTimeout(300_000);
  const benchmarkStarted = performance.now();

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  captureContextShieldErrors(context);

  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).hostname;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator('.vault > summary').click();
    await popup.getByLabel('Secret value').fill('private@example.com');
    await popup.getByRole('button', { name: 'Add' }).click();
    await popup.getByLabel('What should the agent do?').fill(
      'Choose the cheapest morning fare, fill my email, continue, and place the order.',
    );

    const target = await context.newPage();
    await target.goto('http://127.0.0.1:4173/checkout.html');
    await target.bringToFront();
    await popup
      .getByRole('button', { name: 'Start agent' })
      .evaluate((button: HTMLButtonElement) => button.click());

    const deadline = Date.now() + 280_000;
    while (Date.now() < deadline) {
      const state: AgentCommandResponse = await popup.evaluate(() =>
        browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
      );
      if (state.state.phase === 'COMPLETE') break;
      if (state.state.phase === 'FAILED') {
        throw new Error(`Live extension failed: ${state.state.error}`);
      }
      const allow = popup.getByRole('button', { name: 'Allow once' });
      if (await allow.isVisible().catch(() => false)) {
        await allow.evaluate((button: HTMLButtonElement) => button.click());
      }
      await popup.waitForTimeout(500);
    }

    await expect(popup.locator('.success-result')).toContainText('Task complete');
    await expect(target.locator('#email')).toHaveValue('private@example.com');
    await expect(target.locator('#fare')).toHaveValue('₹899 · Saver · 09:15');
    await expect(target.locator('#done')).toBeVisible();
    await popup.locator('.activity-details > summary').click();
    await expect(popup.getByText('Rampart ONNX contextual PII model ready')).toBeVisible();
    await expect(popup.getByText('Server returned a structured action').first()).toBeVisible();
    const finalReply: AgentCommandResponse = await popup.evaluate(() =>
      browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
    );
    liveResults.push({
      scenario: 'autonomous-checkout',
      completed: true,
      endToEndMs: performance.now() - benchmarkStarted,
      privacyMs: finalReply.state.localProcessingMs,
      plannerRoundTripsMs: plannerRoundTrips(finalReply),
      clientMetrics: finalReply.state.clientMetrics,
    });
  } finally {
    await context.close();
  }
});

test('summarizes the real privacy proof without sending raw private values', async () => {
  test.skip(
    process.env.CONTEXTSHIELD_E2E_LIVE !== '1',
    'Opt-in smoke test requires the locally running ContextShield stack',
  );
  test.setTimeout(180_000);
  const benchmarkStarted = performance.now();

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  captureContextShieldErrors(context);

  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).hostname;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByLabel('What should the agent do?').fill(
      'Summarize what is safe on this page.',
    );

    const target = await context.newPage();
    await target.goto('http://127.0.0.1:4173/privacy-proof.html');
    await target.bringToFront();
    await popup
      .getByRole('button', { name: 'Start agent' })
      .evaluate((button: HTMLButtonElement) => button.click());

    await expect
      .poll(
        async () => {
          const reply: AgentCommandResponse = await popup.evaluate(() =>
            browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
          );
          if (reply.state.phase === 'FAILED') {
            throw new Error(`Privacy proof failed: ${reply.state.error}`);
          }
          return reply.state.phase;
        },
        { timeout: 160_000 },
      )
      .toBe('COMPLETE');

    const reply: AgentCommandResponse = await popup.evaluate(() =>
      browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
    );
    expect(reply.state.serverPreview).not.toContain('privacy.fixture@example.com');
    expect(reply.state.serverPreview).not.toContain('+91 98765-43210');
    expect(reply.state.serverPreview).not.toContain('private.user@oksbi');
    expect(reply.state.serverPreview).not.toContain('NeverSendThis!');
    expect(reply.state.privacySummary.EMAIL).toBeGreaterThanOrEqual(1);
    expect(reply.state.privacySummary.PASSWORD).toBeGreaterThanOrEqual(1);
    expect(reply.state.privacySummary.FACE).toBeGreaterThanOrEqual(1);
    await expect(popup.locator('.success-result')).toContainText('Task complete');
    await popup.locator('.activity-details > summary').click();
    await expect(popup.getByText('Visual privacy scan complete')).toBeVisible();
    liveResults.push({
      scenario: 'privacy-proof-summary',
      completed: true,
      endToEndMs: performance.now() - benchmarkStarted,
      privacyMs: reply.state.localProcessingMs,
      plannerRoundTripsMs: plannerRoundTrips(reply),
      clientMetrics: reply.state.clientMetrics,
    });
  } finally {
    await context.close();
  }
});

test('stops the real mutation demo on the first stale action', async () => {
  test.skip(
    process.env.CONTEXTSHIELD_E2E_LIVE !== '1',
    'Opt-in smoke test requires the locally running ContextShield stack',
  );
  test.setTimeout(180_000);

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  captureContextShieldErrors(context);

  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).hostname;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByLabel('What should the agent do?').fill(
      'Click Arm stale-state mutation, then click Continue to finish task.',
    );

    const target = await context.newPage();
    await target.goto('http://127.0.0.1:4173/fail-closed.html');
    await target.bringToFront();
    const startedAt = performance.now();
    await popup
      .getByRole('button', { name: 'Start agent' })
      .evaluate((button: HTMLButtonElement) => button.click());

    await expect
      .poll(
        async () => {
          const reply: AgentCommandResponse = await popup.evaluate(() =>
            browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
          );
          if (reply.state.phase === 'COMPLETE') {
            throw new Error(`Mutation demo completed unexpectedly: ${reply.state.resultSummary}`);
          }
          return reply.state.phase;
        },
        { timeout: 120_000 },
      )
      .toBe('FAILED');

    const reply: AgentCommandResponse = await popup.evaluate(() =>
      browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
    );
    expect(reply.state.error).toBe(
      'Page changed after planning; the stale action was blocked.',
    );
    expect(reply.state.error).not.toContain('step limit');
    expect(
      reply.state.timeline.filter((entry) => entry.message === 'Reading page locally'),
    ).toHaveLength(2);
    expect(performance.now() - startedAt).toBeLessThan(120_000);
    await expect(target.locator('#status')).toContainText('Old element IDs are stale');
  } finally {
    await context.close();
  }
});

test('completes general dropdown, checkbox, and radio controls with real Qwen', async () => {
  test.skip(
    process.env.CONTEXTSHIELD_E2E_LIVE !== '1',
    'Opt-in smoke test requires the locally running ContextShield stack',
  );
  test.setTimeout(300_000);
  const benchmarkStarted = performance.now();

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  captureContextShieldErrors(context);

  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).hostname;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByLabel('What should the agent do?').fill(
      'Select Python from the first dropdown, select Option 2, select the Blue radio button, and stop.',
    );

    const target = await context.newPage();
    await target.goto('http://127.0.0.1:4173/general-controls.html');
    await target.bringToFront();
    await popup.getByRole('button', { name: 'Start agent' }).evaluate((button: HTMLButtonElement) => button.click());

    await expect.poll(async () => {
      const reply: AgentCommandResponse = await popup.evaluate(() =>
        browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
      );
      if (reply.state.pendingConfirmation?.kind === 'CLARIFICATION') {
        throw new Error(`Unexpected clarification: ${reply.state.pendingConfirmation.prompt}`);
      }
      if (reply.state.phase === 'FAILED') throw new Error(reply.state.error ?? 'Agent failed');
      return reply.state.phase;
    }, { timeout: 280_000 }).toBe('COMPLETE');

    await expect(target.locator('#language')).toHaveValue('Python');
    await expect(target.locator('#option-2')).toBeChecked();
    await expect(target.locator('#blue')).toBeChecked();
    await expect(target.locator('#control-status')).toHaveText('All requested controls are selected.');
    const reply: AgentCommandResponse = await popup.evaluate(() =>
      browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
    );
    expect(reply.state.serverPreview).toContain('"selected_option": "Python"');
    expect(reply.state.serverPreview).toContain('"control_value": "option-2"');
    expect(reply.state.serverPreview).toContain('"control_value": "blue"');
    liveResults.push({
      scenario: 'general-form-controls',
      completed: true,
      endToEndMs: performance.now() - benchmarkStarted,
      privacyMs: reply.state.localProcessingMs,
      plannerRoundTripsMs: plannerRoundTrips(reply),
      clientMetrics: reply.state.clientMetrics,
    });
  } finally {
    await context.close();
  }
});

test('completes the reported WebDriver University form with real Qwen', async () => {
  test.skip(
    process.env.CONTEXTSHIELD_E2E_EXTERNAL !== '1',
    'Opt-in external regression depends on WebDriver University availability',
  );
  test.setTimeout(300_000);
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  captureContextShieldErrors(context);
  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).hostname;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByLabel('What should the agent do?').fill(
      'Select Python from the first dropdown, select Option 2, select the Blue radio button, and stop.',
    );
    const target = await context.newPage();
    await target.goto('https://webdriveruniversity.com/Dropdown-Checkboxes-RadioButtons/index.html');
    await target.bringToFront();
    await popup.getByRole('button', { name: 'Start agent' }).evaluate((button: HTMLButtonElement) => button.click());

    await expect.poll(async () => {
      const reply: AgentCommandResponse = await popup.evaluate(() =>
        browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
      );
      if (reply.state.pendingConfirmation?.kind === 'CLARIFICATION') {
        throw new Error(`Unexpected clarification: ${reply.state.pendingConfirmation.prompt}`);
      }
      if (reply.state.phase === 'FAILED') throw new Error(reply.state.error ?? 'Agent failed');
      return reply.state.phase;
    }, { timeout: 280_000 }).toBe('COMPLETE');

    await expect(target.locator('#dropdowm-menu-1')).toHaveValue('python');
    await expect(target.locator('input[type="checkbox"][value="option-2"]')).toBeChecked();
    await expect(target.locator('input[type="radio"][name="color"][value="blue"]')).toBeChecked();
  } finally {
    await context.close();
  }
});

test('fills the reported DemoQA practice form and obeys do not submit', async () => {
  test.skip(
    process.env.CONTEXTSHIELD_E2E_EXTERNAL !== '1',
    'Opt-in external regression depends on demoqa.com availability',
  );
  test.setTimeout(300_000);
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  captureContextShieldErrors(context);
  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).hostname;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByLabel('What should the agent do?').fill(
      'Fill the form with test information: first name Context, last name Shield, email fixture@example.invalid, gender Male, mobile 9000000001, and address Fixture Kolkata. Do not submit it.',
    );
    const target = await context.newPage();
    await target.goto('https://demoqa.com/automation-practice-form');
    await target.bringToFront();
    await popup.getByRole('button', { name: 'Start agent' }).evaluate(
      (button: HTMLButtonElement) => button.click(),
    );

    await expect.poll(async () => {
      const reply: AgentCommandResponse = await popup.evaluate(() =>
        browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
      );
      if (reply.state.pendingConfirmation?.kind === 'CLARIFICATION') {
        throw new Error(`Unexpected clarification: ${reply.state.pendingConfirmation.prompt}`);
      }
      if (reply.state.pendingConfirmation?.kind === 'CONFIRMATION') {
        throw new Error('The forbidden Submit button was proposed');
      }
      if (reply.state.phase === 'FAILED') throw new Error(reply.state.error ?? 'Agent failed');
      return reply.state.phase;
    }, { timeout: 280_000 }).toBe('COMPLETE');

    await expect(target.locator('#firstName')).toHaveValue('Context');
    await expect(target.locator('#lastName')).toHaveValue('Shield');
    await expect(target.locator('#userEmail')).toHaveValue('fixture@example.invalid');
    await expect(target.locator('#gender-radio-1')).toBeChecked();
    await expect(target.locator('#userNumber')).toHaveValue('9000000001');
    await expect(target.locator('#currentAddress')).toHaveValue('Fixture Kolkata');
    await expect(target.locator('#hobbies-checkbox-1')).not.toBeChecked();
    await expect(target.locator('#hobbies-checkbox-2')).not.toBeChecked();
    await expect(target.locator('#hobbies-checkbox-3')).not.toBeChecked();
    await expect(target.locator('.modal-content')).toHaveCount(0);

    const reply: AgentCommandResponse = await popup.evaluate(() =>
      browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
    );
    expect(reply.state.serverPreview).toContain('LOCAL_GIVEN_NAME_1');
    expect(reply.state.serverPreview).toContain('LOCAL_SURNAME_1');
    expect(reply.state.serverPreview).toContain('LOCAL_ADDRESS_1');
    expect(reply.state.serverPreview).not.toContain('Context');
    expect(reply.state.serverPreview).not.toContain('fixture@example.invalid');
    expect(reply.state.serverPreview).not.toContain('Fixture Kolkata');
    expect(reply.state.resultSummary).not.toMatch(/cannot|no actionable|failed/i);
  } finally {
    await context.close();
  }
});

test('submits the completed DemoQA form after local confirmation and verifies the delayed modal', async () => {
  test.skip(
    process.env.CONTEXTSHIELD_E2E_EXTERNAL !== '1',
    'Opt-in external regression depends on demoqa.com availability',
  );
  test.setTimeout(300_000);
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  captureContextShieldErrors(context);
  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).hostname;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByLabel('What should the agent do?').fill(
      'Fill first name Context, last name Shield, email fixture@example.com, gender Male, mobile 9000000001, and current address Fixture Kolkata. Then click Submit.',
    );
    const target = await context.newPage();
    await target.goto('https://demoqa.com/automation-practice-form');
    await target.bringToFront();
    await popup.getByRole('button', { name: 'Start agent' }).evaluate(
      (button: HTMLButtonElement) => button.click(),
    );

    let confirmationSent = false;
    await expect.poll(async () => {
      const reply: AgentCommandResponse = await popup.evaluate(() =>
        browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
      );
      const pending = reply.state.pendingConfirmation;
      if (pending?.kind === 'CLARIFICATION') {
        throw new Error(`Unexpected clarification: ${pending.prompt}`);
      }
      if (pending?.kind === 'CONFIRMATION' && !confirmationSent) {
        confirmationSent = true;
        await popup.evaluate((actionId) =>
          browser.runtime.sendMessage({
            type: 'CONFIRM_ACTION',
            actionId,
            confirmed: true,
          }), pending.action.action_id);
      }
      if (reply.state.phase === 'FAILED') throw new Error(reply.state.error ?? 'Agent failed');
      return reply.state.phase;
    }, { timeout: 280_000 }).toBe('COMPLETE');

    expect(confirmationSent).toBe(true);
    await expect(target.locator('.modal-content')).toBeVisible();
    await expect(target.locator('#example-modal-sizes-title-lg')).toContainText(
      'Thanks for submitting the form',
    );
  } finally {
    await context.close();
  }
});

test('completes the reported Herokuapp ordinal checkbox task with real Qwen', async () => {
  test.skip(
    process.env.CONTEXTSHIELD_E2E_EXTERNAL !== '1',
    'Opt-in external regression depends on the-internet.herokuapp.com availability',
  );
  test.setTimeout(300_000);
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  captureContextShieldErrors(context);
  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).hostname;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByLabel('What should the agent do?').fill(
      'Select the first checkbox and clear the second checkbox.',
    );
    const target = await context.newPage();
    await target.goto('https://the-internet.herokuapp.com/checkboxes');
    await target.bringToFront();
    await popup.getByRole('button', { name: 'Start agent' }).evaluate(
      (button: HTMLButtonElement) => button.click(),
    );

    await expect.poll(async () => {
      const reply: AgentCommandResponse = await popup.evaluate(() =>
        browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
      );
      if (reply.state.pendingConfirmation?.kind === 'CLARIFICATION') {
        throw new Error(`Unexpected clarification: ${reply.state.pendingConfirmation.prompt}`);
      }
      if (reply.state.phase === 'FAILED') throw new Error(reply.state.error ?? 'Agent failed');
      return reply.state.phase;
    }, { timeout: 280_000 }).toBe('COMPLETE');

    const checkboxes = target.locator('input[type="checkbox"]');
    await expect(checkboxes.nth(0)).toBeChecked();
    await expect(checkboxes.nth(1)).not.toBeChecked();
    const reply: AgentCommandResponse = await popup.evaluate(() =>
      browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
    );
    expect(reply.state.serverPreview).toContain('"label": "checkbox 1"');
    expect(reply.state.serverPreview).toContain('"label": "checkbox 2"');
    expect(reply.state.resultSummary).not.toMatch(/cannot|no actionable|failed/i);
  } finally {
    await context.close();
  }
});

test('completes the Selenium official generic web form without submitting', async () => {
  test.skip(
    process.env.CONTEXTSHIELD_E2E_EXTERNAL !== '1',
    'Opt-in external regression depends on selenium.dev availability',
  );
  test.setTimeout(300_000);
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  captureContextShieldErrors(context);
  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).hostname;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByLabel('What should the agent do?').fill(
      'Fill the Text input with ContextShield public test, select Two from the Dropdown, check the Default checkbox, and do not submit.',
    );
    const target = await context.newPage();
    await target.goto('https://www.selenium.dev/selenium/web/web-form.html');
    await target.bringToFront();
    await popup.getByRole('button', { name: 'Start agent' }).evaluate(
      (button: HTMLButtonElement) => button.click(),
    );

    await expect.poll(async () => {
      const reply: AgentCommandResponse = await popup.evaluate(() =>
        browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }),
      );
      if (reply.state.pendingConfirmation) {
        throw new Error(`Unexpected user gate: ${reply.state.pendingConfirmation.prompt}`);
      }
      if (reply.state.phase === 'FAILED') throw new Error(reply.state.error ?? 'Agent failed');
      return reply.state.phase;
    }, { timeout: 280_000 }).toBe('COMPLETE');

    await expect(target.getByLabel('Text input')).toHaveValue('ContextShield public test');
    await expect(target.getByLabel('Dropdown (select)')).toHaveValue('2');
    await expect(target.getByLabel('Default checkbox')).toBeChecked();
    await expect(target).toHaveURL('https://www.selenium.dev/selenium/web/web-form.html');
  } finally {
    await context.close();
  }
});
