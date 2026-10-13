#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/lib.sh"
install_probe_traps

cat >"$AGENTS_DIR/instructions.txt" <<'EOF'
You are a probe. You must use the shell tool once. Run exactly: pwd; printf path-ok > relative-output.txt
Then create one todo item titled store-probe. Finally answer PATH_PROBE_DONE.
EOF

cat >"$AGENTS_DIR/path-probe.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction_file: instructions.txt
    toolsets:
      - type: shell
      - type: todo
EOF

start_runtime
session=$(new_session "$WORK_DIR")
session_id=$(jq -r .id <<<"$session")
stream_turn "$session_id" path-probe 'Perform the configured probe now.' "$PROBE_ROOT/path.sse"
[[ $(cat "$WORK_DIR/relative-output.txt" 2>/dev/null) == path-ok ]] || { echo 'working-directory shell effect missing' >&2; exit 1; }
grep -q '"name":"create_todo"' "$PROBE_ROOT/path.sse" || { echo 'todo tool was not exercised' >&2; exit 1; }

jq -n \
  --arg root "$PROBE_ROOT" \
  --arg session_id "$session_id" \
  --arg output "$(cat "$WORK_DIR/relative-output.txt" 2>/dev/null || true)" \
  --argjson files "$(find "$PROBE_ROOT" -type f -printf '%P\n' | sort | jq -Rsc 'split("\n")[:-1]')" \
  '{probe_root:$root,session_id:$session_id,working_dir_output:$output,files:$files}'
redact_fixture <"$PROBE_ROOT/path.sse" >"${FIXTURE_OUT:-$(dirname "$0")/fixtures/path-and-store.sse}"
