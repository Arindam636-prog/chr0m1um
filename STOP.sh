#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
runtime_dir="$repo_dir/data/run"
launch_domain="gui/$(id -u)"

stop_launch_service() {
  local label="$1"
  if [[ "$(uname -s)" != "Darwin" ]] || ! command -v launchctl >/dev/null 2>&1; then
    return 1
  fi
  if launchctl print "$launch_domain/$label" >/dev/null 2>&1; then
    launchctl remove "$label" >/dev/null 2>&1 || true
    return 0
  fi
  return 1
}

stop_owned_process() {
  local name="$1"
  local pid_file="$2"
  local expected_command="$3"
  local launch_label="$4"

  if stop_launch_service "$launch_label"; then
    rm -f "$pid_file"
    echo "$name stopped."
    return
  fi

  if [[ ! -f "$pid_file" ]]; then
    echo "$name was not started by ./START.sh; leaving it alone."
    return
  fi

  local process_id
  process_id="$(<"$pid_file")"
  if [[ ! "$process_id" =~ ^[0-9]+$ ]]; then
    echo "Ignoring an invalid $name PID file."
    rm -f "$pid_file"
    return
  fi

  local command_line
  command_line="$(ps -p "$process_id" -o command= 2>/dev/null || true)"
  if [[ -z "$command_line" ]]; then
    echo "$name is already stopped."
    rm -f "$pid_file"
    return
  fi

  if [[ "$command_line" != *"$expected_command"* ]]; then
    echo "The saved $name PID now belongs to another program; leaving it alone."
    rm -f "$pid_file"
    return
  fi

  kill "$process_id"
  rm -f "$pid_file"
  echo "$name stopped."
}

echo
echo "Stopping ContextShield services started by ./START.sh..."
stop_owned_process "Backend" "$runtime_dir/server.pid" "uvicorn app.main:app" "local.contextshield.agent"
stop_owned_process "Demo website" "$runtime_dir/demo.pid" "http.server 4173" "local.contextshield.demo"
if stop_launch_service "local.contextshield.qwen"; then
  rm -f "$runtime_dir/qwen.pid"
  echo "Local Qwen stopped."
elif [[ -f "$runtime_dir/qwen.pid" ]]; then
  qwen_command="$(ps -p "$(<"$runtime_dir/qwen.pid")" -o command= 2>/dev/null || true)"
  if [[ "$qwen_command" == *"llama-server"* || "$qwen_command" == *"llama serve"* ]]; then
    kill "$(<"$runtime_dir/qwen.pid")" 2>/dev/null || true
    rm -f "$runtime_dir/qwen.pid"
    echo "Local Qwen stopped."
  else
    rm -f "$runtime_dir/qwen.pid"
    echo "Saved Qwen process was not ours; leaving it alone."
  fi
else
  echo "Local Qwen was not started by ./START.sh; leaving it alone."
fi
echo "Done."
echo
