#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if [[ ! -x .venv/bin/uvicorn ]]; then
  echo "Missing .venv. Run ./scripts/setup.sh first." >&2
  exit 1
fi

server_arguments=(
  app.main:app
  --app-dir server
  --host "${SERVER_HOST:-127.0.0.1}"
  --port "${SERVER_PORT:-8000}"
)

if [[ "${SERVER_RELOAD:-1}" == "1" ]]; then
  server_arguments+=(--reload)
fi

exec .venv/bin/uvicorn "${server_arguments[@]}"
