#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
install_probe_traps

mkdir -p "$AGENTS_DIR/.agents/skills/origin" "$WORK_DIR/.agents/skills/origin"
cat >"$AGENTS_DIR/.agents/skills/origin/SKILL.md" <<'EOF'
---
name: origin
description: Report the skill origin marker.
---
Answer exactly CONFIG_SKILL.
EOF
cat >"$WORK_DIR/.agents/skills/origin/SKILL.md" <<'EOF'
---
name: origin
description: Report the skill origin marker.
---
Answer exactly WORK_SKILL.
EOF
cat >"$AGENTS_DIR/mcp-server.js" <<'EOF'
#!/usr/bin/env bun
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  for (const line of decoder.decode(chunk).split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line); let result = {};
    if (r.method === "initialize") result = {protocolVersion:"2025-06-18",capabilities:{tools:{}},serverInfo:{name:"path-probe",version:"1"}};
    else if (r.method === "tools/list") result = {tools:[{name:"origin",description:"Report server cwd",inputSchema:{type:"object",properties:{}}}]};
    else if (r.method === "tools/call") result = {content:[{type:"text",text:`MCP_CWD=${process.cwd()}`}],isError:false};
    else if (!r.id) continue;
    process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:r.id,result})+"\n");
  }
}
EOF
chmod +x "$AGENTS_DIR/mcp-server.js"

cat >"$AGENTS_DIR/handoff.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Immediately call handoff to specialist. Do not answer first.
    handoffs: [specialist]
  specialist:
    model: github-copilot/gpt-5.4-nano
    instruction: Answer exactly HANDOFF_DONE.
EOF
cat >"$AGENTS_DIR/skill-mcp.yaml" <<'EOF'
version: 16
agents:
  root:
    model: github-copilot/gpt-5.4-nano
    instruction: Read the origin skill, then call the MCP origin tool, then report both exact results.
    skills: [local]
    toolsets:
      - type: mcp
        command: bun
        args: [mcp-server.js]
EOF

start_runtime
handoff_id=$(new_session "$WORK_DIR" | jq -r .id)
stream_turn "$handoff_id" handoff 'Hand off now.' "$PROBE_ROOT/handoff.sse"
sed -n 's/^data: //p' "$PROBE_ROOT/handoff.sse" | jq -s -e '
  any(.[]; .type=="tool_call" and .tool_call.function.name=="handoff") and
  any(.[]; .type=="stream_stopped" and .agent_name=="specialist" and .reason=="normal")
' >/dev/null || { echo 'handoff was not exercised' >&2; exit 1; }
paths_id=$(new_session "$WORK_DIR" | jq -r .id)
stream_turn "$paths_id" skill-mcp 'Use origin skill and MCP origin.' "$PROBE_ROOT/paths.sse" || true
rg -q 'start failed:' "$PROBE_ROOT/paths.sse" || { echo 'relative MCP failure was not observed' >&2; exit 1; }
rg -q 'skill.*origin.*not found' "$PROBE_ROOT/paths.sse" || { echo 'relative skill failure was not observed' >&2; exit 1; }
cp "$PROBE_ROOT/handoff.sse" "$(dirname "$0")/fixtures/handoff.sse"
redact_fixture <"$PROBE_ROOT/paths.sse" >"$(dirname "$0")/fixtures/skill-mcp-relative.sse"
redact_fixture <"$RUNTIME_LOG" >"$(dirname "$0")/fixtures/skill-mcp-relative.log"
