# Benchmarks

Benchmark datasets and runners are introduced with their implementation targets:

- `context/`: perception recall and latency
- `pii/`: deterministic/contextual precision, recall, F1, false-positive rate
- `redaction/`: string and pixel leak regressions
- `performance/`: CPU, memory, GPU, privacy/model/end-to-end latency

Generated data belongs under `benchmarks/results/` and is ignored by Git. Metrics
must be calculated from raw run output; hard-coded scorecards are forbidden.

`./scripts/run-benchmarks.sh` runs the deterministic PII corpus and the real
Chrome compatibility corpus. When the full `./START.sh` stack is already
running, it also measures the controlled live-product scenarios and folds
their task-completion and latency results into `results/latest.json`.

`npm run audit:fresh` runs the extended packaged-release audit. Start the real
stack first. Main evidence files:

- `results/fresh-audit.json`: eleven authored synthetic pages through the real
  local pipeline, type-level classifications, exact known-string checks,
  actual decoded crop pixels, and paired whole-browser resource observations.
- `results/judge-repeat-{0,1,2}.json`: success OR failure for each real Qwen
  judge workflow attempt; `metrics.totalMs` is the actual task timer.
- `results/judge-repeats-playwright.json` and `results/live-playwright.json`:
  test outcomes including failures/skips, not just successful demonstrations.
- `results/latest.json`: scoped component metrics and mode-separated timings.

The pixel corpus uses one synthetic portrait at two sizes, with an approximate
face rectangle, and two canvas text fixtures with known secret glyph positions.
It is not a population face benchmark. Canvas ground truth excludes public
prefix/suffix text; line masks may deliberately cover those as well. Corpus
cases used to fix bugs become regression tests, not held-out evaluation data.

Do not convert these values into an SIH score: the PS gives weights, not a
normalization or pass threshold. Do not call a server round trip model inference
latency, a local task Qwen latency, or process RSS GPU VRAM.
