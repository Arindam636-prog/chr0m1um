#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_dir"

curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8000/health >/dev/null
curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8080/v1/models >/dev/null
curl --fail --silent --show-error --max-time 3 http://127.0.0.1:4173/privacy-proof.html >/dev/null

npm run check
.venv/bin/ruff check server
.venv/bin/pytest server/tests
npm run test:e2e --workspace @contextshield/extension -- tests/compatibility.spec.ts
CONTEXTSHIELD_E2E_LIVE=1 npm run test:e2e --workspace @contextshield/extension -- tests/live.spec.ts
CONTEXTSHIELD_INCLUDE_LIVE=1 npm run benchmark

echo
echo "FULL RELEASE GATE PASSED"
echo "Report: $repo_dir/benchmarks/results/latest.json"
