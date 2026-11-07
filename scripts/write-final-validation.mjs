import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// Historical one-off exporter. Its narrative and output paths describe the
// September submission, so newer runs must never overwrite that evidence.
if (new Date().toISOString().slice(0, 10) !== '2026-09-19') {
  throw new Error('Archived September exporter. Record new checks in a separately dated report. See docs/PUBLICATION-2026-11-07.md.');
}
const results = resolve(root, 'benchmarks/results');
const out = resolve(root, 'docs/evidence/2026-09-19-final');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const audit = await read(resolve(results, 'fresh-audit.json'));
const visual = await read(resolve(results, 'visual-decision/report.json'));
const before = await read(resolve(results, 'visual-decision-before-fixes/report.json'));
const repeats = await Promise.all([0, 1, 2].map(i => read(resolve(results, `judge-repeat-${i}.json`))));
const today = new Date().toISOString().slice(0, 10);
for (const value of [audit, visual, ...repeats]) {
  if (!value.generatedAt?.startsWith(today)) throw new Error('Refusing stale measurements');
}
await mkdir(out, {recursive:true});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const times = repeats.filter(r => r.completed).map(r => r.metrics.totalMs).sort((a,b)=>a-b);
const quantile = p => {
  if (!times.length) return null;
  const position=(times.length-1)*p;const low=Math.floor(position);const high=Math.ceil(position);
  return times[low]+(times[high]-times[low])*(position-low);
};
const pixels = audit.rows.filter(r=>r.pixels).map(r=>r.pixels);
const total = key => pixels.reduce((n,p)=>n+p[key],0);
const hashes={};
for (const file of ['extension/entrypoints/background/index.ts','extension/lib/agent/planningReadiness.ts','server/app/model/qwen.py','demo/visual-board.js','release/ContextShield-Chrome/background.js','release/ContextShield-Chrome/manifest.json']) {
  hashes[file]=sha(await readFile(resolve(root,file)));
}
const summary={
  generatedAt:new Date().toISOString(),environment:audit.environment,sourceHashes:hashes,
  visual:{attempted:visual.attempted,completed:visual.completed,correctChoices:visual.rows.filter(r=>r.correctChoice).length,blocked:visual.rows.filter(r=>r.plannerRequests===0&&r.phase==='FAILED').length,initialCompleted:before.completed,initialAttempted:before.attempted,scope:visual.scope},
  pii:{...audit.typeLevelDetection,pages:audit.attempted,scope:'Case/type micro scores, not entity/span accuracy'},
  redaction:{crops:pixels.length,coveredCrops:pixels.filter(p=>p.coverage===1).length,annotationPixelPrecision:total('coveredPixels')/total('maskedPixels'),scope:'Black-mask overlap with authored glyphs and approximate face rectangles; mixed annotations, not population precision'},
  resources:{activePeak:audit.resources.active.peakRssBytes,baselinePeak:audit.resources.baseline.peakRssBytes,peakDifference:audit.resources.differenceOfObservedPeaksBytes,scope:audit.resources.scope},
  judge:{attempted:repeats.length,completed:times.length,medianMs:quantile(.5),p95Ms:quantile(.95),minMs:times[0]??null,maxMs:times.at(-1)??null,requests:repeats.reduce((n,r)=>n+(r.capturedPlannerRequests??0),0),canariesAbsent:repeats.every(r=>r.knownCanariesAbsentFromCapturedPlannerRequests),scope:'Cold client models each run; already-running local Qwen. Success-only latency, all attempts in completion denominator. Three runs do not establish tail latency.'},
};
await writeFile(resolve(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
await writeFile(resolve(out,'judge-repeats.json'),JSON.stringify(repeats,null,2)+'\n');
await copyFile(resolve(results,'fresh-audit.json'),resolve(out,'privacy-and-resources.json'));
await copyFile(resolve(results,'visual-decision/report.json'),resolve(out,'visual-decisions.json'));
await copyFile(resolve(results,'visual-decision-before-fixes/report.json'),resolve(out,'visual-decisions-initial.json'));
for (const file of ['original-portrait.png','outgoing-crop.png','planner-requests.json']) {
  await copyFile(resolve(results,`judge-capture-0/${file}`),resolve(out,file));
}
for (const index of [3,4,5]) {
  for (const file of ['original.png','outgoing.png','requests.json']) {
    await copyFile(resolve(results,`visual-decision/case-${index}-${file}`),resolve(out,`visual-${index}-${file}`));
  }
}
const sec=n=>(n/1000).toFixed(2);
const gib=n=>(n/1024**3).toFixed(2);
const pct=n=>(n*100).toFixed(1);
const md=`# Final submission evidence: ContextShield

Generated ${summary.generatedAt}. Official problem statement: **SIH26171**, On-device Visual Perception for Light-weight Browser Agents. This is an evidence-backed submission snapshot, not production certification or a prediction of SIH selection.

## Five evaluation areas

| PS area | Measured result | Boundary |
| --- | --- | --- |
| Visual context, 25% | ${summary.visual.completed}/${summary.visual.attempted} authored canvas tasks complete | ${summary.visual.correctChoices} correct choices, ${summary.visual.blocked} privacy stops before transmission. Numeric values absent from visible DOM. Not unseen websites or a paired DOM-only agent accuracy baseline. |
| PII, 20% | ${pct(summary.pii.precision)}% precision, ${pct(summary.pii.recall)}% recall | 11 synthetic pages; case/type micro scoring: 13 TP, 6 FP, 0 FN. Not exact entity/span detection. |
| Redaction, 20% | ${summary.redaction.coveredCrops}/${summary.redaction.crops} crops fully cover annotations | Two canvas secrets, one synthetic portrait at two sizes. Public background/text is also masked. |
| Client resources, 20% | ${gib(summary.resources.activePeak)} GiB active browser peak vs ${gib(summary.resources.baselinePeak)} GiB baseline | Whole process trees. ${gib(summary.resources.peakDifference)} GiB difference of observed peaks is not isolated extension allocation. |
| Latency, 15% | ${sec(summary.judge.medianMs)} s median; ${summary.judge.completed}/${summary.judge.attempted} judge tasks complete | Cold client models, already-running Qwen. Range ${sec(summary.judge.minMs)}–${sec(summary.judge.maxMs)} s. Three runs only. |

These results do not convert directly into marks. The weights are official judging weights, not pass thresholds. Hardware: ${audit.environment.cpu}, ${audit.environment.logicalCpus} logical CPUs, ${gib(audit.environment.hostMemoryBytes)} GiB host RAM, ${audit.environment.platform}.

## What changed

- The Qwen response schema now constrains snapshot_id to the exact current request. A captured diagnostic response correctly described a completed task but incremented its snapshot suffix; the unchanged stale-snapshot validator rejected it. The model no longer chooses protocol snapshot state. Invalid or stale responses still fail validation.
- Crowded pages retain up to 12 OCR text records inside the existing 80-record/20,000-character prompt budget. Visual-only records remain disabled as action targets.
- Local summaries include sanitized visual readings. Comparison requests phrased as summaries route to reasoning rather than returning only a count of controls.
- Every terminal path records elapsed time, including explicit failure returns. Cancelled older runs cannot overwrite a newer run's metrics.
- A local check stops the task if filtering removes a comparison criterion. It does not reveal values or lower PII thresholds.
- Added six visual-only comparison cases and a website demo route. These use generic Qwen planning and real DOM controls, without the railway adapter.
- The judge test now retains captured planning request bodies and the exact outgoing crop bytes. The slides use actual evidence instead of an illustrative privacy table.

## Verification of this update

19 September checks: lint/typecheck pass, 99 unit tests pass (4 shared + 95 extension), 36 backend tests pass, production Chrome and Firefox builds pass. Default browser regressions: 9 passed and 13 opt-in tests skipped. Separately, the real Qwen judge workflow passes 3/3 repeats, the Qwen-assisted railway test passes, and the fresh privacy corpus passes. The all-success visual comparison gate remains failing at 3/6. Firefox was built but not runtime-tested. The default suite includes the malicious password-to-unrelated-field rejection and signed-ledger tamper test; these are bounded security regressions, not a full security audit.

## Important unresolved finding

The initial visual suite completed ${before.completed}/${before.attempted} cases. After fixes it completes ${visual.completed}/${visual.attempted}. All three duration choices are correct and complete. In all three INR price cases, Rampart misclassifies the word “lowest” and public prices. The guard now stops before sending an altered task, with no choice clicked. **The six-case all-success gate still fails.** Privacy thresholds were not weakened to inflate task success. This fixture has informed fixes and is a regression set, not a held-out benchmark.

## Privacy evidence and methodology

The repeated judge workflow captured ${summary.judge.requests} actual /v1/agent/start and /step request bodies through Playwright browser network events. All three authored canaries (name, email and password) were absent from these bodies. The face-centre pixel was black in the proof image; the accompanying outgoing PNG is decoded from the actual request. This check does not cover all traffic destinations, indirect inference, transformed/partial secrets, or a compromised extension/device. It is not an independent third-party network audit.

PII precision = TP/(TP+FP), recall = TP/(TP+FN). A type present several times within one page counts once. Extra conservative classifications count against precision. The four redaction cases compare black mask pixels to authored secret glyph regions and approximate face rectangles. All annotated sensitive pixels are covered. The combined black-mask overlap ratio is ${pct(summary.redaction.annotationPixelPrecision)}%; this mixes annotation styles and is not a population redaction-precision score.

Resources use ps over each Chromium process tree. The baseline renders the same pages without the extension; active includes the popup, workers and inference. Separate observed peaks do not isolate extension allocation. CPU readings are process-lifetime averages, not interval CPU overhead. GPU-process RSS is not GPU VRAM. No low-end-device guarantee follows from this measurement.

Latency uses the extension task timer, excluding browser launch and screenshot capture. Median is the middle sorted successful duration. p95 uses linear interpolation: ${sec(summary.judge.p95Ms)} s on only three successful samples. Failures remain in completion denominators, even though latency is success-only. Do not compare this directly with the old mixed local-only 3.67 s number.

## Remaining release limits

Independent unseen tasks, exact entity/span and pixel-box labels, low-end memory/interval CPU profiling, Firefox runtime, worker suspension, external attack suites and dependency reachability still need work. The prior release recorded four high-severity dependency entries; this turn does not claim to clear that backlog. The signed local event chain is not distributed blockchain or a prompt-injection detector. Approved destination webpages can read filled values. The railway remains a labelled simulation with a declared local adapter, not live IRCTC.

## Reproduction

Run START.command, then from the repository root:

~~~sh
npm run lint
npm test
.venv/bin/ruff check server
.venv/bin/pytest server/tests
npm run release
CONTEXTSHIELD_EXTENSION_DIR=../release/ContextShield-Chrome CONTEXTSHIELD_E2E_VISUAL=1 npm run test:e2e --workspace @contextshield/extension -- tests/visualDecision.spec.ts
CONTEXTSHIELD_EXTENSION_DIR=../release/ContextShield-Chrome CONTEXTSHIELD_E2E_LIVE=1 npm run test:e2e --workspace @contextshield/extension -- tests/judgeDemo.spec.ts --grep 'three-minute story' --repeat-each=3
CONTEXTSHIELD_EXTENSION_DIR=../release/ContextShield-Chrome CONTEXTSHIELD_E2E_AUDIT=1 npm run test:e2e --workspace @contextshield/extension -- tests/freshAudit.spec.ts
node scripts/write-final-validation.mjs
~~~

Run the suites sequentially for the resource measurement. The visual command currently exits nonzero because it requires 6/6 success; do not discard the three stopped attempts. Evidence and code hashes: [summary](evidence/2026-09-19-final/summary.json), [visual results](evidence/2026-09-19-final/visual-decisions.json), [initial results](evidence/2026-09-19-final/visual-decisions-initial.json), [privacy/resources](evidence/2026-09-19-final/privacy-and-resources.json), [timings](evidence/2026-09-19-final/judge-repeats.json), [captured request](evidence/2026-09-19-final/planner-requests.json).

## Submission checklist

- Keep the six-slide PPT and exported PDF together with this report.
- Team ID is blank by explicit instruction. Enter the official ID before portal submission.
- The demo runs locally. Present the 3-minute judge workflow, then optionally show the canvas duration case and the blocked stale action.
- Use synthetic data and simulated payment only.
- This final local update has not been republished to GitHub. Deck links still identify the previously published baseline.
`;
await writeFile(resolve(root,'docs/FINAL-VALIDATION.md'),md);
process.stdout.write(JSON.stringify(summary,null,2)+'\n');
