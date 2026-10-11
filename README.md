# Docker Agent Studio

A local web app for creating, configuring and managing [Docker Agent](https://github.com/docker/docker-agent) agents.

Agents are plain `docker agent` YAML files. Studio keeps them in one directory, gives you a form editor
and a YAML editor over the same file, validates against the official JSON schema, and runs them through
a managed `docker agent serve api` process so you can chat with them and browse sessions in the browser.

## Features

- **Agent library** — list, create from templates, duplicate, delete, import from an OCI registry.
- **Editor** — agents, models, MCP servers, permissions, runtime defaults, metadata, raw YAML. Form and YAML stay in sync; validation issues show live.
- **Chat** — streams the Docker Agent runtime (SSE), shows tool calls and sub-agent activity, handles tool approvals.
- **Sessions** — browse and delete sessions stored by the runtime.
- **System** — CLI version, provider credentials (via `docker agent doctor`), available models, toolset reference, runtime logs.

## Requirements

- [Bun](https://bun.sh) 1.2+
- Docker with the `docker agent` CLI plugin (Docker Desktop 4.63+, `brew install docker-agent`, or a
  [release binary](https://github.com/docker/docker-agent/releases) at `~/.docker/cli-plugins/docker-agent`).
- At least one model provider credential (for example `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`), or Docker Model Runner.

## Run

```bash
bun install
bun run dev          # server on :4800, web on :5180 (proxies /api)
```

Production:

```bash
bun run build
bun run start        # serves dist/ and the API on :4800
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4800` | Studio API/static server port |
| `DOCKER_AGENT_STUDIO_HOME` | `~/.docker-agent-studio` | Data directory (session db, agents) |
| `DOCKER_AGENT_STUDIO_AGENTS` | `$HOME_DIR/agents` | Directory holding agent YAML files; seeded with templates on first run |
| `DOCKER_AGENT_STUDIO_RUNTIME` | `127.0.0.1:4801` | Listen address for the managed `docker agent serve api` process |

Model API keys are read from the environment of the Studio server process (the same environment `docker agent` would use).

## Layout

```
server/   Bun + Hono API: agent files, schema validation, CLI wrappers, runtime supervisor + SSE proxy
web/      Vite + React UI
shared/   Types shared by both, the bundled agent-schema.json, and templates
docs/     Runtime reference notes verified against docker-agent v1.150.0
```

## Checks

```bash
bun run typecheck
bun run lint
```
