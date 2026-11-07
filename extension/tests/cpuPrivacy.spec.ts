import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium, expect, test } from '@playwright/test';

test('runs packaged PII, OCR and face models without a GPU under the extension CSP', async () => {
  test.setTimeout(150_000);
  const build = resolve('.output/chrome-mv3');
  const assets = await readdir(`${build}/assets`);
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--load-extension=${build}`,
      `--disable-extensions-except=${build}`,
      '--disable-webgpu',
      '--disable-gpu',
    ],
  });

  try {
    const serviceWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(serviceWorker.url()).hostname}/popup.html`);
    const hasAdapter = await page.evaluate(async () => {
      const gpu = (navigator as {
        gpu?: { requestAdapter(): Promise<unknown> };
      }).gpu;
      return Boolean(await gpu?.requestAdapter());
    });
    expect(hasAdapter).toBe(false);

    for (const kind of ['pii', 'ocr', 'vision'] as const) {
      const file = assets.find((name) => name.startsWith(`${kind}.worker-`) && name.endsWith('.js'));
      expect(file, `packaged ${kind} worker`).toBeDefined();
      const result = await page.evaluate(async ({ kind, file }) => {
        const root = location.origin;
        const worker = new Worker(`${root}/assets/${file}`, { type: 'module' });
        type Reply = { ok: boolean; error?: string; protections?: Array<{ text: string }>; lines?: unknown[]; detections?: unknown[] };
        const request = (message: Record<string, unknown>) => new Promise<Reply>((resolveReply, reject) => {
          const timer = setTimeout(() => reject(new Error(`${kind} worker timed out`)), 45_000);
          worker.onmessage = (event: MessageEvent<Reply>) => {
            clearTimeout(timer);
            resolveReply(event.data);
          };
          worker.onerror = (event) => {
            clearTimeout(timer);
            reject(new Error(event.message));
          };
          worker.postMessage({ id: 'cpu-regression', ...message });
        });
        try {
          let initialization: Record<string, unknown> = { type: 'INITIALIZE', model: 'rampart' };
          if (kind === 'vision') initialization = {
            type: 'INITIALIZE', modelUrl: `${root}/models/yolox-face.onnx`, labels: ['FACE'], inputSize: 192,
          };
          if (kind === 'ocr') initialization = {
            type: 'INITIALIZE', detectorUrl: `${root}/models/ppocrv6-tiny-det.onnx`,
            recognizerUrl: `${root}/models/ppocrv6-tiny-rec.onnx`,
            dictionary: await (await fetch(`${root}/models/ppocrv6-tiny-dictionary.json`)).json(),
          };
          const initialized = await request(initialization);
          if (!initialized.ok) return initialized;
          if (kind === 'pii') return await request({ type: 'PROTECT', texts: ['My email is ada@example.com.'] });
          return await request({
            type: kind === 'ocr' ? 'RECOGNIZE' : 'DETECT',
            width: 64, height: 64, rgba: new Uint8ClampedArray(64 * 64 * 4).fill(255).buffer,
          });
        } finally {
          worker.terminate();
        }
      }, { kind, file });

      expect(result.ok, `${kind}: ${result.error ?? 'inference failed'}`).toBe(true);
      if (kind === 'pii') {
        expect(result.protections).toHaveLength(1);
        expect(result.protections?.[0]?.text).not.toContain('ada@example.com');
      } else if (kind === 'ocr') {
        expect(result.lines).toEqual([]);
      } else {
        expect(result.detections).toEqual([]);
      }
    }
  } finally {
    await context.close();
  }
});
