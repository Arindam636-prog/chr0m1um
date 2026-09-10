#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
runtime_dir="$repo_dir/data/run"
mkdir -p "$runtime_dir"
cd "$repo_dir"

backend_owned=0
server_pid=""
demo_owned=0
demo_pid=""
qwen_owned=0
qwen_pid=""
planner_mode="llama"
open_browser=1
check_only=0
startup_succeeded=0
launch_domain="gui/$(id -u)"
qwen_label="local.contextshield.qwen"
backend_label="local.contextshield.agent"
demo_label="local.contextshield.demo"
service_runtime_root="${CONTEXTSHIELD_SERVICE_RUNTIME:-$HOME/Library/Application Support/ContextShield}"
service_log_root="$runtime_dir"
if [[ "$(uname -s)" == "Darwin" ]]; then
  service_log_root="$service_runtime_root/logs"
fi
mkdir -p "$service_log_root"
qwen_log="$service_log_root/qwen.log"
server_log="$service_log_root/server.log"
demo_log="$service_log_root/demo.log"

prepare_service_runtime() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    return
  fi
  mkdir -p "$service_runtime_root/server" "$service_runtime_root/demo" \
    "$service_runtime_root/data"
  rsync -a --delete "$repo_dir/server/" "$service_runtime_root/server/"
  rsync -a --delete "$repo_dir/demo/" "$service_runtime_root/demo/"
  rsync -a --delete "$repo_dir/.venv/" "$service_runtime_root/.venv/"
}

start_background_service() {
  local label="$1"
  local log_file="$2"
  shift 2
  if [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1; then
    launchctl remove "$label" >/dev/null 2>&1 || true
    launchctl submit -l "$label" -o "$log_file" -e "$log_file" -- \
      /usr/bin/env "PATH=$PATH" "$@"
    local process_id=""
    for _ in {1..50}; do
      process_id="$(launchctl print "$launch_domain/$label" 2>/dev/null | awk '/^[[:space:]]*pid = / {print $3; exit}')"
      if [[ "$process_id" =~ ^[0-9]+$ ]]; then
        printf '%s\n' "$process_id"
        return 0
      fi
      sleep 0.1
    done
    return 1
  fi
  nohup "$@" >"$log_file" 2>&1 </dev/null &
  printf '%s\n' "$!"
}

remove_background_service() {
  local label="$1"
  if [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1; then
    launchctl remove "$label" >/dev/null 2>&1 || true
  fi
}

background_service_running() {
  local label="$1"
  local process_id="$2"
  if [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1; then
    local service_state
    service_state="$(launchctl print "$launch_domain/$label" 2>/dev/null || true)"
    [[ "$service_state" =~ state[[:space:]]*=[[:space:]]*(running|xpcproxy) ]]
    return $?
  fi
  kill -0 "$process_id" 2>/dev/null
}

refresh_service_pid_file() {
  local label="$1"
  local pid_file="$2"
  if [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1; then
    local current_pid
    current_pid="$(launchctl print "$launch_domain/$label" 2>/dev/null | awk '/^[[:space:]]*pid = / {print $3; exit}')"
    if [[ "$current_pid" =~ ^[0-9]+$ ]]; then
      printf '%s\n' "$current_pid" >"$pid_file"
    fi
  fi
}

for argument in "$@"; do
  case "$argument" in
    --mock) planner_mode="mock" ;;
    --no-open) open_browser=0 ;;
    --check-only) check_only=1 ;;
    *) echo "Unknown option: $argument" >&2; exit 1 ;;
  esac
done

cleanup() {
  trap - EXIT INT TERM
  if [[ "$startup_succeeded" == "1" ]]; then
    return
  fi
  if [[ "$backend_owned" == "1" && -n "$server_pid" ]]; then
    remove_background_service "$backend_label"
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    rm -f "$runtime_dir/server.pid"
  fi
  if [[ "$demo_owned" == "1" && -n "$demo_pid" ]]; then
    remove_background_service "$demo_label"
    kill "$demo_pid" 2>/dev/null || true
    wait "$demo_pid" 2>/dev/null || true
    rm -f "$runtime_dir/demo.pid"
  fi
  if [[ "$qwen_owned" == "1" && -n "$qwen_pid" ]]; then
    remove_background_service "$qwen_label"
    kill "$qwen_pid" 2>/dev/null || true
    wait "$qwen_pid" 2>/dev/null || true
    rm -f "$runtime_dir/qwen.pid"
  fi
  echo "Startup did not finish; newly started services were cleaned up." >&2
}

