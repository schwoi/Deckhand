#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
install_probe_traps

cat >"$AGENTS_DIR/max-iterations.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    max_iterations: 1
    instruction: Use shell to run exactly `printf iteration > iteration.txt`, then answer DONE.
    toolsets: [{type: shell}]
EOF
cat >"$AGENTS_DIR/root-error.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Answer DONE.
EOF
cat >"$AGENTS_DIR/child-recovery.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: You MUST call transfer_task exactly once with agent broken and task "answer CHILD_DONE". If that tool reports an error, continue as root and answer exactly ROOT_RECOVERED.
    sub_agents: [broken]
  broken:
    model: github-copilot/definitely-not-a-model
    instruction: Answer CHILD_DONE.
EOF

start_runtime
max_id=$(new_session "$WORK_DIR" | jq -r .id)
curl --silent --no-buffer --max-time 45 -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"Run the max iteration probe."}]}' "http://127.0.0.1:$PORT/api/sessions/$max_id/agent/max-iterations" >"$PROBE_ROOT/max.sse" || true
root_id=$(new_session "$WORK_DIR" | jq -r .id)
curl --silent --no-buffer --show-error -w '\nHTTP %{http_code}\n' -H 'content-type: application/json' \
  -d '{"model":"github-copilot/definitely-not-a-model","messages":[{"role":"user","content":"Run the root error probe."}]}' \
  "http://127.0.0.1:$PORT/api/sessions/$root_id/agent/root-error" >"$PROBE_ROOT/root.sse" || true
child_id=$(new_session "$WORK_DIR" | jq -r .id)
curl --silent --no-buffer --max-time 90 -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"Call transfer_task to broken now, then recover from its error."}]}' "http://127.0.0.1:$PORT/api/sessions/$child_id/agent/child-recovery" >"$PROBE_ROOT/child.sse" || true
grep -q '"type":"max_iterations_reached"' "$PROBE_ROOT/max.sse" || { echo 'max-iterations gate was not exercised' >&2; exit 1; }
grep -q '"type":"error"' "$PROBE_ROOT/root.sse" || { echo 'root error was not exercised' >&2; exit 1; }
sed -n 's/^data: //p' "$PROBE_ROOT/child.sse" | jq -s -e '
  any(.[]; .type=="stream_stopped" and .agent_name=="broken" and .reason=="error") and
  any(.[]; .type=="sub_session_completed") and
  any(.[]; .type=="stream_stopped" and .agent_name=="root" and .reason=="normal")
' >/dev/null || { echo 'child-error recovery was not exercised' >&2; exit 1; }

redact_fixture <"$PROBE_ROOT/max.sse" >"$(dirname "$0")/fixtures/max-iterations.sse"
redact_fixture <"$PROBE_ROOT/root.sse" >"$(dirname "$0")/fixtures/root-error.sse"
redact_fixture <"$PROBE_ROOT/child.sse" >"$(dirname "$0")/fixtures/child-error-recovery.sse"
