#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
install_probe_traps

cat >"$AGENTS_DIR/surface-probe.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Use shell to run exactly `sleep 60`, then answer DONE.
    toolsets: [{type: shell}]
EOF

cat >"$AGENTS_DIR/replay-probe.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Use shell to run exactly `sleep 4; printf replay-done > replay-result.txt`, then answer DONE.
    toolsets: [{type: shell}]
EOF

start_runtime
replay_id=$(new_session "$WORK_DIR" | jq -r .id)
stream_turn "$replay_id" replay-probe 'Run the snapshot and event-source probe.' "$PROBE_ROOT/replay.sse" &
replay_stream_pid=$!
for _ in $(seq 1 100); do
  grep -q '"type":"tool_call"' "$PROBE_ROOT/replay.sse" 2>/dev/null && break
  sleep 0.1
done
grep -q '"type":"tool_call"' "$PROBE_ROOT/replay.sse" || { echo 'replay probe did not become active' >&2; exit 1; }
curl --silent --fail-with-body "http://127.0.0.1:$PORT/api/sessions/$replay_id/snapshot" >"$PROBE_ROOT/snapshot-active.json"
active_events_status=$(curl --silent --show-error --max-time 2 -o "$PROBE_ROOT/events-active.sse" -w '%{http_code}' "http://127.0.0.1:$PORT/api/sessions/$replay_id/events?after=0" || true)
wait "$replay_stream_pid"
[[ $(cat "$WORK_DIR/replay-result.txt" 2>/dev/null) == replay-done ]] || { echo 'replay probe did not finish' >&2; exit 1; }
curl --silent --fail-with-body "http://127.0.0.1:$PORT/api/sessions/$replay_id/snapshot" >"$PROBE_ROOT/snapshot-inactive.json"
inactive_events_status=$(curl --silent --show-error -o "$PROBE_ROOT/events-inactive.json" -w '%{http_code}' "http://127.0.0.1:$PORT/api/sessions/$replay_id/events?after=0")

session_id=$(new_session "$WORK_DIR" | jq -r .id)
stream_turn "$session_id" surface-probe 'Run the active cancellation probe.' "$PROBE_ROOT/active.sse" &
stream_pid=$!
for _ in $(seq 1 600); do
  sleep_pid=$(pstree -p "$RUNTIME_PID" | rg -o 'sleep\([0-9]+' | rg -o '[0-9]+' | head -1 || true)
  [[ -n "${sleep_pid:-}" ]] && break
  sleep 0.1
done
[[ -n "${sleep_pid:-}" ]] || { echo 'active cancellation probe did not start sleep' >&2; exit 1; }
delete_response=$(curl --silent --show-error -w '\nHTTP %{http_code}\n' -X DELETE "http://127.0.0.1:$PORT/api/sessions/$session_id?wait=true&timeout=5s")
wait "$stream_pid" 2>/dev/null || true
sleep_alive=false
[[ -n "${sleep_pid:-}" ]] && kill -0 "$sleep_pid" 2>/dev/null && sleep_alive=true

jq -n --arg source_commit '5277e7842058fc3fbb9943a6e88bc05a1c8e6fe2' --arg source_file 'pkg/server/server.go:registerRoutes' --arg delete_response "$delete_response" --arg sleep_pid "${sleep_pid:-}" --argjson sleep_alive "$sleep_alive" \
  '{source_commit:$source_commit,source_file:$source_file,routes:{health:["GET /health","GET /ready"],api:["GET /api/agents","GET /api/agents/:id","GET /api/sessions","GET /api/sessions/:id","GET /api/sessions/:id/status","GET /api/sessions/:id/snapshot","POST /api/sessions/:id/resume","POST /api/sessions/:id/tools/toggle","PATCH /api/sessions/:id/safety-policy","PATCH /api/sessions/:id/permissions","PATCH /api/sessions/:id/title","PATCH /api/sessions/:id/tokens","PATCH /api/sessions/:id/starred","GET /api/sessions/:id/models","POST /api/sessions","POST /api/sessions/:id/fork","DELETE /api/sessions/:id","POST /api/sessions/:id/agent/:agent","POST /api/sessions/:id/agent/:agent/:agent_name","POST /api/sessions/:id/elicitation","POST /api/sessions/:id/steer","POST /api/sessions/:id/followup","GET /api/sessions/:id/events","POST /api/sessions/:id/messages","PATCH /api/sessions/:id/messages/:msg_id","POST /api/sessions/:id/summaries","GET /api/sessions/:id/queue","GET /api/sessions/:id/recovery","POST /api/sessions/batch/delete","POST /api/sessions/batch/export","GET /api/agents/:id/:agent_name/tools/count","POST /api/mcp-oauth/callback","GET /api/ping","GET /api/ready"]},cancel_stop_interrupt_routes:[],active_delete:{response:$delete_response,sleep_pid:$sleep_pid,descendant_survived:$sleep_alive}}' >"$(dirname "$0")/fixtures/http-surface.json"
if [[ "$sleep_alive" == true ]]; then kill -KILL "$sleep_pid" 2>/dev/null || true; fi

jq -n \
  --slurpfile active_snapshot "$PROBE_ROOT/snapshot-active.json" \
  --slurpfile inactive_snapshot "$PROBE_ROOT/snapshot-inactive.json" \
  --arg active_events_status "$active_events_status" \
  --arg active_events "$(cat "$PROBE_ROOT/events-active.sse")" \
  --arg inactive_events_status "$inactive_events_status" \
  --arg inactive_events "$(cat "$PROBE_ROOT/events-inactive.json")" \
  '{request:"GET /api/sessions/:id/events?after=0",active:{snapshot:$active_snapshot[0],events:{http_status:$active_events_status,body:$active_events}},inactive:{snapshot:$inactive_snapshot[0],events:{http_status:$inactive_events_status,body:$inactive_events}}}' |
  redact_fixture >"$(dirname "$0")/fixtures/snapshot-events.json"
redact_fixture <"$PROBE_ROOT/replay.sse" >"$(dirname "$0")/fixtures/snapshot-events.sse"
format_fixture "$(dirname "$0")/fixtures/http-surface.json" "$(dirname "$0")/fixtures/snapshot-events.json"
