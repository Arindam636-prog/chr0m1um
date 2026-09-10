import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'benchmarks/results/latest.json');
const destinationPath = resolve(root, 'demo/evidence.json');

const report = JSON.parse(await readFile(sourcePath, 'utf8'));
async function recentResult(name) {
  try {
    const value = JSON.parse(await readFile(resolve(root, 'benchmarks/results', name), 'utf8'));
    const timestamp = Date.parse(value.generatedAt ?? value.generated_at);
    return Number.isFinite(timestamp) && Math.abs(Date.parse(report.generated_at) - timestamp) < 86_400_000 ? value : null;
  } catch { return null; }
}
const audit = await recentResult('fresh-audit.json');
const repeats = (await Promise.all([0, 1, 2].map((i) => recentResult(`judge-repeat-${i}.json`)))).filter(Boolean);
const completedRepeats = repeats.filter((r) => r.completed && typeof r.metrics?.totalMs === 'number');
const taskTimes = completedRepeats.map((r) => r.metrics.totalMs).sort((a, b) => a - b);
const taskMedian = taskTimes.length ? (taskTimes[Math.floor((taskTimes.length - 1) / 2)] + taskTimes[Math.ceil((taskTimes.length - 1) / 2)]) / 2 : null;
const pixelRows = audit?.rows.filter((r) => r.pixels) ?? [];
const compatibility = report.browser_compatibility ?? {};
const screen = compatibility.screen_context ?? {};
const pii = report.pii ?? {};
const redaction = report.redaction ?? {};
const performance = report.performance ?? {};
const live = report.live_product ?? {};
const completion = live.task_completion ?? {};
const serverLatency = performance.latency_by_mode?.server_assisted;

function percent(value) {
  return typeof value === 'number' ? `${(value * 100).toFixed(value === 1 ? 0 : 1)}%` : 'Unavailable';
}

function milliseconds(value) {
  return typeof value === 'number' ? `${(value / 1000).toFixed(2)} s` : 'Unavailable';
}

function mebibytes(value) {
  return typeof value === 'number' ? `${(value / 1024 / 1024).toFixed(1)} MiB` : 'Unavailable';
}

function gibibytes(value) {
  return typeof value === 'number' ? `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB` : 'Unavailable';
}

const detected = screen.detected_interactables;
const expected = compatibility.dataset?.expected_interactables;
const pixelCases = redaction.controlled_pixel_cases;
const completed = completion.completed;
const attempted = completion.attempted;

const evidence = {
  schema_version: 1,
  generated_at: report.generated_at,
  source: 'benchmarks/results/latest.json',
  metrics: {
    visual: {
      value: typeof detected === 'number' && typeof expected === 'number'
        ? `${detected} / ${expected}`
        : percent(report.sih_scorecard?.visual_relevant_element_recall),
      scope: `Expected interactables found across ${compatibility.dataset?.scenarios ?? 'unknown'} controlled browser screens. DOM/ARIA observation only, not OCR or pixel box accuracy.`,
    },
    pii: {
      value: `${percent(audit?.typeLevelDetection.precision ?? pii.precision)} / ${percent(audit?.typeLevelDetection.recall ?? pii.recall)}`,
      scope: audit ? `${audit.attempted} synthetic pages through real local models. Case/type classifications, including conservative policy flags; NOT entity/span accuracy. Precision first, recall second. Extra alerts count against precision.` : `${report.dataset?.total_cases ?? 'Unknown'} synthetic deterministic case/type tests only, not full-model entity accuracy. Precision first, recall second.`,
    },
    redaction: {
      value: pixelRows.length ? `${pixelRows.filter((r) => r.pixels.coverage === 1).length} / ${pixelRows.length}` : percent(redaction.controlled_sensitive_pixel_redaction_recall),
      scope: pixelRows.length ? 'Actual pipeline crops fully covering authored annotations: two canvas secrets and one synthetic portrait at two sizes. Not a population redaction-precision score; surrounding content is also masked.' : `${pixelCases ?? 'Unknown'} controlled supplied-box masks. This tests mask application, not whether detection found all sensitive pixels.`,
    },
    latency: {
      value: milliseconds(repeats.length ? taskMedian : serverLatency?.task_ms_median),
      scope: repeats.length ? `Real Qwen judge workflow: ${completedRepeats.length}/${repeats.length} attempts passed. Median successful task timer; cold client models, running server. Failures excluded from latency, NOT completion rate.` : typeof completed === 'number' && typeof attempted === 'number'
        ? `Server-assisted task timer; ${serverLatency?.completed ?? 0}/${serverLatency?.attempted ?? 0} server tasks completed. Local-only timings excluded. Small controlled sample, not a runtime guarantee.`
        : 'A live-product run is required for this value.',
    },
    resources: {
      value: `${mebibytes(performance.chrome_extension_package_bytes)} release`,
      scope: audit ? `${gibibytes(audit.resources.active.peakRssBytes)} active browser peak vs ${gibibytes(audit.resources.baseline.peakRssBytes)} rendering baseline. Whole process trees; NOT isolated extension allocation or GPU VRAM.` : `${gibibytes(performance.peak_browser_rss_bytes)} peak aggregate Chromium test profile. Extension-only RAM is not yet isolated.`,
    },
  },
  caveat: 'Controlled results validate the prototype. A human-reviewed face and document dataset, pixel-level UI grounding benchmark, extension-only resource measurement and larger independent task suite remain required before production claims.',
};

await writeFile(destinationPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
process.stdout.write(`Updated ${destinationPath}\n`);
