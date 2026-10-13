#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/lib.sh"
trap cleanup_probe EXIT INT TERM

cat >"$AGENTS_DIR/team-probe.yaml" <<'EOF'
version: 16
budget:
  max_tokens: 100000
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Delegate the task to worker with transfer_task. After it returns, answer ROOT_DONE.
    sub_agents: [worker]
  worker:
    model: github-copilot/gpt-5.4-nano
    instruction: Answer CHILD_DONE immediately.
EOF

cat >"$AGENTS_DIR/limit-probe.yaml" <<'EOF'
version: 16
budget:
  max_tokens: 1
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Answer with a short sentence.
EOF

start_runtime
session_id=$(new_session "$WORK_DIR" | jq -r .id)
stream_turn "$session_id" team-probe 'Delegate this probe to worker.' "$PROBE_ROOT/team.sse"
limit_id=$(new_session "$WORK_DIR" | jq -r .id)
stream_turn "$limit_id" limit-probe 'Exceed the configured budget.' "$PROBE_ROOT/limit.sse" || true
stream_turn "$limit_id" limit-probe 'Try another turn after exhaustion.' "$PROBE_ROOT/limit-second.sse" || true
cat "$PROBE_ROOT/limit-second.sse" >>"$PROBE_ROOT/limit.sse"

jq -n \
  --argjson team_types "$(sed -n 's/^data: //p' "$PROBE_ROOT/team.sse" | jq -s '[.[].type] | unique')" \
  --argjson team_sessions "$(sed -n 's/^data: //p' "$PROBE_ROOT/team.sse" | jq -s '[.[]|select(.session_id)|{type,agent_name,session_id}]')" \
  --argjson token_usage "$(sed -n 's/^data: //p' "$PROBE_ROOT/team.sse" | jq -s '[.[]|select(.type=="token_usage")|{agent_name,session_id,usage}]')" \
  --argjson limit "$(sed -n 's/^data: //p' "$PROBE_ROOT/limit.sse" | jq -s '.')" \
  '{team_types:$team_types,team_session_fields:$team_sessions,token_usage:$token_usage,limit_events:$limit}'
cp "$PROBE_ROOT/team.sse" "${TEAM_OUT:-$(dirname "$0")/fixtures/subagent.sse}"
cp "$PROBE_ROOT/limit.sse" "${LIMIT_OUT:-$(dirname "$0")/fixtures/budget-exceeded.sse}"
