#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/lib.sh"
install_probe_traps

if [[ "${CLEANUP_BOUNDS_CHILD:-0}" == 1 ]]; then
  cat >"$AGENTS_DIR/cleanup-probe.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Use shell to run exactly `sleep 60`, then answer DONE.
    toolsets: [{type: shell}]
EOF
  start_standalone_runtime inherited
  session_id=$(new_session "$WORK_DIR" | jq -r .id)
  stream_turn "$session_id" cleanup-probe 'Run the interrupted cleanup probe.' "$PROBE_ROOT/cleanup.sse" &
  for _ in $(seq 1 100); do
    grep -q '"type":"tool_call"' "$PROBE_ROOT/cleanup.sse" 2>/dev/null && break
    sleep 0.1
  done
  grep -q '"type":"tool_call"' "$PROBE_ROOT/cleanup.sse" || { echo 'cleanup probe tool did not start' >&2; exit 1; }
  track_runtime_descendants
  printf '%s\n%s\n' "$RUNTIME_PID" "$RUNTIME_DESCENDANTS" | awk 'NF && !seen[$1]++' >"$CLEANUP_PID_FILE"
  kill -TERM $$
  exit 99
fi

pid_file="$PROBE_ROOT/cleanup.pids"
started=$SECONDS
set +e
timeout 12 env CLEANUP_BOUNDS_CHILD=1 CLEANUP_PID_FILE="$pid_file" bash "$0"
status=$?
set -e
elapsed=$((SECONDS - started))
[[ "$status" == 143 ]] || { echo "interrupted probe exited $status, expected 143" >&2; exit 1; }
[[ "$elapsed" -lt 12 ]] || { echo 'interrupted probe exceeded cleanup bound' >&2; exit 1; }
survivors=''
while read -r pid; do
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && survivors+=" $pid"
done <"$pid_file"
[[ -z "$survivors" ]] || { echo "cleanup left processes:$survivors" >&2; exit 1; }
jq -n --argjson exit_status "$status" --argjson elapsed_seconds "$elapsed" \
  '{case:"TERM during inherited-runtime probe",exit_status:$exit_status,elapsed_seconds:$elapsed_seconds,survivors:[]}' \
  >"$(dirname "$0")/fixtures/cleanup-bounds.json"
format_fixture "$(dirname "$0")/fixtures/cleanup-bounds.json"
