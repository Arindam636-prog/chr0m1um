# ContextShield — fresh audit results

Generated 2026-09-04T17:36:02.906Z. Team Chr0m1um / PS 26171.

## Bottom line

The new real-model privacy regression audit completed 11/11 synthetic pages. The final repeated Qwen judge workflow passed 3/3 attempts. These are controlled regression results, NOT universal website compatibility or a complete validation of all SIH metrics.

## The five PS metrics

| Metric / PS weight | Fresh result | What it means and what it does not |
| --- | --- | --- |
| Visual context / 25% | 168/168 expected controls found across 61 scenarios | DOM/ARIA control recall. Not general screen understanding, OCR accuracy, or reviewed detector box accuracy. |
| PII detection / 20% | 68.4% precision; 100.0% recall at case/type level | 13 correct type predictions, 6 extra type predictions, 0 missing expected types. Real DOM/YOLOX/OCR/Rampart pipeline, 11 synthetic pages. Includes conservative policy classifications; NOT exact entity/span precision. |
| Redaction / 20% | 4/4 actual crops completely cover their annotations | Two known canvas secrets and one portrait at two sizes. Approximate face boxes; broader masking remains. This is annotated coverage, not a population redaction-precision score. |
| Client resources / 20% | 2.57 GiB active Chromium peak vs 0.86 GiB baseline | Difference of observed peaks: 1.71 GiB. Includes browser, popup, models and workers; not isolated extension allocation. GPU-process RSS is NOT VRAM. |
| Task latency / 15% | Median 51.87 s; observed range 34.75 s–53.92 s | 3/3 real Qwen judge tasks passed. Cold client models, already-running server. Task timer excludes browser setup/screenshots; no confirmation wait. Only three samples. |

Weights are not pass thresholds and do not provide a formula for converting these results into marks out of 100.

## Bugs found and fixes made

1. **Canvas name left readable in a crop:** contextual PII filtering previously applied to text records but not to image masks. Image masking now also uses Rampart's OCR-text classifications before encoding a crop. The same offscreen model instance is reused.
2. **Masks too tight:** face masks now include proportional padding. OCR masks include line-height-scaled margins to account for downscaling and clipped glyph edges. This improves coverage at the cost of some extra masking.
3. **Unnecessary post-completion planning / timeout:** the first repeated judge test passed only 1/3 attempts. The planner prompt now omits absent metadata, explicitly states the current numeric-price comparison, and instructs the model to stop when the requested result is visible. Current final repeats: 3/3. No deadline or privacy validation was disabled, and no successful result was fabricated.
4. **Misleading benchmark labels:** server round trips are no longer labelled model inference time. Local-only and server-assisted latency are separated. Failed attempts stay in denominators. Website evidence cards show the scoped full-pipeline findings, including extra alerts.
5. **Filled input re-read by OCR:** DemoQA exposed a first name in the prepared context via OCR even though the DOM value stayed local. Filled text inputs are now blacked out before OCR and in overlapping outgoing crops. Single-word names are classified using input metadata. The existing known-secret network guard was not disabled.
6. **Server resource defaults:** the runner previously forced a minimum of 1024 image tokens and allowed llama.cpp's default 8192 MiB prompt cache. Minimum image tokens are now 256 (not a maximum); prompt cache is capped at 512 MiB. Larger images may still use more tokens. Final task timings use these settings; no arbitrary timeout increase was made.

The corpus exposed bugs and was then used to fix them: it is now a regression corpus, not an untouched held-out evaluation set.

## Actual pixel checks

| Fixture | Annotated sensitive pixels covered | Entire crop masked |
| --- | --- | --- |
| canvas-email | 2210/2210 (100.0%) | 15.7% |
| canvas-narrative | 1014/1014 (100.0%) | 14.8% |
| portrait-large | 18250/18250 (100.0%) | 34.0% |
| portrait-small | 4599/4599 (100.0%) | 38.1% |

