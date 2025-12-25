#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

pids=()

cleanup() {
  if ((${#pids[@]})); then
    echo -e "\nStopping frontend dev processes..."
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

start_app() {
  local script=$1
  echo "Starting $script ..."
  pnpm run "$script" &
  pids+=($!)
}

start_app dev:signal-hub
start_app dev:signal-viewer
start_app dev:comms

wait
