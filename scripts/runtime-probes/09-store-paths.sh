#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
trap cleanup_probe EXIT INT TERM

absolute_todo="$PROBE_ROOT/absolute/todo.db"
absolute_memory="$PROBE_ROOT/absolute/memory.db"
mkdir -p "$PROBE_ROOT/absolute"
cat >"$AGENTS_DIR/relative-memory.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Add memory RELATIVE_MEMORY, then answer DONE.
    toolsets:
      - type: memory
        path: relative-memory.db
EOF
cat >"$AGENTS_DIR/absolute-memory.yaml" <<EOF
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Add memory ABSOLUTE_MEMORY, then answer DONE.
    toolsets:
      - type: memory
        path: $absolute_memory
EOF
cat >"$AGENTS_DIR/todo-path.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Create a todo titled TODO_PATH.
    toolsets:
      - type: todo
        path: relative-todo.db
EOF

start_runtime
relative_id=$(new_session "$WORK_DIR" | jq -r .id)
stream_turn "$relative_id" relative-memory 'Populate the relative memory store.' "$PROBE_ROOT/relative.sse"
absolute_id=$(new_session "$WORK_DIR" | jq -r .id)
stream_turn "$absolute_id" absolute-memory 'Populate the absolute memory store.' "$PROBE_ROOT/absolute.sse"
todo_id=$(new_session "$WORK_DIR" | jq -r .id)
curl --silent --show-error -w '\nHTTP %{http_code}\n' -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"Populate todo."}]}' "http://127.0.0.1:$PORT/api/sessions/$todo_id/agent/todo-path" >"$PROBE_ROOT/todo.txt" || true
jq -n --argjson config "$(find "$AGENTS_DIR" -maxdepth 1 -type f -printf '%f\n' | sort | jq -Rsc 'split("\n")[:-1]')" --argjson work "$(find "$WORK_DIR" -maxdepth 1 -type f -printf '%f\n' | sort | jq -Rsc 'split("\n")[:-1]')" --argjson absolute "$(find "$PROBE_ROOT/absolute" -maxdepth 1 -type f -printf '%f\n' | sort | jq -Rsc 'split("\n")[:-1]')" '{config_dir_files:$config,working_dir_files:$work,absolute_dir_files:$absolute}' >"$(dirname "$0")/fixtures/store-paths.json"
cp "$PROBE_ROOT/relative.sse" "$(dirname "$0")/fixtures/store-relative.sse"
cp "$PROBE_ROOT/absolute.sse" "$(dirname "$0")/fixtures/store-absolute.sse"
cp "$PROBE_ROOT/todo.txt" "$(dirname "$0")/fixtures/todo-explicit-path.txt"
