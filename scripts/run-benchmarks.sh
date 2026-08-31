#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

npm test
.venv/bin/pytest server/tests
npm run build
npm run test:e2e --workspace @contextshield/extension -- tests/compatibility.spec.ts

live_benchmark=0
backend_health="$(curl --silent --fail --max-time 2 http://127.0.0.1:8000/health 2>/dev/null || true)"
if [[ "$backend_health" == *'"model_backend":"llama"'* ]] \
  && curl --silent --fail --max-time 2 http://127.0.0.1:8080/v1/models >/dev/null 2>&1 \
  && curl --silent --fail --max-time 2 http://127.0.0.1:4173/privacy-proof.html >/dev/null 2>&1; then
  CONTEXTSHIELD_E2E_LIVE=1 npm run test:e2e --workspace @contextshield/extension -- tests/live.spec.ts
  live_benchmark=1
else
  echo "Live Qwen benchmark skipped: start the full stack with ./START.sh first."
fi

CONTEXTSHIELD_INCLUDE_LIVE="$live_benchmark" npm run benchmark

echo "Wrote measured benchmark report to benchmarks/results/latest.json"
