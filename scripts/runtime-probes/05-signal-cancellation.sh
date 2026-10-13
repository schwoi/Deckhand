#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
install_probe_traps

cat >"$AGENTS_DIR/signal-probe.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Use shell to run exactly `sleep 60`, then answer DONE.
    toolsets: [{type: shell}]
EOF

query_db() {
  bun -e 'import {Database} from "bun:sqlite"; const db=new Database(process.argv[1],{readonly:true}); const ts=db.query("select name from sqlite_master where type=\"table\" order by name").all(); const out={tables:ts.map(x=>x.name)}; for(const t of ts){if(/session/i.test(t.name)){try{out[t.name]=db.query(`select * from "${t.name}"`).all()}catch{}}} console.log(JSON.stringify(out,null,2))' "$SESSION_DB"
}

run_case() {
  local signal=$1 launch_mode=$2 label=$3
  RUNTIME_LOG="$PROBE_ROOT/$label.runtime.log"
  SESSION_DB="$PROBE_ROOT/$label.db"
  start_standalone_runtime "$launch_mode"
  local session_id stream_pid shell_pid='' sleep_pid='' plugin_pgid survived=false
  session_id=$(new_session "$WORK_DIR" | jq -r .id)
  stream_turn "$session_id" signal-probe "Run $label." "$PROBE_ROOT/$label.sse" &
  stream_pid=$!
  for _ in $(seq 1 600); do
    plugin_pgid=$(ps -o pgid= -p "$RUNTIME_PID" | tr -d ' ')
    shell_pid=$(pstree -p "$RUNTIME_PID" | rg -o 'bash\([0-9]+' | rg -o '[0-9]+' | head -1 || true)
    sleep_pid=$(pstree -p "$RUNTIME_PID" | rg -o 'sleep\([0-9]+' | rg -o '[0-9]+' | head -1 || true)
    [[ -n "$sleep_pid" ]] && break
    kill -0 "$stream_pid" 2>/dev/null || break
    sleep 0.1
  done
  local probe_pids=$RUNTIME_PID
  [[ -n "$shell_pid" ]] && probe_pids+=",$shell_pid"
  [[ -n "$sleep_pid" ]] && probe_pids+=",$sleep_pid"
  ps -p "$probe_pids" -o pid=,ppid=,pgid=,lstart=,args= >"$PROBE_ROOT/$label.before.ps" 2>/dev/null || true
  track_runtime_descendants
  if [[ "$launch_mode" == detached ]]; then
    kill "-$signal" -- "-$plugin_pgid"
  else
    kill "-$signal" "$RUNTIME_PID"
  fi
  if ! wait_runtime_bounded 50; then
    signal_runtime KILL
    wait_runtime_bounded 20 || { echo "$label runtime did not stop within 7 seconds" >&2; return 1; }
  fi
  wait "$RUNTIME_PID" 2>/dev/null || true
  sleep 1
  ps -p "$probe_pids" -o pid=,ppid=,pgid=,lstart=,args= >"$PROBE_ROOT/$label.after-process.ps" 2>/dev/null || true
  [[ -n "$sleep_pid" ]] && kill -0 "$sleep_pid" 2>/dev/null && survived=true
  query_db >"$PROBE_ROOT/$label.db.json"
  jq -n --arg signal "$signal" --arg launch "$launch_mode" --arg target "$([[ "$launch_mode" == detached ]] && echo process_group || echo plugin_pid)" --arg pgid "$plugin_pgid" --arg sleep_pid "$sleep_pid" --argjson survived "$survived" '{signal:$signal,launch_mode:$launch,signal_target:$target,plugin_pgid:$pgid,sleep_pid:$sleep_pid,descendant_survived:$survived}' >"$PROBE_ROOT/$label.result.json"
  if [[ "$survived" == true ]]; then
    kill -KILL "$shell_pid" "$sleep_pid" 2>/dev/null || true
  fi
  kill "$stream_pid" 2>/dev/null || true
  wait "$stream_pid" 2>/dev/null || true
  RUNTIME_PID=''
  RUNTIME_LAUNCH_MODE=''
  RUNTIME_DESCENDANTS=''
}

run_case TERM inherited sigterm
run_case INT inherited sigint
run_case KILL inherited sigkill
run_case KILL detached sigkill-detached

for f in "$PROBE_ROOT"/{sigterm,sigint,sigkill,sigkill-detached}.{result.json,before.ps,after-process.ps,db.json,sse}; do
  redact_fixture <"$f" >"$(dirname "$0")/fixtures/standalone-$(basename "$f")"
done
