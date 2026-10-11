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
| `tool_call_response` | `tool_call_id`, `tool_definition`, `response` (string), `result?` |
| `token_usage` | `usage:{input_tokens, output_tokens, context_length, context_limit, cost}` |
| `session_title` | `title` |
| `budget_usage` / `budget_exceeded` | budget info |
| `elicitation_request` | MCP elicitation (answer via POST /elicitation) |
| `error` | `error` (string), `code?` |
| `stream_stopped` | `session_id`, `reason?` (`max_iterations`), `finish_reason?` |

Sub-agent activity arrives on the same stream with a different `agent` / `session_id`.
