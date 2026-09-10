import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpus, platform, totalmem } from 'node:os';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { SanitizedContextSchema } from '@contextshield/shared';
import type { AgentCommandResponse } from '../lib/messaging/protocol';

// Fixed synthetic regression corpus. Labels are authored independently of model
// output, but this is NOT a held-out, human-reviewed population benchmark.
const cases = [
  { id: 'labelled-profile', body: '<p>Name: Mira Sen</p><p>Email: mira.sen@example.invalid</p><p>Mobile: +91 90000-00001</p><label>Password<input type="password" value="AuditSecret42!"></label>', secrets: ['Mira Sen', 'mira.sen@example.invalid', '+91 90000-00001', 'AuditSecret42!'], types: ['PERSON_NAME', 'EMAIL', 'PHONE', 'PASSWORD'] },
  { id: 'narrative-name', body: '<p>Please deliver the parcel to Amelia Carter tomorrow.</p>', secrets: ['Amelia Carter'], types: ['PERSON_NAME'] },
  { id: 'two-emails', body: '<p>Email: ada@example.invalid</p><p>Email: ravi@example.invalid</p>', secrets: ['ada@example.invalid', 'ravi@example.invalid'], types: ['EMAIL'] },
  { id: 'payment-reference', body: '<p>UPI: fixture.audit@oksbi</p><p>PAN: ABCDE1234F</p>', secrets: ['fixture.audit@oksbi', 'ABCDE1234F'], types: ['UPI_ID', 'PAN'] },
  { id: 'public-controls', body: '<label>Language<select><option>Python</option><option>JAVA</option></select></label><label><input type="checkbox">Option 2</label><label><input type="radio">Blue</label>', secrets: [], types: [] },
  { id: 'public-prices', body: '<p>Notebook costs ₹899. Delivery takes 3 days.</p><button>View product</button>', secrets: [], types: [] },
  { id: 'canvas-email', canvas: 'Email: pixel.audit@example.invalid', body: '', secrets: ['pixel.audit@example.invalid'], types: ['EMAIL'] },
  { id: 'canvas-narrative', canvas: 'Deliver to Amelia Carter tomorrow', body: '', secrets: ['Amelia Carter'], types: ['PERSON_NAME'] },
  { id: 'portrait-large', face: 320, body: '', secrets: [], types: ['FACE'] },
  { id: 'portrait-small', face: 160, body: '', secrets: [], types: ['FACE'] },
  { id: 'filled-name-input', body: '<label>First name<input type="text" value="Context"></label><label>Last name<input type="text" value="Shield"></label>', secrets: ['Context', 'Shield'], types: ['PERSON_NAME'] },
] satisfies Array<{ id: string; body: string; secrets: string[]; types: string[]; canvas?: string; face?: number }>;

const exec = promisify(execFile);
type Sample = { rssBytes: number; cpuPercent: number; gpuProcessRssBytes: number };
async function sample(marker: string): Promise<Sample | null> {
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,command=']);
  const rows = stdout.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line);
    return m?.[5] ? [{ pid: Number(m[1]), ppid: Number(m[2]), cpu: Number(m[3]), rss: Number(m[4]) * 1024, command: m[5] }] : [];
  });
  const root = rows.find((r) => r.command.includes(`--contextshield-audit=${marker}`) && !r.command.includes('--type='));
  if (!root) return null;
  const ids = new Set([root.pid]);
  for (let old = 0; old !== ids.size;) { old = ids.size; for (const r of rows) if (ids.has(r.ppid)) ids.add(r.pid); }
  const processes = rows.filter((r) => ids.has(r.pid));
  return { rssBytes: processes.reduce((n, r) => n + r.rss, 0), cpuPercent: processes.reduce((n, r) => n + r.cpu, 0), gpuProcessRssBytes: processes.filter((r) => r.command.includes('--type=gpu-process')).reduce((n, r) => n + r.rss, 0) };
}

function resourceSummary(samples: Sample[]) {
  return { samples: samples.length, peakRssBytes: samples.length ? Math.max(...samples.map((s) => s.rssBytes)) : null, averageProcessLifetimeCpuPercent: samples.length ? samples.reduce((n, s) => n + s.cpuPercent, 0) / samples.length : null, peakGpuProcessRssBytes: samples.length ? Math.max(...samples.map((s) => s.gpuProcessRssBytes)) : null };
}

