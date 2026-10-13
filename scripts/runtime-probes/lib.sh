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

stop_runtime() {
  if [[ -n "$RUNTIME_PID" ]] && kill -0 "$RUNTIME_PID" 2>/dev/null; then
    kill -TERM -- "-$RUNTIME_PID" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$RUNTIME_PID" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL -- "-$RUNTIME_PID" 2>/dev/null || true
    wait "$RUNTIME_PID" 2>/dev/null || true
  fi
  RUNTIME_PID=''
}

cleanup_probe() {
  stop_runtime
  if [[ "${KEEP_PROBE_TMP:-0}" == 1 ]]; then
    echo "probe files retained at $PROBE_ROOT" >&2
  else
    rm -rf -- "$PROBE_ROOT"
  fi
}

new_session() {
  local working_dir=$1
  curl --silent --fail-with-body \
    -H 'content-type: application/json' \
    -d "$(jq -cn --arg wd "$working_dir" '{working_dir:$wd,safety_policy:"autonomous"}')" \
    "http://127.0.0.1:$PORT/api/sessions"
}

stream_turn() {
  local session_id=$1 agent=$2 prompt=$3 output=$4
  curl --silent --no-buffer --fail-with-body \
    -H 'content-type: application/json' \
    -d "$(jq -cn --arg prompt "$prompt" '{messages:[{role:"user",content:$prompt}]}')" \
    "http://127.0.0.1:$PORT/api/sessions/$session_id/agent/$agent" >"$output"
}
