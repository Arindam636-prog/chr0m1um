#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

command -v node >/dev/null || { echo "Node.js 22+ is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "Python 3.11-3.14 is required" >&2; exit 1; }

npm ci
npm run prepare:extension
npx playwright install chromium
CONTEXTSHIELD_MODEL_MANIFEST="$repo_dir/models/rampart-browser.json" ./scripts/download-models.sh

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r server/requirements.txt

echo "ContextShield setup complete."
echo "Start the server with ./scripts/start-server.sh"