trap cleanup EXIT INT TERM

echo
echo "========================================"
echo " Starting ContextShield"
echo "========================================"
echo

if [[ ! -d node_modules || ! -x .venv/bin/uvicorn || ! -d node_modules/@tailwindcss/vite || ! -d node_modules/motion ]]; then
  echo "First run detected. Installing the required packages..."
  ./scripts/setup.sh
fi

echo "Building the judge website..."
npm run build:judge >/dev/null

if [[ -f benchmarks/results/latest.json ]]; then
  node scripts/sync-demo-evidence.mjs >/dev/null
fi

prepare_service_runtime

if [[ ! -f release/ContextShield-Chrome/manifest.json ]]; then
  echo "Creating the stable extension release (first run only)..."
  ./scripts/make-release.sh >/dev/null
fi
echo "Stable extension release is ready. Normal startup will not modify it."

if [[ "$planner_mode" == "llama" ]]; then
  if ! command -v llama-server >/dev/null 2>&1 && ! command -v llama >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      echo "Installing the local Qwen runner (one-time setup)..."
      brew install llama.cpp
    else
      echo "llama.cpp is required for Qwen and could not be installed automatically." >&2
      echo "Install llama.cpp, then run ./START.sh again." >&2
      exit 1
    fi
  fi

  if curl --silent --fail --max-time 2 http://127.0.0.1:8080/v1/models >/dev/null 2>&1; then
    echo "Local Qwen is already running."
  elif lsof -tiTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 8080 is being used by another program." >&2
    echo "Close that program, then run ./START.sh again." >&2
    exit 1
  else
    echo "Starting Qwen3-VL locally..."
    echo "The first run downloads about 3 GB once. This can take several minutes."
    if [[ "$(uname -s)" == "Darwin" ]]; then
      qwen_command="$(command -v llama-server || command -v llama)"
      qwen_arguments=(
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
      if [[ "$(basename "$qwen_command")" == "llama" ]]; then
        qwen_pid="$(start_background_service "$qwen_label" "$qwen_log" \
          "$qwen_command" serve "${qwen_arguments[@]}")"
      else
        qwen_pid="$(start_background_service "$qwen_label" "$qwen_log" \
          "$qwen_command" "${qwen_arguments[@]}")"
      fi
    else
      qwen_pid="$(start_background_service "$qwen_label" "$qwen_log" "$repo_dir/scripts/start-llama.sh")"
    fi
    echo "$qwen_pid" >"$runtime_dir/qwen.pid"
    qwen_owned=1
    for attempt in {1..1800}; do
      if curl --silent --fail --max-time 2 http://127.0.0.1:8080/v1/models >/dev/null 2>&1; then
        echo "Qwen is ready."
        break
      fi
      if (( attempt > 10 )) && ! background_service_running "$qwen_label" "$qwen_pid"; then
        echo "Qwen stopped while starting. Last log lines:" >&2
        tail -n 30 "$qwen_log" >&2 || true
        exit 1
      fi
      if (( attempt % 15 == 0 )); then
        echo "Still preparing Qwen... ($attempt seconds)"
      fi
      sleep 1
    done
    if ! curl --silent --fail --max-time 2 http://127.0.0.1:8080/v1/models >/dev/null 2>&1; then
      echo "Qwen did not become ready within 30 minutes. See $qwen_log" >&2
      exit 1
    fi
    refresh_service_pid_file "$qwen_label" "$runtime_dir/qwen.pid"
  fi
fi

backend_health="$(curl --silent --fail --max-time 2 http://127.0.0.1:8000/health 2>/dev/null || true)"
if [[ -n "$backend_health" ]]; then
  running_backend="$(printf '%s' "$backend_health" | .venv/bin/python -c 'import json,sys; print(json.load(sys.stdin).get("model_backend", "unknown"))' 2>/dev/null || echo unknown)"
  if [[ "$running_backend" != "$planner_mode" ]]; then
    echo "A ContextShield backend is already running in $running_backend mode." >&2
    echo "Run ./STOP.sh, then run ./START.sh again." >&2
    exit 1
  fi
  echo "Backend is already running in $running_backend mode."
elif lsof -tiTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 8000 is being used by another program." >&2
  echo "Close that program, then run ./START.sh again." >&2
  exit 1
else
  echo "Starting the private local backend..."
  if [[ "$(uname -s)" == "Darwin" ]]; then
    server_pid="$(start_background_service "$backend_label" "$server_log" \
      /usr/bin/env MODEL_BACKEND="$planner_mode" DATABASE_PATH="$service_runtime_root/data/contextshield.sqlite3" \
      "$service_runtime_root/.venv/bin/python" -m uvicorn app.main:app \
      --app-dir "$service_runtime_root/server" --host 127.0.0.1 --port 8000)"
  else
    server_pid="$(start_background_service "$backend_label" "$server_log" \
      /usr/bin/env MODEL_BACKEND="$planner_mode" SERVER_RELOAD=0 "$repo_dir/scripts/start-server.sh")"
  fi
  echo "$server_pid" >"$runtime_dir/server.pid"
  backend_owned=1
fi

if curl --silent --fail --max-time 2 http://127.0.0.1:4173 >/dev/null 2>&1; then
  echo "Demo website is already running."
elif lsof -tiTCP:4173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 4173 is being used by another program." >&2
  echo "Close that program, then run ./START.sh again." >&2
  exit 1
else
  echo "Starting the demo website..."
  if [[ "$(uname -s)" == "Darwin" ]]; then
    demo_pid="$(start_background_service "$demo_label" "$demo_log" \
      /usr/bin/python3 -m http.server 4173 --bind 127.0.0.1 \
      --directory "$service_runtime_root/demo")"
  else
    demo_pid="$(start_background_service "$demo_label" "$demo_log" "$repo_dir/scripts/start-demo.sh")"
  fi
  echo "$demo_pid" >"$runtime_dir/demo.pid"
  demo_owned=1
fi

wait_for_url() {
  local name="$1"
  local url="$2"
  local log_file="$3"
  for _ in {1..30}; do
    if curl --silent --fail --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "$name did not start. Last log lines:" >&2
  tail -n 20 "$log_file" >&2 || true
  return 1
}

if [[ "$backend_owned" == "1" ]]; then
  wait_for_url "Backend" "http://127.0.0.1:8000/health" "$server_log"
  refresh_service_pid_file "$backend_label" "$runtime_dir/server.pid"
fi
if [[ "$demo_owned" == "1" ]]; then
  wait_for_url "Demo website" "http://127.0.0.1:4173" "$demo_log"
  refresh_service_pid_file "$demo_label" "$runtime_dir/demo.pid"
fi

echo
echo "========================================"
echo " ContextShield is running"
echo "========================================"
echo
echo "1. Install release/ContextShield-Chrome once from chrome://extensions."
echo "   After this v1.4.0 update, reload the unpacked extension once."
echo "2. The judge control room opens at: http://127.0.0.1:4173"
if [[ "$planner_mode" == "llama" ]]; then
  echo "3. Confirm that it shows Agent API Online and Qwen3-VL ready."
else
  echo "3. Confirm that it shows Agent API Online and Predictable mock planner."
fi
echo "4. Three-minute demo: http://127.0.0.1:4173/judge-run.html"
echo "   Open the extension, click Use demo task, then Start agent."
echo
if [[ "$planner_mode" == "llama" ]]; then
  echo "Planner: real local Qwen3-VL"
else
  echo "Planner: predictable mock mode (requested with --mock)"
fi
echo "Visual privacy: local YOLOX face detection + PP-OCR"
echo "You can close Terminal now; the services stay running in the background."
echo "To stop them later, double-click STOP.command or run ./STOP.sh."
echo

if [[ "$open_browser" == "1" ]] && command -v open >/dev/null 2>&1; then
  open http://127.0.0.1:4173
fi

startup_succeeded=1
exit 0