test('fresh real-model privacy corpus and paired browser resource measurement', async () => {
  test.skip(process.env.CONTEXTSHIELD_E2E_AUDIT !== '1', 'Opt-in real-model audit');
  test.setTimeout(240_000);
  const portrait = await readFile(resolve('../demo/assets/fictional-profile.png'));
  const server = createServer((req, res) => {
    if (req.url === '/portrait.png') { res.writeHead(200, { 'content-type': 'image/png' }).end(portrait); return; }
    const c = cases.find((entry) => req.url === `/${entry.id}`);
    if (!c) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><style>body{font:24px Arial;margin:24px;background:white;color:#222}p{margin:18px 0}canvas,img{display:block}input,select,button{font:inherit}</style><main>${c.body}${c.face ? `<img src="/portrait.png" width="${c.face}" height="${c.face * 658 / 720}">` : ''}${c.canvas ? `<canvas width="640" height="120"></canvas><script>const x=document.querySelector('canvas').getContext('2d');x.fillStyle='white';x.fillRect(0,0,640,120);x.fillStyle='#222';x.font='26px Arial';x.fillText(${JSON.stringify(c.canvas)},20,65);</script>` : ''}</main>`);
  });
  await new Promise<void>((r) => server.listen(4182, '127.0.0.1', r));
  const rows: Array<Record<string, unknown>> = [];
  const baselineSamples: Sample[] = [];
  const activeSamples: Sample[] = [];
  const output = resolve('../benchmarks/results/fresh-audit.json');
  let current: BrowserContext | undefined;
  try {
    current = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, viewport: { width: 1200, height: 800 }, args: ['--contextshield-audit=baseline'] });
    const baseline = await current.newPage();
    for (const c of cases) {
      await baseline.goto(`http://127.0.0.1:4182/${c.id}`);
      await baseline.screenshot();
      const reading = await sample('baseline'); if (reading) baselineSamples.push(reading);
    }
    await current.close();
    const path = resolve(process.env.CONTEXTSHIELD_EXTENSION_DIR ?? '.output/chrome-mv3');
    current = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, viewport: { width: 1200, height: 800 }, args: ['--contextshield-audit=active', `--disable-extensions-except=${path}`, `--load-extension=${path}`] });
    let [worker] = current.serviceWorkers(); worker ??= await current.waitForEvent('serviceworker');
    const popup = await current.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup.html`);
    const target = await current.newPage();
    for (const [index, c] of cases.entries()) {
      const start = Date.now();
      const row: Record<string, unknown> = { id: c.id, coldClientModels: index === 0, expectedTypes: c.types, expectedSecretCount: c.secrets.length };
      rows.push(row);
      try {
        await target.goto(`http://127.0.0.1:4182/${c.id}`);
        await target.bringToFront();
        const screenshot = await target.screenshot();
        const secretSpan = c.canvas ? await target.evaluate(({ text, secret }) => {
          const ctx = document.querySelector('canvas')?.getContext('2d');
          if (!ctx || !secret) throw new Error('Missing authored canvas annotation');
          const index = text.indexOf(secret);
          if (index < 0) throw new Error('Secret annotation does not match rendered text');
          return { left: 20 + ctx.measureText(text.slice(0, index)).width, right: 20 + ctx.measureText(text.slice(0, index + secret.length)).width };
        }, { text: c.canvas, secret: c.secrets[0] }) : null;
        await popup.evaluate(() => browser.runtime.sendMessage({ type: 'START_AGENT', task: 'Summarize what is safe on this page without exposing personal or sensitive information.' }));
        await expect.poll(async () => {
          const reading = await sample('active'); if (reading) activeSamples.push(reading);
          const reply: AgentCommandResponse = await popup.evaluate(() => browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }));
          return ['COMPLETE', 'FAILED', 'STOPPED', 'WAITING_CONFIRMATION'].includes(reply.state.phase);
        }, { timeout: 60_000, intervals: [200, 500] }).toBe(true);
        const { state }: AgentCommandResponse = await popup.evaluate(() => browser.runtime.sendMessage({ type: 'GET_AGENT_STATE' }));
        row.phase = state.phase; row.error = state.error; row.metrics = state.clientMetrics;
        const preview = state.proofPreview ? SanitizedContextSchema.parse(JSON.parse(state.proofPreview)) : null;
        row.predictedTypes = Object.keys(preview?.privacy_summary ?? {});
        row.leakedSecrets = c.secrets.filter((secret) => JSON.stringify(preview).includes(secret));
        row.evidence = state.proofEvidence;
        row.contextRequests = state.contextDelivery?.requests ?? 0;
        row.pixelRecords = state.clientMetrics.pixelRecords;
        // Decode the actual sanitized PNG. Ground truth is the authored text
        // region or an explicitly approximate rectangle of the single portrait.
        if ((c.face || c.canvas) && preview) {
          const crops = preview.safe_visual_crops;
          row.cropCount = crops.length;
          if (crops[0]) {
            row.pixels = await popup.evaluate(async ({ crop, original, face, secretSpan }) => {
              async function raster(url: string) { const img = new Image(); img.src = url; await img.decode(); const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const ctx = cv.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable'); ctx.drawImage(img, 0, 0); return { ctx, width: img.width, height: img.height }; }
              const safe = await raster(`data:${crop.mime_type};base64,${crop.data_base64}`);
              const raw = await raster(`data:image/png;base64,${original}`);
              const a = safe.ctx.getImageData(0, 0, safe.width, safe.height).data;
              const b = raw.ctx.getImageData(24, 24, safe.width, safe.height).data;
              let expected = 0, covered = 0, masked = 0, unrelatedMasked = 0;
              for (let y = 0; y < safe.height; y++) for (let x = 0; x < safe.width; x++) {
                const i = (y * safe.width + x) * 4;
                const black = a[i] === 0 && a[i + 1] === 0 && a[i + 2] === 0 && a[i + 3] === 255;
                // The face box is an approximate manually inspected annotation,
                // not a reviewed face dataset. Text uses actual dark glyph pixels.
                const sensitive = face ? x >= safe.width * .30 && x < safe.width * .69 && y >= safe.height * .22 && y < safe.height * .72 : secretSpan !== null && x >= Math.floor(secretSpan.left) && x <= Math.ceil(secretSpan.right) && y >= 40 && y <= 70 && (b[i] ?? 255) < 150 && (b[i + 1] ?? 255) < 150 && (b[i + 2] ?? 255) < 150;
                if (sensitive) { expected++; if (black) covered++; }
                if (black) { masked++; if (!sensitive) unrelatedMasked++; }
              }
              return { expectedPixels: expected, coveredPixels: covered, coverage: expected ? covered / expected : null, maskedPixels: masked, unrelatedMaskedPixels: unrelatedMasked, maskedImageFraction: masked / (safe.width * safe.height), annotation: face ? 'approximate face box on one synthetic portrait' : 'known secret glyph pixels bounded by Canvas measureText; public prefix/suffix excluded' };
            }, { crop: crops[0], original: screenshot.toString('base64'), face: !!c.face, secretSpan });
          }
        }
      } catch (error) { row.error = String(error); row.phase = 'TEST_ERROR'; await popup.evaluate(() => browser.runtime.sendMessage({ type: 'STOP_AGENT' })); }
      row.wallMs = Date.now() - start;
      console.log(JSON.stringify(row));
    }
  } finally {
    await current?.close(); await new Promise<void>((r) => server.close(() => r()));
    let tp = 0, fp = 0, fn = 0;
    for (const row of rows) {
      const expected = new Set(row.expectedTypes as string[]); const predicted = new Set((row.predictedTypes ?? []) as string[]);
      for (const type of expected) { if (predicted.has(type)) tp++; else fn++; }
      for (const type of predicted) if (!expected.has(type)) fp++;
    }
    const baseline = resourceSummary(baselineSamples); const active = resourceSummary(activeSamples);
    await mkdir(resolve('../benchmarks/results'), { recursive: true });
    await writeFile(output, JSON.stringify({
      generatedAt: new Date().toISOString(), schemaVersion: 1,
      scope: `${cases.length} authored synthetic pages, real browser DOM/YOLOX/OCR/Rampart, local summary controller; type-level scoring, not entity/span precision; not held-out after fixes`,
      environment: { platform: platform(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, hostMemoryBytes: totalmem() },
      attempted: rows.length, completed: rows.filter((r) => r.phase === 'COMPLETE').length,
      typeLevelDetection: { tp, fp, fn, precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn) },
      resources: { baseline, active,
        differenceOfObservedPeaksBytes: baseline.peakRssBytes && active.peakRssBytes ? active.peakRssBytes - baseline.peakRssBytes : null,
        scope: 'Browser process tree. Baseline renders same pages; active includes extension popup and local inference. Difference of observed peaks is NOT isolated extension allocation. CPU is ps process-lifetime average; GPU process RSS is NOT VRAM.' },
      rows,
    }, null, 2) + '\n');
  }
  expect(rows).toHaveLength(cases.length);
  expect(rows.filter((r) => r.phase !== 'COMPLETE')).toEqual([]);
  expect(rows.filter((r) => (r.leakedSecrets as string[]).length)).toEqual([]);
  expect(rows.filter((r) => /^(canvas|portrait)-/.test(r.id as string) && r.cropCount !== 1)).toEqual([]);
  expect(rows.filter((r) => r.pixels && (r.pixels as { coverage: number }).coverage < 1)).toEqual([]);
});
