#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/lib.sh"
trap cleanup_probe EXIT INT TERM

cat >"$AGENTS_DIR/stream-probe.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Use the shell tool to run exactly `sleep 4; printf survived > disconnect-result.txt`, then answer DONE.
    toolsets:
      - type: shell
EOF

start_runtime
session=$(new_session "$WORK_DIR")
session_id=$(jq -r .id <<<"$session")
curl --silent --no-buffer \
  --max-time 2 \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Run the disconnect probe."}]}' \
  "http://127.0.0.1:$PORT/api/sessions/$session_id/agent/stream-probe" \
  >"$PROBE_ROOT/disconnected.sse" || true
sleep 7
curl --silent --fail-with-body "http://127.0.0.1:$PORT/api/sessions/$session_id" \
  >"$PROBE_ROOT/snapshot.json"

jq -n \
  --arg file "$(cat "$WORK_DIR/disconnect-result.txt" 2>/dev/null || true)" \
  --slurpfile snapshot "$PROBE_ROOT/snapshot.json" \
  '{result_file:$file,snapshot:$snapshot[0]}'
cp "$PROBE_ROOT/disconnected.sse" "${FIXTURE_OUT:-$(dirname "$0")/fixtures/disconnected.sse}"
jq . "$PROBE_ROOT/snapshot.json" >"${SNAPSHOT_OUT:-$(dirname "$0")/fixtures/disconnected-snapshot.json}"
