#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
trap cleanup_probe EXIT INT TERM

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

cp "$PROBE_ROOT/max.sse" "$(dirname "$0")/fixtures/max-iterations.sse"
cp "$PROBE_ROOT/root.sse" "$(dirname "$0")/fixtures/root-error.sse"
cp "$PROBE_ROOT/child.sse" "$(dirname "$0")/fixtures/child-error-recovery.sse"
