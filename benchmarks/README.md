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
running, it also measures the two real Rampart/Qwen product scenarios and folds
their task-completion and latency results into `results/latest.json`.
