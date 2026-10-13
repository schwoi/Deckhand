#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/lib.sh"
install_probe_traps

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
    instruction: Use shell to run exactly `printf child-call > child-result.txt`, then answer CHILD_DONE.
    toolsets: [{type: shell}]
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
child_id=$(sed -n 's/^data: //p' "$PROBE_ROOT/team.sse" | jq -r 'select(.type=="sub_session_completed") | .sub_session.id' | tail -1)
[[ -n "$child_id" ]] || { echo 'delegation did not produce a child session' >&2; exit 1; }
curl --silent --fail-with-body "http://127.0.0.1:$PORT/api/sessions/$session_id" >"$PROBE_ROOT/root-session.json"
curl --silent --fail-with-body "http://127.0.0.1:$PORT/api/sessions/$child_id" >"$PROBE_ROOT/child-session.json"
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
jq -n \
  --slurpfile events <(sed -n 's/^data: //p' "$PROBE_ROOT/team.sse") \
  --slurpfile root "$PROBE_ROOT/root-session.json" \
  --slurpfile child "$PROBE_ROOT/child-session.json" '
  def calls($id): [$events[] | select(.type == "token_usage" and .session_id == $id) | .usage];
  def account($session):
    (calls($session.id)) as $calls |
    {session_id:$session.id, calls:$calls,
     derived:{input_tokens:([$calls[].input_tokens]|add), output_tokens:([$calls[].output_tokens]|add),
       tokens:([$calls[]|.input_tokens+.output_tokens]|add), cost:([$calls[].last_message.Cost]|add),
       latest_cost:$calls[-1].cost},
     session_get:{input_tokens:$session.input_tokens,output_tokens:$session.output_tokens,cost:($session.cost // null)}};
  ($root[0]) as $r | ($child[0]) as $c |
  {root:account($r),child:account($c),final_budget:([$events[]|select(.type=="budget_usage")|.budgets[]|select(.name=="run")][-1])}
' >"$PROBE_ROOT/usage-accounting.json"
jq -e '
  [.root,.child][] | .session_get.input_tokens == .calls[-1].input_tokens and
    .session_get.output_tokens == .calls[-1].output_tokens and .session_get.cost == null and
    ((.derived.cost - .derived.latest_cost) | fabs < 0.000000001)
' "$PROBE_ROOT/usage-accounting.json" >/dev/null
jq -e '
  (.root.derived.tokens + .child.derived.tokens) == .final_budget.tokens and
  ((.root.derived.cost + .child.derived.cost - .final_budget.cost) | fabs < 0.000000001) and
  ([.final_budget.per_agent[].tokens] | add) == .final_budget.tokens
' "$PROBE_ROOT/usage-accounting.json" >/dev/null
redact_fixture <"$PROBE_ROOT/usage-accounting.json" >"$(dirname "$0")/fixtures/usage-accounting.json"
format_fixture "$(dirname "$0")/fixtures/usage-accounting.json"
