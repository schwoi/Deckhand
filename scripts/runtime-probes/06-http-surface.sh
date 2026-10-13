#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
trap cleanup_probe EXIT INT TERM

cat >"$AGENTS_DIR/surface-probe.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Use shell to run exactly `sleep 60`, then answer DONE.
    toolsets: [{type: shell}]
EOF

start_runtime
session_id=$(new_session "$WORK_DIR" | jq -r .id)
stream_turn "$session_id" surface-probe 'Run the active cancellation probe.' "$PROBE_ROOT/active.sse" &
stream_pid=$!
for _ in $(seq 1 600); do
  shell_pid=$(pstree -p "$RUNTIME_PID" | rg -o 'bash\([0-9]+' | rg -o '[0-9]+' | head -1 || true)
  sleep_pid=$(pstree -p "$RUNTIME_PID" | rg -o 'sleep\([0-9]+' | rg -o '[0-9]+' | head -1 || true)
  [[ -n "${sleep_pid:-}" ]] && break
  sleep 0.1
done
delete_response=$(curl --silent --show-error -w '\nHTTP %{http_code}\n' -X DELETE "http://127.0.0.1:$PORT/api/sessions/$session_id?wait=true&timeout=5s")
wait "$stream_pid" 2>/dev/null || true
sleep_alive=false
[[ -n "${sleep_pid:-}" ]] && kill -0 "$sleep_pid" 2>/dev/null && sleep_alive=true

jq -n --arg source_commit '5277e7842058fc3fbb9943a6e88bc05a1c8e6fe2' --arg source_file 'pkg/server/server.go:registerRoutes' --arg delete_response "$delete_response" --arg sleep_pid "${sleep_pid:-}" --argjson sleep_alive "$sleep_alive" \
  '{source_commit:$source_commit,source_file:$source_file,routes:{health:["GET /health","GET /ready"],api:["GET /api/agents","GET /api/agents/:id","GET /api/sessions","GET /api/sessions/:id","GET /api/sessions/:id/status","GET /api/sessions/:id/snapshot","POST /api/sessions/:id/resume","POST /api/sessions/:id/tools/toggle","PATCH /api/sessions/:id/safety-policy","PATCH /api/sessions/:id/permissions","PATCH /api/sessions/:id/title","PATCH /api/sessions/:id/tokens","PATCH /api/sessions/:id/starred","GET /api/sessions/:id/models","POST /api/sessions","POST /api/sessions/:id/fork","DELETE /api/sessions/:id","POST /api/sessions/:id/agent/:agent","POST /api/sessions/:id/agent/:agent/:agent_name","POST /api/sessions/:id/elicitation","POST /api/sessions/:id/steer","POST /api/sessions/:id/followup","GET /api/sessions/:id/events","POST /api/sessions/:id/messages","PATCH /api/sessions/:id/messages/:msg_id","POST /api/sessions/:id/summaries","GET /api/sessions/:id/queue","GET /api/sessions/:id/recovery","POST /api/sessions/batch/delete","POST /api/sessions/batch/export","GET /api/agents/:id/:agent_name/tools/count","POST /api/mcp-oauth/callback","GET /api/ping","GET /api/ready"]},cancel_stop_interrupt_routes:[],active_delete:{response:$delete_response,sleep_pid:$sleep_pid,descendant_survived:$sleep_alive}}' >"$(dirname "$0")/fixtures/http-surface.json"
if [[ "$sleep_alive" == true ]]; then kill -KILL "$sleep_pid" 2>/dev/null || true; fi
