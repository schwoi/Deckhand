# Docker Agent runtime reference (verified against v1.150.0 locally)

The `docker agent` CLI plugin is installed at `~/.docker/cli-plugins/docker-agent`.
Always set env `DOCKER_AGENT_HIDE_TELEMETRY_BANNER=1` when spawning it.

## CLI commands used by Deckhand

| Command | Notes |
| --- | --- |
| `docker agent version` | stdout first line: `docker agent version v1.150.0` |
| `docker agent toolsets --format json` | `[{type, summary, docs}]` |
| `docker agent models --format json [--all] [-p provider]` | `[{provider, model, default?}]` |
| `docker agent doctor --json [agent.yaml]` | JSON on stdout; **exits non-zero when issues exist**. Shape: `{user_config:{path,status}, providers:[{provider, env_vars:[], found, source?}], dmr:{status, models?}, auto_model:{provider, model, usable}, issues:[string], ...}`. With a file it adds per-file env var requirements. |
| `docker agent share push <file> <ref>` / `share pull <ref> [--force]` | pull writes a yaml into cwd |
| `docker agent serve api <dir> --listen 127.0.0.1:PORT --session-db <path>` | logs `Listening on 127.0.0.1:PORT` to stderr/stdout; each `*.yaml` in dir becomes an agent whose id is the file stem |
| `docker agent run --exec [--yolo] [--last] <file> "msg"` | headless one-shot |

## serve api HTTP endpoints (all under /api)

- `GET /api/ping` → `{"status":"ok"}`
- `GET /api/agents` → `[{name, description, multi, commands?}]`  (name = file stem)
- `GET /api/agents/:id` → full parsed config (keys like `agents:[{Name,...}]`)
- `GET /api/sessions` → `[{id, title, created_at, num_messages, input_tokens, output_tokens}]`; `?active=true` only attached runtimes
- `POST /api/sessions` body `{title?, working_dir?, safety_policy?}` → `{id, title, created_at, messages, tools_approved, input_tokens, output_tokens, cost, ...}`
- `GET /api/sessions/:id` → session with `messages: [{agent_name, message:{message_id, role, content, reasoning_content?, tool_calls?, tool_call_id?}}]`, `tools_approved`, tokens
- `GET /api/sessions/:id/snapshot` → persisted state plus `streaming` and `last_event_seq`
- `DELETE /api/sessions/:id` → 204
- `PATCH /api/sessions/:id/title` body `{title}`
- `POST /api/sessions/:id/agent/:agentId[/:subAgentName]` body `{messages:[{role:'user', content}], model?}` → **SSE stream** (`data: {json}` lines)
- `POST /api/sessions/:id/resume` body `{confirmation: 'approve'|'approve-tool'|'approve-balanced'|'approve-autonomous'|'reject', reason?, tool_name?}`
- `POST /api/sessions/:id/tools/toggle` → toggles auto-approve (yolo) for the session
- `POST /api/sessions/:id/steer` / `followup` body `{messages:[{content}]}`
- `GET /api/sessions/:id/models` → models available for the session's agent
- `PATCH /api/sessions/:id/safety-policy` body `{safety_policy}`

## SSE events (each `data:` line is one JSON object with `type`)

| type | fields |
| --- | --- |
| `stream_started` | `session_id`, `agent` |
| `user_message` | `message`, `session_id`, `message_id` |
| `agent_choice` | `content` (text delta), `agent`, `session_id`, `message_id` |
| `agent_choice_reasoning` | `content` (thinking delta) |
| `partial_tool_call` | `tool_call:{id, function:{name, arguments}}` (arguments accumulate) |
| `tool_call` | `tool_call:{id, type, function:{name, arguments}}`, `tool_definition` |
| `tool_call_confirmation` | same as tool_call; **the stream pauses until POST /resume** |
| `tool_call_output` / `tool_call_response` | `tool_call_id`, tool definition, raw output/response, `result?` |
| `token_usage` | Per-call `input_tokens`, `output_tokens`, `context_length`, and `last_message`; cumulative session `cost`; parent frames exclude child sessions |
| `session_title` | `title` |
| `budget_usage` / `budget_exceeded` | budget info |
| `elicitation_request` | MCP elicitation (answer via POST /elicitation) |
| `error` | `error` (string), `code?` |
| `stream_stopped` | `session_id`, `reason?` (`max_iterations`), `finish_reason?` |
| `team_info` / `agent_info` / `toolset_info` | team, selected model, and available-tool metadata |
| `mcp_init_started` / `mcp_init_finished` | toolset initialization lifecycle |
| `hook_started` / `hook_finished` | hook lifecycle and duration/allow result |
| `message_added` | a message was persisted; may flag an empty assistant tool-call message |
| `agent_switching` | `from_agent`, `to_agent`, `switching` around delegation |
| `sub_session_completed` | explicit `parent_session_id` and embedded `sub_session` snapshot |

Sub-agent activity arrives on the same stream with a different `agent_name` / `session_id`.
Sum token fields across frames per session, but keep the latest `cost` (or sum
`last_message.Cost`). `GET /sessions/:id` retains only the latest call's token
fields and omits cost. `budget_usage` is cumulative across the run and includes
`per_agent` and child-session totals. Token budgets are checked at turn boundaries
and may overshoot during an in-flight call. Dropping the POST/SSE client cancels
an active turn/tool. Snapshots reconcile persisted state, but
`GET .../events?after=0` returned no event source both active and inactive.
