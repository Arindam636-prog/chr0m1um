import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { SanitizedContextSchema } from '@contextshield/shared';
import type { AgentCommandResponse } from '../lib/messaging/protocol';

// Freeze expectations before running. No page adapter or target-specific planner
// rule participates. These remain authored synthetic cases, not unseen websites.
const cases = [
  { index: 0, expected: 'B', values: [480, 215, 360], subject: 'prices', direction: 'lowest price' },
  { index: 1, expected: 'A', values: [135, 425, 280], subject: 'prices', direction: 'lowest price' },
  { index: 2, expected: 'C', values: [795, 645, 525], subject: 'prices', direction: 'lowest price' },
  { index: 3, expected: 'A', values: [42, 76, 58], subject: 'durations', direction: 'shortest duration' },
  { index: 4, expected: 'B', values: [91, 63, 78], subject: 'durations', direction: 'shortest duration' },
  { index: 5, expected: 'C', values: [86, 94, 57], subject: 'durations', direction: 'shortest duration' },
];

test('real visual-only comparisons with captured planner traffic', async () => {
  test.skip(process.env.CONTEXTSHIELD_E2E_VISUAL !== '1', 'Requires the real local Qwen stack');
  test.setTimeout(900_000);
  const output = resolve('../benchmarks/results/visual-decision');
  await mkdir(output, { recursive: true });
  const extension = resolve(process.env.CONTEXTSHIELD_EXTENSION_DIR ?? '.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, viewport: { width: 1200, height: 1100 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const rows: Array<Record<string, unknown>> = [];
  let payloads: string[] = [];
  context.on('request', (request) => {
    if (/\/v1\/agent\/(start|step)$/.test(request.url())) payloads.push(request.postData() ?? '');
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup.html`);
    const target = await context.newPage();
    for (const c of cases) {
      payloads = [];
      const row: Record<string, unknown> = { case: c.index, expected: c.expected, coldClientModels: c.index === 0, completed: false };
      rows.push(row);
      try {
        await target.goto(`http://127.0.0.1:4173/visual-board.html?case=${c.index}`);
        await target.bringToFront();
        await target.locator('#board').screenshot({ path: resolve(output, `case-${c.index}-original.png`) });
        const domText = await target.locator('body').innerText();
        row.valuesAbsentFromVisibleDom = c.values.every((value) => !new RegExp(`\\b${value}\\b`).test(domText));
        const task = `Compare the ${c.subject} shown on the visual board. Click the option with the ${c.direction}, then stop.`;
        const start = Date.now();
        await popup.evaluate((task) => browser.runtime.sendMessage({ type: 'START_AGENT', task }), task);
        let final: AgentCommandResponse | undefined;
        while (Date.now() - start < 130_000) {
          final = await popup.evaluate(() => browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }));
          if (!final?.state.running || final.state.pendingConfirmation) break;
          await new Promise((yes) => setTimeout(yes, 400));
        }
        row.wallMs = Date.now() - start;
        row.phase = final?.state.phase;
        row.error = final?.state.error;
        row.metrics = final?.state.clientMetrics;
        row.outcome = await target.locator('#outcome').innerText();
        row.correctChoice = row.outcome === `Selected option ${c.expected}. Selection complete.`;
        row.completed = row.correctChoice && row.phase === 'COMPLETE';
        row.plannerRequests = payloads.length;
        row.canaryAbsentFromCapturedRequests = payloads.length > 0 ? payloads.every((body) => !body.includes('visual.canary@example.invalid')) : null;
        // This is captured from actual browser requests, not the extension's
        // privacy preview. Scope: planning bodies only, not a full network audit.
        const bodies = payloads.map((body) => JSON.parse(body) as Record<string, unknown>);
        const first = bodies.map((body) => SanitizedContextSchema.safeParse(body.context ?? body)).find((value) => value.success);
        if (first?.success) {
          const visual = first.data.elements.filter((element) => element.sources?.includes('OCR'));
          row.ocrValuesRecognized = c.values.filter((value) => visual.some((element) => new RegExp(`\\b${value}\\b`).test(element.text ?? ''))).length;
          row.ocrRecordCount = visual.length;
          row.cropsOnWire = first.data.safe_visual_crops.length;
          const crop = first.data.safe_visual_crops[0];
          if (crop) await writeFile(resolve(output, `case-${c.index}-outgoing.png`), Buffer.from(crop.data_base64, 'base64'));
        }
        await writeFile(resolve(output, `case-${c.index}-requests.json`), JSON.stringify(bodies, null, 2) + '\n');
        await writeFile(resolve(output, `case-${c.index}-state.json`), JSON.stringify(final?.state, null, 2) + '\n');
        if (final?.state.running) await popup.evaluate(() => browser.runtime.sendMessage({ type: 'STOP_AGENT' }));
      } catch (error) {
        row.error = String(error);
        await popup.evaluate(() => browser.runtime.sendMessage({ type: 'STOP_AGENT' }));
      }
      console.log(JSON.stringify(row));
    }
  } finally {
    await context.close();
    await writeFile(resolve(output, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), scope: 'Six authored canvas cases. Real OCR, privacy pipeline, Qwen and DOM-grounded execution. One cold client then warm client runs. Same running server. No independent population or held-out claim.', fixtureSha256: createHash('sha256').update(await readFile(resolve('../demo/visual-board.js'))).digest('hex'), attempted: rows.length, completed: rows.filter((row) => row.completed).length, rows }, null, 2) + '\n');
  }
  expect(rows).toHaveLength(cases.length);
  expect(rows.filter((row) => !row.completed || !row.valuesAbsentFromVisibleDom || !row.canaryAbsentFromCapturedRequests || !row.cropsOnWire)).toEqual([]);
});
