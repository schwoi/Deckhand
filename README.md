# Deckhand

The crew console for [Docker Agent](https://github.com/docker/docker-agent).

A local web app for creating, configuring and managing [Docker Agent](https://github.com/docker/docker-agent) agents.

Agents are plain `docker agent` YAML files. Deckhand keeps them in one directory, gives you a form editor
and a YAML editor over the same file, validates against the official JSON schema, and runs them through
a managed `docker agent serve api` process so you can chat with them and browse sessions in the browser.

## Features

- **Agent library** — list, create from templates, duplicate, delete, import from an OCI registry.
- **Editor** — agents, models, MCP servers, permissions, runtime defaults, metadata, raw YAML. Form and YAML stay in sync; validation issues show live.
- **Chat** — streams the Docker Agent runtime (SSE), shows tool calls and sub-agent activity, handles tool approvals.
- **Sessions** — browse and delete sessions stored by the runtime.
- **System** — CLI version, provider credentials (via `docker agent doctor`), available models, toolset reference, runtime logs.
- **Environments** — add other Deckhand instances and switch between them from one dashboard.

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
| `PORT` | `4800` | Deckhand API/static server port |
| `HOST` | `127.0.0.1` | Bind address. The API is unauthenticated and can edit files and drive the runtime, so keep it on loopback unless you put auth in front of it |
| `DOCKER_AGENT_BIN` | auto-detected | Path to the `docker-agent` plugin binary. Deckhand looks in the usual cli-plugins directories and falls back to `docker agent` |
| `DECKHAND_HOME` | `~/.deckhand` | Data directory (session db, agents) |
| `DECKHAND_AGENTS` | `$HOME_DIR/agents` | Directory holding agent YAML files; seeded with templates on first run |
| `DECKHAND_RUNTIME` | `127.0.0.1:4801` | Listen address for the managed `docker agent serve api` process |
| `DECKHAND_TOKEN` | unset | When set, every API request must carry `Authorization: Bearer <token>`. Required to bind anything but loopback |
| `DECKHAND_INSECURE` | unset | `1` disables the token requirement and the loopback checks. Only for an authenticating reverse proxy in front of Deckhand |

Model API keys are read from the environment of the Deckhand server process (the same environment `docker agent` would use).

### How the runtime is managed

Deckhand runs one `docker-agent serve api <agents dir>` child process and proxies its HTTP API, including the
SSE chat streams, under `/api/runtime/proxy/`. The plugin binary is invoked directly rather than through the
`docker` CLI wrapper, because the wrapper ignores an early SIGTERM and would leave the real server orphaned.
Saving, creating or deleting an agent restarts the runtime (it reads the directory at start), which cuts any
in-flight chat stream. Sessions live in SQLite, so the conversation can be continued afterwards. Deckhand records
the child's pid and terminates a leftover runtime from a previous run on boot.

## Environments

Every Deckhand instance manages the agents directory and runtime of the machine it runs on. To drive
several machines from one place, run Deckhand on each of them and add them as environments in the
instance you use as the dashboard (sidebar switcher → *Manage environments*). The dashboard proxies the
selected environment's whole API, including chat streams, under `/api/env/:id/`; nothing is replicated.

Remote instances must listen on a reachable address (`HOST=0.0.0.0`) and set `DECKHAND_TOKEN`; the server
refuses to start on a non-loopback address without one. The dashboard stores each token in
`$DECKHAND_HOME/environments.json` (mode 0600). The dashboard itself can also be started with a token; the
browser then asks for it once and keeps it in local storage.

Tokens are sent with every proxied request, so a plain `http://` environment on another machine exposes
its token to anyone on the path. Deckhand refuses such a URL unless you switch on *Allow an unencrypted
connection* for that environment, which is meant for a VPN, a tunnel such as Tailscale or SSH, or a
network you trust. Prefer HTTPS termination in front of any instance that crosses a network you do not.

### Security model

The API is an administrative interface: it writes agent files, starts processes, and uses whatever
provider credentials the server has. Whoever holds the token is an administrator.

Without a token the server only accepts loopback binds, rejects requests whose `Host` header is not
`localhost` or a loopback IP literal (DNS rebinding), rejects mutations from other origins (cross-site
requests), and only reads `application/json` bodies. The data directory, its files and the default agents
directory are kept `0700`/`0600`, including on upgrade; an agents directory you point `DECKHAND_AGENTS` at
is left as you set it. The managed runtime's own port has no auth, so leave `DECKHAND_RUNTIME` on
loopback.

## Docker

The container is just another way to run an instance; the binary is baked in.

```bash
DECKHAND_TOKEN=secret ANTHROPIC_API_KEY=... docker compose up -d
```

or

```bash
docker build -t deckhand .
docker run -d -p 4800:4800 -v deckhand:/data -e DECKHAND_TOKEN=secret -e ANTHROPIC_API_KEY=... deckhand
```

Agents and sessions live in the `/data` volume. Mount `/var/run/docker.sock` only if agents use MCP
servers from the Docker catalog (`ref: docker:...`), as those run as containers. The build arg
`DOCKER_AGENT_VERSION` picks the docker-agent release.

## Layout

```
server/   Bun + Hono API: agent files, schema validation, CLI wrappers, runtime supervisor + SSE proxy, environments
web/      Vite + React UI
shared/   Types shared by both, the bundled agent-schema.json, and templates
docs/     Runtime reference notes verified against docker-agent v1.150.0
```

## Checks

```bash
bun run typecheck
bun run lint
```
