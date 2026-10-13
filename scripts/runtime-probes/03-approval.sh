#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/lib.sh"
install_probe_traps

cat >"$AGENTS_DIR/approval-probe.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Use shell to run exactly `printf approved > approval-result.txt`, then answer DONE.
    toolsets:
      - type: shell
permissions:
  ask:
    - shell
EOF

cat >"$AGENTS_DIR/rejection-probe.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Use shell to run exactly `printf rejected-tool-ran > rejection-result.txt`, then explain the result.
    toolsets:
      - type: shell
permissions:
  ask:
    - shell
EOF

start_runtime
session=$(curl --silent --fail-with-body -H 'content-type: application/json' \
  -d "$(jq -cn --arg wd "$WORK_DIR" '{working_dir:$wd,safety_policy:"strict"}')" \
  "http://127.0.0.1:$PORT/api/sessions")
session_id=$(jq -r .id <<<"$session")

stream_turn "$session_id" approval-probe 'Run the approval probe.' "$PROBE_ROOT/approval.sse" &
stream_pid=$!
for _ in $(seq 1 100); do
  grep -q 'tool_call_confirmation' "$PROBE_ROOT/approval.sse" 2>/dev/null && break
  sleep 0.1
done
grep -q 'tool_call_confirmation' "$PROBE_ROOT/approval.sse" || { echo 'approval confirmation did not arrive' >&2; exit 1; }

resume_one=$(curl --silent --show-error -w '\nHTTP %{http_code}\n' \
  -H 'content-type: application/json' -d '{"confirmation":"approve"}' \
  "http://127.0.0.1:$PORT/api/sessions/$session_id/resume")
wait "$stream_pid"
resume_two=$(curl --silent --show-error -w '\nHTTP %{http_code}\n' \
  -H 'content-type: application/json' -d '{"confirmation":"approve"}' \
  "http://127.0.0.1:$PORT/api/sessions/$session_id/resume")

reject_id=$(new_session "$WORK_DIR" strict | jq -r .id)
stream_turn "$reject_id" rejection-probe 'Run the rejection probe.' "$PROBE_ROOT/rejection.sse" &
reject_stream_pid=$!
for _ in $(seq 1 100); do
  grep -q 'tool_call_confirmation' "$PROBE_ROOT/rejection.sse" 2>/dev/null && break
  sleep 0.1
done
grep -q 'tool_call_confirmation' "$PROBE_ROOT/rejection.sse" || { echo 'rejection confirmation did not arrive' >&2; exit 1; }
reject_response=$(curl --silent --show-error -w '\nHTTP %{http_code}\n' \
  -H 'content-type: application/json' -d '{"confirmation":"reject"}' \
  "http://127.0.0.1:$PORT/api/sessions/$reject_id/resume")
wait "$reject_stream_pid"
[[ ! -e "$WORK_DIR/rejection-result.txt" ]] || { echo 'rejected tool created its marker' >&2; exit 1; }
grep -q 'The user rejected the tool call' "$PROBE_ROOT/rejection.sse" || { echo 'rejection was not recorded in stream' >&2; exit 1; }
curl --silent --fail-with-body "http://127.0.0.1:$PORT/api/sessions/$reject_id" >"$PROBE_ROOT/rejection-session.json"
jq -e '[.messages[] | .message | select(.role == "tool" and (.content | contains("rejected the tool call")))] | length == 1' "$PROBE_ROOT/rejection-session.json" >/dev/null

jq -n --arg first "$resume_one" --arg second "$resume_two" --arg reject "$reject_response" \
  --arg result "$(cat "$WORK_DIR/approval-result.txt" 2>/dev/null || true)" \
  '{first_resume:$first,second_resume:$second,reject_resume:$reject,result_file:$result}'
cp "$PROBE_ROOT/approval.sse" "${FIXTURE_OUT:-$(dirname "$0")/fixtures/approval.sse}"
cp "$PROBE_ROOT/rejection.sse" "${REJECTION_OUT:-$(dirname "$0")/fixtures/rejection.sse}"
redact_fixture <"$PROBE_ROOT/rejection-session.json" >"${REJECTION_SESSION_OUT:-$(dirname "$0")/fixtures/rejection-session.json}"
format_fixture "${REJECTION_SESSION_OUT:-$(dirname "$0")/fixtures/rejection-session.json}"
