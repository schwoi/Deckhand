#!/usr/bin/env bash

set -euo pipefail

export DOCKER_AGENT_HIDE_TELEMETRY_BANNER=1

PROBE_ROOT=${PROBE_ROOT:-$(mktemp -d /tmp/deckhand-runtime-probe.XXXXXX)}
AGENTS_DIR="$PROBE_ROOT/agents"
WORK_DIR="$PROBE_ROOT/work"
DATA_DIR="$PROBE_ROOT/data"
SESSION_DB="$PROBE_ROOT/session.db"
RUNTIME_LOG="$PROBE_ROOT/runtime.log"
RUNTIME_PID=''
RUNTIME_LAUNCH_MODE=''
RUNTIME_DESCENDANTS=''
PORT=''
PLUGIN_BIN=${PLUGIN_BIN:-$HOME/.docker/cli-plugins/docker-agent}

mkdir -p "$AGENTS_DIR" "$WORK_DIR" "$DATA_DIR"

allocate_port() {
  bun -e 'const s=Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}}); console.log(s.port); s.stop()'
}

start_runtime() {
  local extra_args=("$@")
  PORT=$(allocate_port)
  setsid docker agent serve api "$AGENTS_DIR" \
    --listen "127.0.0.1:$PORT" \
    --session-db "$SESSION_DB" \
    --data-dir "$DATA_DIR" \
    "${extra_args[@]}" >"$RUNTIME_LOG" 2>&1 &
  RUNTIME_PID=$!
  RUNTIME_LAUNCH_MODE=detached
  for _ in $(seq 1 100); do
    if curl --silent --fail "http://127.0.0.1:$PORT/api/ping" >/dev/null; then
      return
    fi
    if ! kill -0 "$RUNTIME_PID" 2>/dev/null; then
      sed -n '1,160p' "$RUNTIME_LOG" >&2
      return 1
    fi
    sleep 0.1
  done
  echo 'runtime did not become ready' >&2
  return 1
}

start_standalone_runtime() {
  local launch_mode=${1:-detached}
  PORT=$(allocate_port)
  local args=(serve api "$AGENTS_DIR" --listen "127.0.0.1:$PORT" --session-db "$SESSION_DB" --data-dir "$DATA_DIR")
  if [[ "$launch_mode" == detached ]]; then
    setsid "$PLUGIN_BIN" "${args[@]}" >"$RUNTIME_LOG" 2>&1 &
  else
    "$PLUGIN_BIN" "${args[@]}" >"$RUNTIME_LOG" 2>&1 &
  fi
  RUNTIME_PID=$!
  RUNTIME_LAUNCH_MODE=$launch_mode
  for _ in $(seq 1 100); do
    curl --silent --fail "http://127.0.0.1:$PORT/api/ping" >/dev/null && return
    if ! kill -0 "$RUNTIME_PID" 2>/dev/null; then
      sed -n '1,160p' "$RUNTIME_LOG" >&2
      return 1
    fi
    sleep 0.1
  done
  echo 'standalone runtime did not become ready' >&2
  return 1
}

redact_fixture() {
  sed -E "s#${HOME//\#/\\#}#~#g; s#/tmp/deckhand-runtime-probe\.[A-Za-z0-9]+#/tmp/deckhand-runtime-probe.REDACTED#g"
}

format_fixture() {
  bunx biome format --write "$@" >/dev/null
}

find_descendant() {
  local root=$1 pattern=$2 frontier=$1 children pid
  for _ in $(seq 1 8); do
    children=''
    for pid in $frontier; do children+=" $(pgrep -P "$pid" 2>/dev/null || true)"; done
    [[ -z "${children// /}" ]] && return 1
    pid=$(ps -p "$(tr ' ' ',' <<<"$children" | sed 's/^,*//;s/,*$//')" -o pid=,args= 2>/dev/null | awk -v p="$pattern" '$0 ~ p {print $1; exit}')
    [[ -n "$pid" ]] && { printf '%s\n' "$pid"; return; }
    frontier=$children
  done
  return 1
}

