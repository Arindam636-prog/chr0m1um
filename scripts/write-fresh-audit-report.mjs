import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const read = async (file) => JSON.parse(await readFile(resolve(root, 'benchmarks/results', file), 'utf8'));
const audit = await read('fresh-audit.json');
const latest = await read('latest.json');
const repeats = await Promise.all([0, 1, 2].map((i) => read(`judge-repeat-${i}.json`)));
const live = await read('live-playwright.json');
const times = repeats.filter((r) => r.completed).map((r) => r.metrics.totalMs).sort((a, b) => a - b);
const percentile = (fraction) => {
  if (!times.length) return null;
  const position = (times.length - 1) * fraction;
  return times[Math.floor(position)] + (times[Math.ceil(position)] - times[Math.floor(position)]) * (position % 1);
};
const seconds = (n) => n === null ? 'unavailable' : `${(n / 1000).toFixed(2)} s`;
const percent = (n) => `${(100 * n).toFixed(1)}%`;
const gib = (n) => `${(n / 1024 ** 3).toFixed(2)} GiB`;
const pixelRows = audit.rows.filter((r) => r.pixels);
const hash = async (path) => createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
const serverHash = await hash('server/app/model/qwen.py');
const backgroundHash = await hash('release/ContextShield-Chrome/background.js');
const tests = [];
function collect(suites) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) tests.push({ title: spec.title, status: t.status, duration: t.results?.at(-1)?.duration });
    collect(suite.suites);
  }
}
collect(live.suites);
const baseline = audit.resources.baseline;
const active = audit.resources.active;
const screen = latest.browser_compatibility;
const text = `# ContextShield — fresh audit results

Generated ${new Date().toISOString()}. Team Chr0m1um / PS 26171.

## Bottom line

The new real-model privacy regression audit completed ${audit.completed}/${audit.attempted} synthetic pages. The final repeated Qwen judge workflow passed ${times.length}/${repeats.length} attempts. These are controlled regression results, NOT universal website compatibility or a complete validation of all SIH metrics.

## The five PS metrics

| Metric / PS weight | Fresh result | What it means and what it does not |
| --- | --- | --- |
| Visual context / 25% | ${screen.screen_context.detected_interactables}/${screen.dataset.expected_interactables} expected controls found across ${screen.dataset.scenarios} scenarios | DOM/ARIA control recall. Not general screen understanding, OCR accuracy, or reviewed detector box accuracy. |
| PII detection / 20% | ${percent(audit.typeLevelDetection.precision)} precision; ${percent(audit.typeLevelDetection.recall)} recall at case/type level | ${audit.typeLevelDetection.tp} correct type predictions, ${audit.typeLevelDetection.fp} extra type predictions, ${audit.typeLevelDetection.fn} missing expected types. Real DOM/YOLOX/OCR/Rampart pipeline, ${audit.attempted} synthetic pages. Includes conservative policy classifications; NOT exact entity/span precision. |
| Redaction / 20% | ${pixelRows.filter((r) => r.pixels.coverage === 1).length}/${pixelRows.length} actual crops completely cover their annotations | Two known canvas secrets and one portrait at two sizes. Approximate face boxes; broader masking remains. This is annotated coverage, not a population redaction-precision score. |
| Client resources / 20% | ${gib(active.peakRssBytes)} active Chromium peak vs ${gib(baseline.peakRssBytes)} baseline | Difference of observed peaks: ${gib(audit.resources.differenceOfObservedPeaksBytes)}. Includes browser, popup, models and workers; not isolated extension allocation. GPU-process RSS is NOT VRAM. |
| Task latency / 15% | Median ${seconds(percentile(.5))}; observed range ${seconds(times[0] ?? null)}–${seconds(times.at(-1) ?? null)} | ${times.length}/${repeats.length} real Qwen judge tasks passed. Cold client models, already-running server. Task timer excludes browser setup/screenshots; no confirmation wait. Only three samples. |

Weights are not pass thresholds and do not provide a formula for converting these results into marks out of 100.

## Bugs found and fixes made

1. **Canvas name left readable in a crop:** contextual PII filtering previously applied to text records but not to image masks. Image masking now also uses Rampart's OCR-text classifications before encoding a crop. The same offscreen model instance is reused.
2. **Masks too tight:** face masks now include proportional padding. OCR masks include line-height-scaled margins to account for downscaling and clipped glyph edges. This improves coverage at the cost of some extra masking.
3. **Unnecessary post-completion planning / timeout:** the first repeated judge test passed only 1/3 attempts. The planner prompt now omits absent metadata, explicitly states the current numeric-price comparison, and instructs the model to stop when the requested result is visible. Current final repeats: ${times.length}/3. No deadline or privacy validation was disabled, and no successful result was fabricated.
4. **Misleading benchmark labels:** server round trips are no longer labelled model inference time. Local-only and server-assisted latency are separated. Failed attempts stay in denominators. Website evidence cards show the scoped full-pipeline findings, including extra alerts.
5. **Filled input re-read by OCR:** DemoQA exposed a first name in the prepared context via OCR even though the DOM value stayed local. Filled text inputs are now blacked out before OCR and in overlapping outgoing crops. Single-word names are classified using input metadata. The existing known-secret network guard was not disabled.
6. **Server resource defaults:** the runner previously forced a minimum of 1024 image tokens and allowed llama.cpp's default 8192 MiB prompt cache. Minimum image tokens are now 256 (not a maximum); prompt cache is capped at 512 MiB. Larger images may still use more tokens. Final task timings use these settings; no arbitrary timeout increase was made.

The corpus exposed bugs and was then used to fix them: it is now a regression corpus, not an untouched held-out evaluation set.

## Actual pixel checks

| Fixture | Annotated sensitive pixels covered | Entire crop masked |
| --- | --- | --- |
${pixelRows.map((r) => `| ${r.id} | ${r.pixels.coveredPixels}/${r.pixels.expectedPixels} (${percent(r.pixels.coverage)}) | ${percent(r.pixels.maskedImageFraction)} |`).join('\n')}

Canvas annotations use the authored secret's measured glyph positions, not the entire sentence: public prefix/suffix text is excluded from ground truth. The initial diagnostic report counted all sentence glyphs, so its text percentages are not directly comparable to this corrected secret-only annotation. The original canvas-name defect had zero masking anywhere in the crop. Face annotations are unchanged. Wider masks cover some non-sensitive text/background; these tests do not establish production redaction precision.

All ${audit.rows.reduce((n, r) => n + r.expectedSecretCount, 0)} known exact test strings were absent from the prepared text context. Exact-string absence alone does not prove absence of partial or indirect identifying information. The Qwen judge test additionally intercepts actual planning request bodies and checks its known synthetic name/email/password strings; it checks the actual displayed crop's face-center pixels and final page values.

## Browser regressions

| Test | Result | Whole-test duration, not pure agent latency |
| --- | --- | --- |
${tests.map((t) => `| ${t.title.replaceAll('|', '/').replace(' with real Qwen', ' (local control task)')} | ${t.status === 'expected' ? 'PASS' : t.status.toUpperCase()} | ${seconds(t.duration ?? null)} |`).join('\n')}

External availability can change. Practice-site tests use fake values; simple controls can complete locally and are not evidence of Qwen latency. Chrome was runtime-tested. Firefox was built, not runtime-tested.

## Remaining shortcomings

- **False positives:** public control/product text and OCR misreadings still cause extra privacy flags. Uncertain findings remain protected and marked for review; they were not removed to inflate precision.
- **Memory:** local inference adds substantial browser memory on this machine. This is not yet a low-end-device resource guarantee.
- **Generalization:** no independent, human-reviewed multi-person/document corpus or broad entity-span evaluation was completed. Two portrait sizes are not two independent faces.
- **Latency:** server planning dominates and varied substantially over three runs. Sample p95 is ${seconds(percentile(.95))}, but three runs do not reliably estimate tail latency.
- **Metrics quality:** CPU samples are process-lifetime averages, not interval CPU utilization. Baseline/active runs have different work durations; their averages cannot be treated as a controlled CPU overhead ratio.

## Environment and reproduction

- ${audit.environment.cpu}, ${audit.environment.logicalCpus} logical CPUs, ${gib(audit.environment.hostMemoryBytes)} host memory, ${audit.environment.platform}.
- Packaged Chrome extension v1.4.0. Background SHA-256: \`${backgroundHash}\`.
- Planner source SHA-256: \`${serverHash}\`.
- Full local models: YOLOX face, PP-OCR, Rampart; server: Qwen3-VL-4B through llama.cpp.
- Raw evidence: [privacy audit](../benchmarks/results/fresh-audit.json), [component report](../benchmarks/results/latest.json), [final judge repeats](../benchmarks/results/judge-repeats-playwright.json), [browser regressions](../benchmarks/results/live-playwright.json).
- Preserved diagnostics: [privacy before fixes](../benchmarks/results/fresh-audit-before-fixes.json), [judge repeats before planner fix](../benchmarks/results/judge-repeats-before-planner-fix.json).

Start the current stack with START.command, then run \`npm run audit:fresh\` from the project folder. For public practice-site coverage, run \`CONTEXTSHIELD_E2E_EXTERNAL=1 npm run audit:fresh\`. Outputs are retained under benchmarks/results. Reload the unpacked Chrome extension after replacing/rebuilding release/ContextShield-Chrome.
`;
await writeFile(resolve(root, 'docs/FRESH-AUDIT-RESULTS.md'), text, 'utf8');
process.stdout.write('Wrote docs/FRESH-AUDIT-RESULTS.md\n');
