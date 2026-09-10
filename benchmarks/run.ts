import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import type { SensitiveEntityType } from '@contextshield/shared';

import { detectSensitiveText } from '../extension/lib/privacy/deterministicDetectors';
import { decidePolicy } from '../extension/lib/privacy/policyEngine';
import { redactText } from '../extension/lib/privacy/textRedactor';
import { irreversiblyMask, verifyMasks } from '../extension/lib/privacy/rasterRedactor';

interface Case {
  id: string;
  text: string;
  expected: SensitiveEntityType[];
  critical?: boolean;
}

function cases(): Case[] {
  const result: Case[] = [];
  const add = (prefix: string, count: number, make: (index: number) => Omit<Case, 'id'>) => {
    for (let index = 0; index < count; index += 1) {
      result.push({ id: `${prefix}_${index + 1}`, ...make(index) });
    }
  };
  add('email', 25, (index) => ({
    text: `Contact test.user${index}@example${index}.com for details`,
    expected: ['EMAIL'],
  }));
  add('phone', 25, (index) => ({
    text: `Mobile: +91 ${60000 + index}-${10000 + index}`,
    expected: ['PHONE'],
  }));
  add('pan', 20, (index) => ({
    text: `PAN ABCDE${String(index).padStart(4, '0')}F`,
    expected: ['PAN'],
  }));
  add('ifsc', 15, (index) => ({
    text: `IFSC HDFC0${String(index).padStart(6, '0')}`,
    expected: ['IFSC'],
  }));
  add('upi', 15, (index) => ({
    text: `UPI payer${index}@oksbi`,
    expected: ['UPI_ID'],
  }));
  add('otp', 15, (index) => ({
    text: `One-time password: ${String(420000 + index)}`,
    expected: ['OTP'],
    critical: true,
  }));
  add('password', 15, (index) => ({
    text: `password=SampleSecret${index}!`,
    expected: ['PASSWORD'],
    critical: true,
  }));
  add('account', 15, (index) => ({
    text: `Customer ID: ACCT${String(index).padStart(5, '0')}`,
    expected: ['ACCOUNT_ID'],
  }));
  add('person', 15, (index) => ({
    text: `Patient: Sample Person${String.fromCharCode(65 + index)}`,
    expected: ['PERSON_NAME'],
  }));
  add('address', 15, (index) => ({
    text: `Address: ${index + 1} Privacy Lane, Example Nagar`,
    expected: ['ADDRESS'],
  }));
  add('medical', 15, (index) => ({
    text: `Diagnosis: controlled-condition-${index}`,
    expected: ['MEDICAL'],
  }));
  const cardFormats = [
    '4111111111111111',
    '4111 1111 1111 1111',
    '4111-1111-1111-1111',
    '4012888888881881',
    '5555 5555 5555 4444',
  ];
  cardFormats.forEach((card, index) => {
    result.push({ id: `card_${index + 1}`, text: `Card: ${card}`, expected: ['PAYMENT_CARD'], critical: true });
  });
  add('negative', 100, (index) => ({
    text: `Public product ${index + 1} costs ₹${900 + index}; delivery in ${2 + (index % 5)} days`,
    expected: [],
  }));
  return result;
}

async function directoryBytes(path: string): Promise<number | null> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    let bytes = 0;
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) bytes += (await directoryBytes(child)) ?? 0;
      else if (entry.isFile()) bytes += (await stat(child)).size;
    }
    return bytes;
  } catch {
    return null;
  }
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