find_in_process_group() {
  local pgid=$1 command=$2
  ps -eo pid=,pgid=,comm= | awk -v g="$pgid" -v c="$command" '$2==g && $3==c {print $1; exit}'
}

runtime_descendants() {
  local frontier=${1:-$RUNTIME_PID} children='' pid
  while [[ -n "${frontier// /}" ]]; do
    children=''
    for pid in $frontier; do
      children+=" $(pgrep -P "$pid" 2>/dev/null || true)"
    done
    [[ -z "${children// /}" ]] && break
    printf '%s\n' $children
    frontier=$children
  done
}

track_runtime_descendants() {
  local descendants
  descendants=$(runtime_descendants "$RUNTIME_PID" || true)
  RUNTIME_DESCENDANTS=$(printf '%s\n%s\n' "$RUNTIME_DESCENDANTS" "$descendants" | awk 'NF && !seen[$1]++ {print $1}')
}

runtime_is_running() {
  local state
  state=$(ps -o stat= -p "$RUNTIME_PID" 2>/dev/null | tr -d ' ')
  [[ -n "$state" && "$state" != Z* ]]
}

wait_runtime_bounded() {
  local attempts=$1
  for _ in $(seq 1 "$attempts"); do
    runtime_is_running || return 0
    sleep 0.1
  done
  return 1
}

signal_runtime() {
  local signal=$1 pid
  track_runtime_descendants
  if [[ "$RUNTIME_LAUNCH_MODE" == detached ]]; then
    kill "-$signal" -- "-$RUNTIME_PID" 2>/dev/null || true
  else
    for pid in $RUNTIME_DESCENDANTS; do kill "-$signal" "$pid" 2>/dev/null || true; done
    kill "-$signal" "$RUNTIME_PID" 2>/dev/null || true
  fi
}

stop_runtime() {
  if [[ -n "$RUNTIME_PID" ]] && kill -0 "$RUNTIME_PID" 2>/dev/null; then
    signal_runtime TERM
    if ! wait_runtime_bounded 50; then
      signal_runtime KILL
      wait_runtime_bounded 20 || true
    fi
    if ! runtime_is_running; then wait "$RUNTIME_PID" 2>/dev/null || true; fi
  fi
  RUNTIME_PID=''
  RUNTIME_LAUNCH_MODE=''
  RUNTIME_DESCENDANTS=''
}

cleanup_probe() {
  stop_runtime
  if [[ "${KEEP_PROBE_TMP:-0}" == 1 ]]; then
    echo "probe files retained at $PROBE_ROOT" >&2
  else
    rm -rf -- "$PROBE_ROOT"
  fi
}

probe_exit() {
  local status=$?
  trap - EXIT INT TERM
  cleanup_probe
  exit "$status"
}

probe_signal() {
  local status=$1
  trap - EXIT INT TERM
  cleanup_probe
  exit "$status"
}

install_probe_traps() {
  trap probe_exit EXIT
  trap 'probe_signal 130' INT
  trap 'probe_signal 143' TERM
}

new_session() {
  local working_dir=$1 safety_policy=${2:-autonomous}
  curl --silent --fail-with-body \
    -H 'content-type: application/json' \
    -d "$(jq -cn --arg wd "$working_dir" --arg policy "$safety_policy" '{working_dir:$wd,safety_policy:$policy}')" \
    "http://127.0.0.1:$PORT/api/sessions"
}

stream_turn() {
  local session_id=$1 agent=$2 prompt=$3 output=$4
  curl --silent --no-buffer --fail-with-body \
    -H 'content-type: application/json' \
    -d "$(jq -cn --arg prompt "$prompt" '{messages:[{role:"user",content:$prompt}]}')" \
    "http://127.0.0.1:$PORT/api/sessions/$session_id/agent/$agent" >"$output"
}
