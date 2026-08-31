#!/usr/bin/env bash
set -uo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

ready_count=0
warning_count=0
missing_count=0
full_missing_count=0

ready() {
  ready_count=$((ready_count + 1))
  echo "[READY]   $1"
}

warning() {
  warning_count=$((warning_count + 1))
  echo "[OPTIONAL] $1"
}

missing() {
  missing_count=$((missing_count + 1))
  echo "[MISSING] $1"
}

full_missing() {
  full_missing_count=$((full_missing_count + 1))
  echo "[FULL-SPEC MISSING] $1"
}

echo "ContextShield setup doctor"
echo

if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if [[ "$node_major" -ge 22 ]]; then
    ready "Node.js $(node --version)"
  else
    missing "Node.js 22+ is required; found $(node --version)"
  fi
else
  missing "Node.js 22+"
fi

if command -v npm >/dev/null 2>&1; then
  ready "npm $(npm --version)"
else
  missing "npm"
fi

if command -v python3 >/dev/null 2>&1; then
  python_version="$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
  if python3 -c 'import sys; raise SystemExit(0 if (3, 11) <= sys.version_info[:2] <= (3, 14) else 1)'; then
    ready "Python $python_version"
  else
    missing "Python 3.11-3.14 is required; found $python_version"
  fi
else
  missing "Python 3.11-3.14"
fi

if [[ -d node_modules && -x .venv/bin/python ]]; then
  ready "JavaScript and Python dependencies"
else
  missing "Dependencies; run ./scripts/setup.sh"
fi

if [[ -f extension/.output/chrome-mv3/manifest.json ]]; then
  ready "Chrome extension build"
else
  missing "Chrome build; run npm run build"
fi

if [[ -f extension/.output/firefox-mv3/manifest.json ]]; then
  ready "Firefox extension build"
else
  warning "Firefox build; run npm run build:firefox when needed"
fi

if curl --silent --fail --max-time 2 http://127.0.0.1:8000/health >/dev/null 2>&1; then
  ready "ContextShield backend is listening on 127.0.0.1:8000"
else
  missing "Backend is stopped; run ./scripts/start-server.sh"
fi

if curl --silent --fail --max-time 2 http://127.0.0.1:4173 >/dev/null 2>&1; then
  ready "Demo site is listening on 127.0.0.1:4173"
else
  missing "Demo site is stopped; run ./scripts/start-demo.sh"
fi

if command -v llama-server >/dev/null 2>&1 || command -v llama >/dev/null 2>&1; then
  ready "llama.cpp command for real local Qwen"
else
  full_missing "llama.cpp is absent; normal ./START.sh installs it with Homebrew on macOS"
fi

if curl --silent --fail --max-time 2 http://127.0.0.1:8080/v1/models >/dev/null 2>&1; then
  ready "Qwen/llama.cpp is listening on 127.0.0.1:8080"
else
  warning "Qwen is stopped; normal ./START.sh starts it automatically"
fi

if [[ -f extension/public/models/yolox-face.onnx ]]; then
  ready "Packaged YOLOX face model"
else
  full_missing "Packaged YOLOX face model"
fi

if [[ -f extension/public/models/rampart/onnx/model_q4.onnx ]]; then
  ready "Packaged offline Rampart contextual PII model"
else
  full_missing "Packaged Rampart model; rerun ./scripts/setup.sh"
fi

if [[ -f extension/public/models/ppocrv6-tiny-det.onnx && -f extension/public/models/ppocrv6-tiny-rec.onnx && -f extension/public/models/ppocrv6-tiny-dictionary.json ]]; then
  ready "Packaged PP-OCRv6-tiny detector, recognizer, and dictionary"
else
  full_missing "Packaged PP-OCRv6-tiny artifacts"
fi

if [[ -f extension/entrypoints/offscreen/main.ts && -f extension/lib/privacy/visualPrivacyScanner.ts ]]; then
  ready "Active screenshot, YOLOX, OCR, masking, and verification pipeline"
else
  full_missing "Active browser visual privacy pipeline"
fi

echo
echo "Summary: $ready_count ready, $missing_count core items missing, $full_missing_count full-spec visual items missing, $warning_count optional services stopped."
echo "Read docs/full-setup.md for the exact next command and a plain-English explanation."

if [[ "$missing_count" -gt 0 ]]; then
  exit 1
fi

if [[ "${1:-}" == "--full" && "$full_missing_count" -gt 0 ]]; then
  exit 2
fi
