# Final submission evidence: ContextShield

Generated 2026-09-19T14:23:47.375Z. Official problem statement: **SIH26171**, On-device Visual Perception for Light-weight Browser Agents. This is an evidence-backed submission snapshot, not production certification or a prediction of SIH selection.

Publication note, 7 November 2026: the numbers below remain the September
measurements and retain their original source hashes. Later demo changes and
current regression checks are recorded separately in
[PUBLICATION-2026-11-07.md](PUBLICATION-2026-11-07.md).

## Five evaluation areas

| PS area | Measured result | Boundary |
| --- | --- | --- |
| Visual context, 25% | 3/6 authored canvas tasks complete | 3 correct choices, 3 privacy stops before transmission. Numeric values absent from visible DOM. Not unseen websites or a paired DOM-only agent accuracy baseline. |
| PII, 20% | 68.4% precision, 100.0% recall | 11 synthetic pages; case/type micro scoring: 13 TP, 6 FP, 0 FN. Not exact entity/span detection. |
| Redaction, 20% | 4/4 crops fully cover annotations | Two canvas secrets, one synthetic portrait at two sizes. Public background/text is also masked. |
| Client resources, 20% | 2.60 GiB active browser peak vs 0.88 GiB baseline | Whole process trees. 1.72 GiB difference of observed peaks is not isolated extension allocation. |
| Latency, 15% | 52.74 s median; 3/3 judge tasks complete | Cold client models, already-running Qwen. Range 47.89–61.14 s. Three runs only. |

These results do not convert directly into marks. The weights are official judging weights, not pass thresholds. Hardware: Apple M4, 10 logical CPUs, 24.00 GiB host RAM, darwin.

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

The initial visual suite completed 1/6 cases. After fixes it completes 3/6. All three duration choices are correct and complete. In all three INR price cases, Rampart misclassifies the word “lowest” and public prices. The guard now stops before sending an altered task, with no choice clicked. **The six-case all-success gate still fails.** Privacy thresholds were not weakened to inflate task success. This fixture has informed fixes and is a regression set, not a held-out benchmark.

## Privacy evidence and methodology

The repeated judge workflow captured 9 actual /v1/agent/start and /step request bodies through Playwright browser network events. All three authored canaries (name, email and password) were absent from these bodies. The face-centre pixel was black in the proof image; the accompanying outgoing PNG is decoded from the actual request. This check does not cover all traffic destinations, indirect inference, transformed/partial secrets, or a compromised extension/device. It is not an independent third-party network audit.

PII precision = TP/(TP+FP), recall = TP/(TP+FN). A type present several times within one page counts once. Extra conservative classifications count against precision. The four redaction cases compare black mask pixels to authored secret glyph regions and approximate face rectangles. All annotated sensitive pixels are covered. The combined black-mask overlap ratio is 40.5%; this mixes annotation styles and is not a population redaction-precision score.

Resources use ps over each Chromium process tree. The baseline renders the same pages without the extension; active includes the popup, workers and inference. Separate observed peaks do not isolate extension allocation. CPU readings are process-lifetime averages, not interval CPU overhead. GPU-process RSS is not GPU VRAM. No low-end-device guarantee follows from this measurement.

Latency uses the extension task timer, excluding browser launch and screenshot capture. Median is the middle sorted successful duration. p95 uses linear interpolation: 60.30 s on only three successful samples. Failures remain in completion denominators, even though latency is success-only. Do not compare this directly with the old mixed local-only 3.67 s number.

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
~~~

Run the suites sequentially for the resource measurement. The visual command currently exits nonzero because it requires 6/6 success; do not discard the three stopped attempts. Evidence and code hashes: [summary](evidence/2026-09-19-final/summary.json), [visual results](evidence/2026-09-19-final/visual-decisions.json), [initial results](evidence/2026-09-19-final/visual-decisions-initial.json), [privacy/resources](evidence/2026-09-19-final/privacy-and-resources.json), [timings](evidence/2026-09-19-final/judge-repeats.json), [captured request](evidence/2026-09-19-final/planner-requests.json).

`scripts/write-final-validation.mjs` is retained as the original September
exporter. It refuses later dates so fresh runs cannot overwrite this historical
snapshot or reuse its fixed narrative. Record new measurements in a separately
dated report and keep every failed attempt in its completion denominator.

## Submission checklist

- Keep the six-slide PPT and exported PDF together with this report.
- The current October PPTX contains Team ID 155772. Preserve the official title-slide format.
- The demo runs locally. Present the 3-minute judge workflow, then optionally show the canvas duration case and the blocked stale action.
- Use synthetic data and simulated payment only.
- The November publication includes this dated evidence and the later demo source. It does not turn the September measurements into a new benchmark.
