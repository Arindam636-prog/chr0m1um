#!/usr/bin/env bash
set -euo pipefail

check_service() {
  local name="$1"
  local url="$2"
  if curl --silent --fail --max-time 3 "$url" >/dev/null 2>&1; then
    echo "READY  $name"
  else
    echo "OFFLINE $name"
    return 1
  fi
}

status=0
check_service "Qwen planner" "http://127.0.0.1:8080/v1/models" || status=1
check_service "Agent backend" "http://127.0.0.1:8000/health" || status=1
check_service "Demo website" "http://127.0.0.1:4173" || status=1
exit "$status"