Canvas annotations use the authored secret's measured glyph positions, not the entire sentence: public prefix/suffix text is excluded from ground truth. The initial diagnostic report counted all sentence glyphs, so its text percentages are not directly comparable to this corrected secret-only annotation. The original canvas-name defect had zero masking anywhere in the crop. Face annotations are unchanged. Wider masks cover some non-sensitive text/background; these tests do not establish production redaction precision.

All 13 known exact test strings were absent from the prepared text context. Exact-string absence alone does not prove absence of partial or indirect identifying information. The Qwen judge test additionally intercepts actual planning request bodies and checks its known synthetic name/email/password strings; it checks the actual displayed crop's face-center pixels and final page values.

## Browser regressions

| Test | Result | Whole-test duration, not pure agent latency |
| --- | --- | --- |
| detects visible interactables across representative and extension-injected website patterns | PASS | 5.33 s |
| shipped controls still run locally and a stale action still stops | PASS | 6.81 s |
| completes the real checkout with Rampart and the local Qwen backend | PASS | 25.22 s |
| summarizes the real privacy proof without sending raw private values | PASS | 3.95 s |
| stops the real mutation demo on the first stale action | PASS | 2.81 s |
| completes general dropdown, checkbox, and radio controls (local control task) | PASS | 4.82 s |
| completes the reported WebDriver University form (local control task) | PASS | 6.43 s |
| fills the reported DemoQA practice form and obeys do not submit | PASS | 10.19 s |
| submits the completed DemoQA form after local confirmation and verifies the delayed modal | PASS | 12.51 s |
| completes the reported Herokuapp ordinal checkbox task (local control task) | PASS | 11.02 s |
| completes the Selenium official generic web form without submitting | PASS | 5.36 s |
| judge view renders real-shaped sanitized data, delivery states and freeze control without originals | PASS | 4.50 s |

External availability can change. Practice-site tests use fake values; simple controls can complete locally and are not evidence of Qwen latency. Chrome was runtime-tested. Firefox was built, not runtime-tested.

## Remaining shortcomings

- **False positives:** public control/product text and OCR misreadings still cause extra privacy flags. Uncertain findings remain protected and marked for review; they were not removed to inflate precision.
- **Memory:** local inference adds substantial browser memory on this machine. This is not yet a low-end-device resource guarantee.
- **Generalization:** no independent, human-reviewed multi-person/document corpus or broad entity-span evaluation was completed. Two portrait sizes are not two independent faces.
- **Latency:** server planning dominates and varied substantially over three runs. Sample p95 is 53.71 s, but three runs do not reliably estimate tail latency.
- **Metrics quality:** CPU samples are process-lifetime averages, not interval CPU utilization. Baseline/active runs have different work durations; their averages cannot be treated as a controlled CPU overhead ratio.

## Environment and reproduction

- Apple M4, 10 logical CPUs, 24.00 GiB host memory, darwin.
- Packaged Chrome extension v1.4.0. Background SHA-256: `106510c54c5709d4c11293e12ee6d863232891958e9d83bd941e25f0f963fe04`.
- Planner source SHA-256: `5361d89238be15e741ef0cc31df24b580f0a41a847d845f8530b6885723655e2`.
- Full local models: YOLOX face, PP-OCR, Rampart; server: Qwen3-VL-4B through llama.cpp.
- Raw evidence: [privacy audit](../benchmarks/results/fresh-audit.json), [component report](../benchmarks/results/latest.json), [final judge repeats](../benchmarks/results/judge-repeats-playwright.json), [browser regressions](../benchmarks/results/live-playwright.json).
- Preserved diagnostics: [privacy before fixes](../benchmarks/results/fresh-audit-before-fixes.json), [judge repeats before planner fix](../benchmarks/results/judge-repeats-before-planner-fix.json).

Start the current stack with START.command, then run `npm run audit:fresh` from the project folder. For public practice-site coverage, run `CONTEXTSHIELD_E2E_EXTERNAL=1 npm run audit:fresh`. Outputs are retained under benchmarks/results. Reload the unpacked Chrome extension after replacing/rebuilding release/ContextShield-Chrome.
