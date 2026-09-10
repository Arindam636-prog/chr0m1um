import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpus, platform, release, totalmem } from 'node:os';

import { chromium, expect, test } from '@playwright/test';

import type { ContentResponse } from '../lib/messaging/protocol';

const PORT = 4180;
const execFileAsync = promisify(execFile);

const scenarios: Array<{ path: string; body: string; expected: string[] }> = [
  {
    path: '/buttons',
    body: '<button>Expected button</button><a href="#next">Expected link</a>',
    expected: ['Expected button', 'Expected link'],
  },
  {
    path: '/form',
    body: '<label>Expected email<input type="email"></label><label>Expected notes<textarea></textarea></label><label>Expected fare<select><option>One</option></select></label><button>Expected submit</button>',
    expected: ['Expected email', 'Expected notes', 'Expected fare', 'Expected submit'],
  },
  {
    path: '/table',
    body: '<table><tr><th>Item</th><th>Action</th></tr><tr><td>Train</td><td><a href="#view">Expected table link</a><button>Expected table button</button></td></tr></table>',
    expected: ['Expected table link', 'Expected table button'],
  },
  {
    path: '/dynamic',
    body: '<main id="app"></main><script>document.querySelector("#app").innerHTML = "<button>Expected dynamic button</button>"</script>',
    expected: ['Expected dynamic button'],
  },
  {
    path: '/images',
    body: '<a href="#gallery">Expected gallery link<img alt="Public gallery image" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></a>',
    expected: ['Expected gallery link'],
  },
  {
    path: '/canvas',
    body: '<canvas width="100" height="50"></canvas><button>Expected canvas action</button>',
    expected: ['Expected canvas action'],
  },
  {
    path: '/aria',
    body: '<div role="button" tabindex="0">Expected ARIA button</div><div role="switch" tabindex="0">Expected switch</div><div role="tab" tabindex="0">Expected tab</div><div role="menuitem" tabindex="0">Expected menu item</div>',
    expected: ['Expected ARIA button', 'Expected switch', 'Expected tab', 'Expected menu item'],
  },
  {
    path: '/details',
    body: '<details><summary>Expected details toggle</summary><p>Details</p></details>',
    expected: ['Expected details toggle'],
  },
  {
    path: '/shadow',
    body: '<div id="host"></div><script>const root=document.querySelector("#host").attachShadow({mode:"open"});root.innerHTML=`<button>Expected shadow button</button><input aria-label="Expected shadow input">`</script>',
    expected: ['Expected shadow button', 'Expected shadow input'],
  },
  {
    path: '/large',
    body: `${Array.from({ length: 500 }, (_, index) => `<p>Public row ${index}</p>`).join('')}<button>Expected large button</button><a href="#large">Expected large link</a><input aria-label="Expected large input">`,
    expected: ['Expected large button', 'Expected large link', 'Expected large input'],
  },
  {
    path: '/injected-extension-ui',
    body: `<main><button>Expected host-page button</button></main>
      <aside id="third-party-extension-root">
        <svg role="img" aria-label="Injected extension icon"><path d="M0 0h1v1H0z"></path></svg>
        <div role="toolbar">${Array.from({ length: 250 }, (_, index) => `<button>Injected tool ${index}</button>`).join('')}</div>
      </aside>
      <script>document.documentElement.dataset.contextshieldContentReady = "2"</script>`,
    expected: ['Expected host-page button'],
  },
  {
    path: '/grounded-controls',
    body: `<main>
      <select><option>JAVA</option><option>C#</option><option>Python</option><option>SQL</option></select>
      <section><input type="checkbox" value="option-1"> Option 1</section>
      <section><input type="checkbox" value="option-2"> Option 2</section>
      <section><input type="radio" name="color" value="green"> Green</section>
      <section><input type="radio" name="color" value="blue"> Blue</section>
    </main>`,
    expected: ['Option 2', 'Blue'],
  },
  {
    path: '/adjacent-checkboxes',
    body: `<form id="checkboxes">
      <input id="checkbox-1" type="checkbox"> checkbox 1<br>
      <input id="checkbox-2" type="checkbox" checked> checkbox 2
    </form>
    <aside id="third-party-extension-root"><a href="#injected">Injected sidebar link</a></aside>
    <script>document.body.className = "weava-highlighter-active"</script>`,
    expected: ['checkbox 1', 'checkbox 2'],
  },
  {
    path: '/visually-hidden-controls',
    body: `<style>.hidden-control{position:absolute;opacity:0;width:1px;height:1px}</style>
      <input class="hidden-control" id="hidden-radio" type="radio" name="choice" value="male">
      <label for="hidden-radio" style="display:block;width:120px;height:32px">Expected visible radio label</label>`,
    expected: ['Expected visible radio label'],
  },
];

