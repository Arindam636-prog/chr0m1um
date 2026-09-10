#!/usr/bin/env bash
set -euo pipefail

server_arguments=(
  --hf-repo Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M
  --alias qwen3-vl-4b-instruct
  --host 127.0.0.1
  --port 8080
  --ctx-size 8192
  --image-min-tokens 256
  --cache-ram 512
  --parallel 1
  --jinja
)

if command -v llama-server >/dev/null 2>&1; then
  exec llama-server "${server_arguments[@]}"
fi

if command -v llama >/dev/null 2>&1; then
  exec llama serve "${server_arguments[@]}"
fi

echo "llama.cpp is not installed or is not on PATH." >&2
echo "On macOS run: brew install llama.cpp" >&2
echo "Then rerun: ./scripts/start-llama.sh" >&2
exit 1
