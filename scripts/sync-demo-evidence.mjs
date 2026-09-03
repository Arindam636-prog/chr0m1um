import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'benchmarks/results/latest.json');
const destinationPath = resolve(root, 'demo/evidence.json');

const report = JSON.parse(await readFile(sourcePath, 'utf8'));
const compatibility = report.browser_compatibility ?? {};
const screen = compatibility.screen_context ?? {};
const pii = report.pii ?? {};
const redaction = report.redaction ?? {};
const performance = report.performance ?? {};
const live = report.live_product ?? {};
const completion = live.task_completion ?? {};

function percent(value) {
  return typeof value === 'number' ? `${(value * 100).toFixed(value === 1 ? 0 : 1)}%` : 'Unavailable';
}

function milliseconds(value) {
  return typeof value === 'number' ? `${(value / 1000).toFixed(2)} s` : 'Unavailable';
}

function mebibytes(value) {
  return typeof value === 'number' ? `${(value / 1024 / 1024).toFixed(1)} MB` : 'Unavailable';
}

function gibibytes(value) {
  return typeof value === 'number' ? `${(value / 1024 / 1024 / 1024).toFixed(2)} GB` : 'Unavailable';
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
      scope: 'Expected interactables found across 60 controlled browser screens. This is semantic DOM, ARIA and OCR recall, not pixel box accuracy.',
    },
    pii: {
      value: `${percent(pii.precision)} / ${percent(pii.recall)}`,
      scope: `${report.dataset?.total_cases ?? 'Unknown'} labelled synthetic cases. Precision is shown first, recall second.`,
    },
    redaction: {
      value: typeof pixelCases === 'number' ? `${pixelCases} / ${pixelCases}` : percent(redaction.controlled_sensitive_pixel_redaction_recall),
      scope: 'Controlled supplied-box pixel masks verified, with detected text entities removed from sanitized context.',
    },
    latency: {
      value: milliseconds(performance.end_to_end_task_latency_ms),
      scope: typeof completed === 'number' && typeof attempted === 'number'
        ? `Median across ${completed} of ${attempted} completed controlled live-product tasks.`
        : 'A live-product run is required for this value.',
    },
    resources: {
      value: `${mebibytes(performance.chrome_extension_package_bytes)} release`,
      scope: `${gibibytes(performance.peak_browser_rss_bytes)} peak aggregate Chromium test profile. Extension-only RAM is not yet isolated.`,
    },
  },
  caveat: 'Controlled results validate the prototype. A human-reviewed face and document dataset, pixel-level UI grounding benchmark, extension-only resource measurement and larger independent task suite remain required before production claims.',
};

await writeFile(destinationPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
process.stdout.write(`Updated ${destinationPath}\n`);