scenarios.push(
  ...Array.from({ length: 47 }, (_, index) => {
    const number = index + 1;
    return {
      path: `/generated-layout-${number}`,
      body: `<main data-layout="${number % 7}">
        <h2>Generated unfamiliar screen ${number}</h2>
        <section style="display:${number % 2 ? 'grid' : 'flex'}">
          <button>Expected generated action ${number}</button>
          <a href="#generated-${number}">Expected generated link ${number}</a>
          <input aria-label="Expected generated input ${number}">
        </section>
      </main>`,
      expected: [
        `Expected generated action ${number}`,
        `Expected generated link ${number}`,
        `Expected generated input ${number}`,
      ],
    };
  }),
);

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

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

async function sampleBrowserProcesses(): Promise<{
  cpuPercent: number;
  rssBytes: number;
  gpuRssBytes: number;
} | null> {
  try {
    const { stdout } = await execFileAsync('/bin/ps', ['-axo', '%cpu=,rss=,command=']);
    const lines = stdout.split('\n');
    const main = lines.find((line) => line.includes('--contextshield-benchmark-process'));
    const profile = /--user-data-dir=(?:"([^"]+)"|(\S+))/.exec(main ?? '')?.slice(1).find(Boolean);
    if (!profile) return null;
    let cpuPercent = 0;
    let rssKilobytes = 0;
    let gpuRssKilobytes = 0;
    for (const line of lines.filter((candidate) => candidate.includes(`--user-data-dir=${profile}`))) {
      const fields = /^\s*([0-9.]+)\s+(\d+)\s+/.exec(line);
      if (!fields?.[1] || !fields[2]) continue;
      const cpu = Number(fields[1]);
      const rss = Number(fields[2]);
      cpuPercent += cpu;
      rssKilobytes += rss;
      if (line.includes('--type=gpu-process')) gpuRssKilobytes += rss;
    }
    return {
      cpuPercent,
      rssBytes: rssKilobytes * 1_024,
      gpuRssBytes: gpuRssKilobytes * 1_024,
    };
  } catch {
    return null;
  }
}