async function main() {
  const dataset = cases();
  const latencies: number[] = [];
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let criticalExpected = 0;
  let criticalFound = 0;
  let redactionEntities = 0;
  let redactionEntitiesRemoved = 0;
  let sensitivePixels = 0;
  let sensitivePixelsRedacted = 0;
  let nonSensitivePixels = 0;
  let nonSensitivePixelsPreserved = 0;
  const failures: Array<{ id: string; expected: string[]; predicted: string[] }> = [];
  const memoryBefore = process.memoryUsage().heapUsed;

  for (const sample of dataset) {
    let sequence = 0;
    const started = performance.now();
    const detected = detectSensitiveText(
      sample.text,
      'TEXT',
      'DOM',
      'el_benchmark',
      () => `pii_${++sequence}`,
    );
    latencies.push(performance.now() - started);
    const expected = new Set(sample.expected);
    const predicted = new Set(detected.map((item) => item.entity.type));
    const decisions = new Map(
      detected.map((entity) => {
        const decision = decidePolicy(entity, {
          store: (kind) => `LOCAL_${kind}_BENCHMARK`,
          firstHandle: () => undefined,
        });
        return [decision.entity_id, decision] as const;
      }),
    );
    const safeText = redactText(sample.text, detected, decisions) ?? '';
    for (const entity of detected) {
      if (!entity.rawValue) continue;
      redactionEntities += 1;
      if (!safeText.includes(entity.rawValue)) redactionEntitiesRemoved += 1;
    }
    for (const type of predicted) {
      if (expected.has(type)) truePositive += 1;
      else falsePositive += 1;
    }
    for (const type of expected) {
      if (!predicted.has(type)) falseNegative += 1;
    }
    if (sample.critical) {
      criticalExpected += expected.size;
      criticalFound += [...expected].filter((type) => predicted.has(type)).length;
    }
    if (
      [...expected].some((type) => !predicted.has(type)) ||
      [...predicted].some((type) => !expected.has(type))
    ) {
      failures.push({ id: sample.id, expected: [...expected], predicted: [...predicted] });
    }
  }

  for (let sample = 0; sample < 100; sample += 1) {
    const width = 64;
    const height = 48;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = (offset + sample * 7) % 251;
      data[offset + 1] = (offset + sample * 11) % 253;
      data[offset + 2] = (offset + sample * 13) % 255;
      data[offset + 3] = 255;
    }
    const box = {
      x: 2 + (sample % 13),
      y: 3 + (sample % 9),
      width: 18 + (sample % 7),
      height: 10 + (sample % 5),
    };
    const source = { width, height, data };
    const redacted = irreversiblyMask(source, [box]);
    if (!verifyMasks(redacted, [box])) throw new Error('Controlled pixel redaction failed');
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const inside = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
        const offset = (y * width + x) * 4;
        if (inside) {
          sensitivePixels += 1;
          if (
            redacted.data[offset] === 0 &&
            redacted.data[offset + 1] === 0 &&
            redacted.data[offset + 2] === 0 &&
            redacted.data[offset + 3] === 255
          ) sensitivePixelsRedacted += 1;
        } else {
          nonSensitivePixels += 1;
          if (
            redacted.data[offset] === data[offset] &&
            redacted.data[offset + 1] === data[offset + 1] &&
            redacted.data[offset + 2] === data[offset + 2] &&
            redacted.data[offset + 3] === data[offset + 3]
          ) nonSensitivePixelsPreserved += 1;
        }
      }
    }
  }

  const precision = truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  const negativeCases = dataset.filter((sample) => sample.expected.length === 0).length;
  const negativeCasesWithPrediction = failures.filter((failure) => failure.id.startsWith('negative_')).length;
  const readResult = async (name: string): Promise<Record<string, unknown> | null> => {
    try {
      return JSON.parse(
        await readFile(join(process.cwd(), 'benchmarks', 'results', name), 'utf8'),
      ) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const browserCompatibility = await readResult('browser-compatibility.json');
  const liveProduct =
    process.env.CONTEXTSHIELD_INCLUDE_LIVE === '1'
      ? await readResult('live-product.json')
      : null;
  const livePerformance = liveProduct?.performance as Record<string, unknown> | undefined;
  const liveCompletion = liveProduct?.task_completion as Record<string, unknown> | undefined;
  const chromePackageBytes =
    (await directoryBytes(join(process.cwd(), 'release', 'ContextShield-Chrome'))) ??
    (await directoryBytes(join(process.cwd(), 'extension', '.output', 'chrome-mv3')));
  const modelBytes = await directoryBytes(join(process.cwd(), 'extension', 'public', 'models'));
  const browserPerformance = browserCompatibility?.performance as Record<string, unknown> | undefined;
  const report = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    implementation: 'deterministic-local-cascade',
    measurement_scope: {
      pii: 'Synthetic case/type-level deterministic detector tests; not exact-span or full-model accuracy.',
      redaction: 'Detected text removal and mask application with supplied boxes; not ground-truth detector coverage.',
      browser: 'DOM control recall, not general visual understanding accuracy.',
      latency: 'Separated by execution mode; task timers exclude browser setup. Planner round trips are not model inference latency.',
      resources: 'Aggregate Chromium RSS and process-lifetime CPU; GPU process RSS is not VRAM. See fresh-audit.json for paired baseline.',
    },
    dataset: {
      total_cases: dataset.length,
      positive_cases: dataset.length - negativeCases,
      negative_cases: negativeCases,
      synthetic: true,
    },
    pii: {
      true_positive: truePositive,
      false_positive: falsePositive,
      false_negative: falseNegative,
      precision,
      recall,
      f1: (2 * precision * recall) / Math.max(Number.EPSILON, precision + recall),
      false_positive_case_rate: negativeCasesWithPrediction / Math.max(1, negativeCases),
      controlled_critical_recall: criticalFound / Math.max(1, criticalExpected),
    },
    redaction: {
      controlled_detected_entities: redactionEntities,
      controlled_entities_removed: redactionEntitiesRemoved,
      controlled_entity_removal_recall:
        redactionEntitiesRemoved / Math.max(1, redactionEntities),
      controlled_text_leakage_rate:
        1 - redactionEntitiesRemoved / Math.max(1, redactionEntities),
      controlled_sensitive_pixel_redaction_recall:
        sensitivePixelsRedacted / Math.max(1, sensitivePixels),
      controlled_non_sensitive_pixel_preservation:
        nonSensitivePixelsPreserved / Math.max(1, nonSensitivePixels),
      controlled_pixel_cases: 100,
    },
    performance: {
      detector_latency_ms_median: percentile(latencies, 0.5),
      detector_latency_ms_p95: percentile(latencies, 0.95),
      heap_delta_bytes: process.memoryUsage().heapUsed - memoryBefore,
      contextual_model_latency_ms: null,
      planner_round_trip_latency_ms: livePerformance?.planner_round_trip_latency_ms_median ?? null,
      end_to_end_task_latency_ms: null,
      latency_by_mode: livePerformance?.latency_by_mode ?? null,
      client_stage_latency_ms: livePerformance?.client_stages_ms_median ?? null,
      peak_browser_rss_bytes: browserPerformance?.peak_browser_rss_bytes ?? null,
      average_browser_cpu_percent: browserPerformance?.average_browser_cpu_percent ?? null,
      peak_gpu_process_rss_bytes: browserPerformance?.peak_gpu_process_rss_bytes ?? null,
      chrome_extension_package_bytes: chromePackageBytes,
      bundled_model_bytes: modelBytes,
    },
    sih_scorecard: {
      visual_context_weight: 0.25,
      visual_relevant_element_recall:
        (browserCompatibility?.screen_context as Record<string, unknown> | undefined)?.recall ?? null,
      pii_detection_weight: 0.2,
      pii_precision: precision,
      pii_recall: recall,
      pii_f1: (2 * precision * recall) / Math.max(Number.EPSILON, precision + recall),
      redaction_weight: 0.2,
      text_entity_removal_recall: redactionEntitiesRemoved / Math.max(1, redactionEntities),
      sensitive_pixel_redaction_recall: sensitivePixelsRedacted / Math.max(1, sensitivePixels),
      client_resources_weight: 0.2,
      peak_browser_rss_bytes: browserPerformance?.peak_browser_rss_bytes ?? null,
      chrome_extension_package_bytes: chromePackageBytes,
      latency_weight: 0.15,
      end_to_end_task_latency_ms_median: null,
      latency_by_mode: livePerformance?.latency_by_mode ?? null,
      measured_task_completion_rate: liveCompletion?.rate ?? null,
    },
    browser_compatibility: browserCompatibility,
    live_product: liveProduct,
    unavailable_metrics: {
      screen_context_accuracy: 'DOM control recall is available separately; general visual understanding accuracy is not measured.',
      full_pipeline_entity_span_precision_recall: 'Requires a held-out, reviewed corpus; fresh-audit.json is a synthetic full-pipeline regression audit, not population accuracy.',
      reviewed_yolox_detection_accuracy:
        'Requires a separately licensed, human-reviewed face/document image dataset; controlled pixel redaction is measured above',
      task_completion_rate: liveCompletion?.rate !== undefined
        ? null
        : 'Requires the running local llama.cpp/Qwen stack and live demo corpus',
    },
    failures,
  };
  const outputDirectory = join(process.cwd(), 'benchmarks', 'results');
  await mkdir(outputDirectory, { recursive: true });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(join(outputDirectory, 'latest.json'), serialized, 'utf8');
  process.stdout.write(serialized);
  if (recall < 0.95 || report.pii.controlled_critical_recall < 1) process.exitCode = 1;
}

void main();
