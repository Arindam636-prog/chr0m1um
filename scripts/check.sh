#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

npm run lint
npm test
npm run build
npm run build:firefox
npm run test:e2e
.venv/bin/ruff check server
.venv/bin/pytest server/tests

echo "All implemented ContextShield automated checks passed."