test('detects visible interactables across representative and extension-injected website patterns', async () => {
  test.setTimeout(120_000);
  const byPath = new Map(scenarios.map((scenario) => [scenario.path, scenario]));
  const server = createServer((request, response) => {
    const scenario = byPath.get(new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`).pathname);
    if (!scenario) return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><body>${scenario.body}</body></html>`);
  });
  await listen(server);

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      '--enable-precise-memory-info',
      '--contextshield-benchmark-process',
      `--disable-extensions-except=${resolve(process.env.CONTEXTSHIELD_EXTENSION_DIR ?? '.output/chrome-mv3')}`,
      `--load-extension=${resolve(process.env.CONTEXTSHIELD_EXTENSION_DIR ?? '.output/chrome-mv3')}`,
    ],
  });

  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).hostname;
    const controller = await context.newPage();
    await controller.goto(`chrome-extension://${extensionId}/popup.html`);
    const target = await context.newPage();
    let expectedTotal = 0;
    let detectedTotal = 0;
    const latencies: number[] = [];
    let peakHeapBytes = 0;
    const browserCpuSamples: number[] = [];
    let peakBrowserRssBytes = 0;
    let peakGpuRssBytes = 0;

    for (const scenario of scenarios) {
      const url = `http://127.0.0.1:${PORT}${scenario.path}`;
      await target.goto(url);
      await target.bringToFront();
      const started = performance.now();
      const observed: ContentResponse = await controller.evaluate(async (targetUrl) => {
        const tab = (await browser.tabs.query({})).find((candidate) => candidate.url === targetUrl);
        if (tab?.id === undefined) throw new Error('Benchmark tab not found');
        try {
          const pong: unknown = await browser.tabs.sendMessage(tab.id, {
            type: 'PING_CONTENT_V2',
          });
          if (
            typeof pong !== 'object' ||
            pong === null ||
            !('protocolVersion' in pong) ||
            pong.protocolVersion !== 2
          ) {
            throw new Error('Stale content protocol');
          }
        } catch {
          await browser.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['/content-scripts/content.js'],
          });
        }
        return browser.tabs.sendMessage(tab.id, { type: 'OBSERVE_PAGE_V2' });
      }, url);
      latencies.push(performance.now() - started);
      if (!observed.ok || observed.kind !== 'OBSERVATION') {
        throw new Error(
          `Observation failed for ${scenario.path}: ${observed.ok ? 'INVALID_RESPONSE' : observed.error}`,
        );
      }
      if (scenario.path === '/grounded-controls') {
        const controls = observed.local.observation.elements;
        const firstSelect = controls.find((element) => element.role === 'combobox');
        const optionTwo = controls.find((element) => element.control_value === 'option-2');
        const blue = controls.find((element) => element.control_value === 'blue');
        expect(firstSelect).toMatchObject({
          selected_option: 'JAVA',
          options: ['JAVA', 'C#', 'Python', 'SQL'],
        });
        expect(optionTwo).toMatchObject({ role: 'checkbox', label: 'Option 2', selected: false });
        expect(blue).toMatchObject({ role: 'radio', label: 'Blue', selected: false });
      }
      if (scenario.path === '/adjacent-checkboxes') {
        const checkboxes = observed.local.observation.elements.filter(
          (element) => element.role === 'checkbox',
        );
        expect(checkboxes).toMatchObject([
          { label: 'checkbox 1', selected: false },
          { label: 'checkbox 2', selected: true },
        ]);
        expect(JSON.stringify(observed.local.observation.elements)).not.toContain(
          'Injected sidebar link',
        );
      }
      if (scenario.path === '/visually-hidden-controls') {
        const radio = observed.local.observation.elements.find(
          (element) => element.role === 'radio',
        );
        expect(radio).toMatchObject({
          label: 'Expected visible radio label',
          control_value: 'male',
          selected: false,
        });
        expect(radio?.bbox.width).toBeGreaterThan(1);
      }
      if (scenario.path === '/injected-extension-ui') {
        const serialized = JSON.stringify(observed.local.observation.elements);
        expect(serialized).not.toContain('Injected tool');
        expect(serialized).not.toContain('Injected extension icon');
      }
      const searchable = observed.local.observation.elements
        .flatMap((element) => [element.text, element.label])
        .filter((value): value is string => typeof value === 'string')
        .join('\n');
      expectedTotal += scenario.expected.length;
      detectedTotal += scenario.expected.filter((label) => searchable.includes(label)).length;
      peakHeapBytes = Math.max(
        peakHeapBytes,
        await target.evaluate(() => {
          const memory = (performance as unknown as {
            memory?: { usedJSHeapSize: number };
          }).memory;
          return memory?.usedJSHeapSize ?? 0;
        }),
      );
      const processSample = await sampleBrowserProcesses();
      if (processSample) {
        browserCpuSamples.push(processSample.cpuPercent);
        peakBrowserRssBytes = Math.max(peakBrowserRssBytes, processSample.rssBytes);
        peakGpuRssBytes = Math.max(peakGpuRssBytes, processSample.gpuRssBytes);
      }
    }

    const recall = detectedTotal / expectedTotal;
    const report = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      dataset: { scenarios: scenarios.length, expected_interactables: expectedTotal },
      screen_context: {
        detected_interactables: detectedTotal,
        recall,
        target_recall: 0.9,
      },
      performance: {
        perception_latency_ms_median: percentile(latencies, 0.5),
        perception_latency_ms_p95: percentile(latencies, 0.95),
        peak_page_heap_bytes: peakHeapBytes || null,
        average_browser_cpu_percent:
          browserCpuSamples.length > 0
            ? browserCpuSamples.reduce((total, value) => total + value, 0) /
              browserCpuSamples.length
            : null,
        peak_browser_rss_bytes: peakBrowserRssBytes || null,
        peak_gpu_process_rss_bytes: peakGpuRssBytes || null,
        cpu_percent:
          browserCpuSamples.length > 0
            ? browserCpuSamples.reduce((total, value) => total + value, 0) /
              browserCpuSamples.length
            : null,
        gpu_memory_bytes: null,
      },
      resource_measurement_scope:
        'Aggregate Chromium test-profile processes, including renderer, extension, network and GPU processes. CPU is ps process-lifetime average; GPU-process RSS is not GPU VRAM. No extension-only attribution.',
      environment: {
        platform: platform(),
        os_release: release(),
        logical_cpu_count: cpus().length,
        host_memory_bytes: totalmem(),
      },
      scope: [
        'standard HTML',
        'forms',
        'tables',
        'dynamic DOM',
        'image-heavy',
        'canvas',
        'ARIA controls',
        'details/summary',
        'open Shadow DOM',
        'large page',
        'third-party extension-injected DOM and stale content marker',
        'adjacent unlabeled controls with a globally tagged page body',
        '47 generated unfamiliar layout variants',
      ],
    };
    await mkdir(resolve('../benchmarks/results'), { recursive: true });
    await writeFile(
      resolve('../benchmarks/results/browser-compatibility.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    expect(recall).toBeGreaterThanOrEqual(0.9);
  } finally {
    await context.close();
    await close(server);
  }
});
