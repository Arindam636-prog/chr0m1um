#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

# Run START.command first. Never quietly substitute a mock model for the audit.
health="$(curl --silent --fail --max-time 3 http://127.0.0.1:8000/health)"
if [[ "$health" != *'"model_backend":"llama"'* || "$health" != *'"planner_ready":true'* ]]; then
  echo "Start the full stack using START.command, then run this audit again."
  exit 1
fi
npm run typecheck
npm test
.venv/bin/pytest server/tests
npm run release
export CONTEXTSHIELD_EXTENSION_DIR=../release/ContextShield-Chrome
export CONTEXTSHIELD_E2E_LIVE=1
export CONTEXTSHIELD_E2E_AUDIT=1
npm run test:e2e --workspace @contextshield/extension -- tests/compatibility.spec.ts
npm run test:e2e --workspace @contextshield/extension -- tests/freshAudit.spec.ts
PLAYWRIGHT_JSON_OUTPUT_FILE=../benchmarks/results/judge-repeats-playwright.json \
  npm run test:e2e --workspace @contextshield/extension -- tests/judgeDemo.spec.ts --grep 'three-minute story' --repeat-each=3 --reporter=list,json
PLAYWRIGHT_JSON_OUTPUT_FILE=../benchmarks/results/live-playwright.json \
  npm run test:e2e --workspace @contextshield/extension -- tests/live.spec.ts --reporter=list,json
CONTEXTSHIELD_INCLUDE_LIVE=1 npm run benchmark
npm run sync:demo-evidence
node scripts/write-fresh-audit-report.mjs
echo "Audit reports: benchmarks/results/. External practice sites are included only with CONTEXTSHIELD_E2E_EXTERNAL=1."
