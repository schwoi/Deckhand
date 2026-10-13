# Docker Agent runtime probes

These probes target Docker Agent v1.150.0. Each creates an isolated tree under
`/tmp`, starts its own loopback-only `docker agent serve api`, uses an isolated
session DB and data directory. Detached runtimes are terminated by process group;
inherited runtimes and recorded descendants are signalled directly with bounded
TERM/KILL phases. They do not write Docker Agent's global configuration or
Deckhand's agent files.

Requirements: `docker agent`, `bun`, `curl`, `jq`, `pstree`, `rg` (ripgrep), and a usable
`github-copilot/gpt-5.4-nano` credential. Check availability without exposing
credential values with:

```sh
DOCKER_AGENT_HIDE_TELEMETRY_BANNER=1 docker agent doctor --json
```

Run individually from the repository root:

```sh
bash scripts/runtime-probes/01-paths-and-stores.sh
bash scripts/runtime-probes/02-stream-recovery.sh
bash scripts/runtime-probes/03-approval.sh
bash scripts/runtime-probes/04-hierarchy-and-limits.sh
bash scripts/runtime-probes/05-signal-cancellation.sh
bash scripts/runtime-probes/06-http-surface.sh
bash scripts/runtime-probes/07-outcomes.sh
bash scripts/runtime-probes/08-handoffs-and-paths.sh
bash scripts/runtime-probes/09-store-paths.sh
bash scripts/runtime-probes/10-cleanup-bounds.sh
```

Set `KEEP_PROBE_TMP=1` to retain a probe tree for inspection. The scripts print
the retained path to stderr. Representative redacted outputs are kept in
`fixtures/`; rerunning a probe replaces its corresponding fixture.
