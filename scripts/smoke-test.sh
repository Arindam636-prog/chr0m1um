#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

curl --fail --silent --show-error http://127.0.0.1:8000/health
echo
npm run build >/dev/null
test -f extension/.output/chrome-mv3/manifest.json
test -f extension/.output/firefox-mv3/manifest.json || npm run build:firefox >/dev/null
echo "ContextShield smoke test passed."
