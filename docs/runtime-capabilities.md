# Docker Agent runtime capability gate

Tested 2026-10-13 against Docker Agent v1.150.0 (commit
`5277e7842058fc3fbb9943a6e88bc05a1c8e6fe2`). Model-backed findings use the real
`github-copilot/gpt-5.4-nano` provider. `doctor --json` also reported ChatGPT
usable; Docker Model Runner was not installed. No credential values were read or
retained. Every probe uses a private `/tmp` tree, listener, session DB, and data
directory. Raw evidence is under `scripts/runtime-probes/fixtures/`.

| # | Capability | Verdict |
| --- | --- | --- |
| 1 | Copied config, paths, workdir, stores | VERIFIED |
| 2 | Disconnect behavior | VERIFIED |
| 3 | Root versus subordinate outcomes | VERIFIED |
| 4 | Hierarchy and identifiers | PARTIAL |
| 5 | Usage and cost | PARTIAL |
| 6 | Cancellation and descendants | PARTIAL |
| 7 | Snapshot/replay recovery | NOT SUPPORTED |
| 8 | Limits | PARTIAL |
| 9 | Approval/elicitation | PARTIAL |
| 10 | Observed event inventory | VERIFIED |

## 1. Copied configuration, paths, workdir, and stores

**Verdict: VERIFIED with unsupported forms blocked.** `01-paths-and-stores.sh` served copied YAML from a new
directory. Its relative `instruction_file` loaded and caused the requested tool
calls. A session POSTed with `working_dir` wrote `relative-output.txt` there;
shell returned `/tmp/deckhand-runtime-probe.../work`. The todo tool worked, but
an omitted `path` created no standalone file under the isolated config, work, or
data directories; state was session-local/in the session DB for this run.

`09-store-paths.sh` proved a relative memory `path` resolves against the session
`working_dir`; an absolute memory path is honored. An explicit `todo.path` is
unsupported and fails config load (`path can only be used with type 'memory' or
'tasks'`). `08-handoffs-and-paths.sh` placed a local skill under both the copied
config directory and session work directory; neither was discovered by `serve
api`, whose project skill roots come from the server process directory. A stdio
MCP `args: [mcp-server.js]` with the script only beside the copied YAML was also
unavailable because relative MCP process paths resolve from `working_dir`, not
the config directory. Stage/preflight those dependencies or block them. Fixtures:
`store-paths.json`, `todo-explicit-path.txt`, and `skill-mcp-relative.*`.

## 2. POST/SSE ownership and disconnects

**Verdict: VERIFIED.** A downstream browser cannot affect a separate upstream
POST that Deckhand owns. Current Deckhand has not separated them:
`server/index.ts:365-397` forwards the browser `req.signal` upstream.

`02-stream-recovery.sh` timed out the actual upstream curl while `sleep 4` ran.
The result file was absent and a later session GET contained:

```json
{"role":"tool","content":"The tool call was canceled by the user.",
 "tool_call_id":"call_..."}
```

Losing Deckhand's upstream POST cancels the turn; it does not detach. Deckhand
must own and drain/persist that POST independently of subscribers. Probe/fixtures:
`02-stream-recovery.sh`, `disconnected.sse`, `disconnected-snapshot.json`.

## 3. Root outcomes versus subordinate activity

**Verdict: VERIFIED for representative outcomes.** Root and child success both emit
`stream_stopped {reason:"normal",finish_reason:"stop"}`, scoped by distinct
`session_id` and `agent_name`. Child stop is followed by parent
`sub_session_completed`, switch back to root, and continued root events. Budget
exhaustion emits `budget_exceeded` then root `stream_stopped
{reason:"budget_exceeded"}`. Upstream cancellation was visible in the snapshot's
canceled tool result because the terminal stream was gone.

A bad root model emits root `error` then `stream_stopped {reason:"error"}`. A
bad child model emits that pair on its child session, then
`sub_session_completed`, switches back, returns the error through the transfer
tool, and root can finish normally. Rejection returns HTTP 200, produces a
rejected tool response, and root may continue. `max_iterations: 1` emits
`max_iterations_reached` and waits for continuation; it does not emit
`stream_stopped` then. Only a root-session terminal event finishes a run.
Fixtures: `root-error.sse`, `child-error-recovery.sse`, `rejection.sse`, and
`max-iterations.sse`.

## 4. IDs and hierarchy

**Verdict: PARTIAL.** `transfer_task` created a distinct child session and an
explicit edge:

```json
{"type":"sub_session_completed","parent_session_id":"d7db...",
 "sub_session":{"id":"d664...","origin":"run"}}
```

`agent_switching` supplies from/to agents. Events and usage carry child session
and agent, assistant deltas carry message IDs, and the transfer call/response
share a tool ID. Observed IDs were unique, but one delegation cannot establish
global uniqueness; nesting and concurrency remain **UNVERIFIED**. A two-agent
handoff stays in the root session ID: the `handoff` tool call/response and agent
names show the edge, but there is no `parent_session_id`, child session, or
`sub_session_completed`. The terminal event is attributed to the receiver.
Build only explicit edges and key tools by `(session_id, tool_call_id)`. Probes:
`04-hierarchy-and-limits.sh`, `08-handoffs-and-paths.sh`.

## 5. Usage and cost accounting

**Verdict: PARTIAL.** The fresh two-call root and two-call child trace establishes
field-specific semantics. `input_tokens` and `output_tokens` are per model call,
not cumulative. `context_length` is also per call and equalled that frame's input
plus output tokens. `last_message` repeats the current call's token fields and its
`Cost`. In contrast, lowercase `cost` is cumulative for that session: its final
value equals the sum of all `last_message.Cost` values.

The exact fresh arithmetic is root `(356+85)+(455+57) = 953` tokens and child
`(378+31)+(423+7) = 839`; `953+839 = 1,792`, exactly the final `budget_usage`
total and its `per_agent` split. Root cost `$0.00017745+$0.00016225 =
$0.00033970`; child cost `$0.00011435+$0.00009335 = $0.00020770`; together they
equal the budget cost `$0.00054740`. The older fixture independently gives root
`(356+94)+(550+87) = 1,087`, matching its budget entry rather than latest-frame
`637`.

Therefore sum `input_tokens` and `output_tokens` frames by `session_id`; retain
the latest lowercase `cost` per session (or sum `last_message.Cost`, never both);
and use the latest `budget_usage` as the authoritative run total. Treat
`context_length` and `last_message` as per-call observations, not aggregands.
Afterward `GET /api/sessions/:id` reported only the latest call's token fields
(root 455/57, child 423/7) and no `cost`, so it cannot reconstruct totals.
Unpriced-provider behavior remains **UNVERIFIED**. Probe/fixtures:
`04-hierarchy-and-limits.sh`, `subagent.sse`, `usage-accounting.json`.

## 6. Cancellation and descendants

**Verdict: PARTIAL.** The authoritative upstream `registerRoutes` table at
commit `5277e78` contains no pause/cancel/stop/interrupt route. Its stop control
is `DELETE /api/sessions/:id`; against an active `sleep 60`,
`?wait=true&timeout=5s` returned HTTP 200 and stopped the descendant.

With the standalone plugin binary, direct SIGTERM and SIGINT cancelled shell and
sleep; direct SIGKILL left sleep alive. The shell tool had its own PGID, so
starting the plugin detached and SIGKILLing its process group still left sleep
alive; the probe then killed the recorded descendant explicitly. Every DB kept
a session row and usage, but has no terminal-status field/evidence. Crash cases
therefore require reconciliation and an `interrupted` outcome. Graceful HTTP
delete is verified; crash-safe cleanup is not. Persist plugin and descendant
identities and perform bounded explicit cleanup. Fixtures: `standalone-*` and
`http-surface.json`. Probe cleanup now records detached versus inherited launch
mode, snapshots descendants, sends inherited signals to PIDs rather than an
unrelated process group, and bounds TERM and KILL phases. `10-cleanup-bounds.sh`
interrupted an inherited-runtime probe during a real shell call; it exited 143
in 3 seconds (bound: 12) with no recorded survivor (`cleanup-bounds.json`).

## 7. Snapshot and replay recovery

**Verdict: NOT SUPPORTED for reattachment after capture loss.**
`06-http-surface.sh` requested the snapshot during a live shell call and after
normal completion: `streaming` changed from `true` to `false`, while
`last_event_seq` was `0` in both. It also requested the inventoried replay form
`GET /api/sessions/:id/events?after=0` in both states; both returned HTTP 404
`{"message":"no event source for session"}`. Thus `/events` cannot reattach even
while this session is active. A normal session GET after a disconnected POST did
recover persisted messages including tool cancellation, but no missed frames.

Snapshots reconcile conversation state, not event order or timing. Record a
trace gap/interruption and do not advertise reattachment. Probes:
`02-stream-recovery.sh`, `06-http-surface.sh`; fixtures `snapshot-events.json`,
`snapshot-events.sse`, and `disconnected-snapshot.json`.

## 8. Limits

**Verdict: PARTIAL.** With `budget.max_tokens: 1`, the first model call completed
normally at 36 tokens. The next turn emitted:

```json
{"type":"budget_exceeded","limit":"max_tokens","used":"36 tokens","max":"1 tokens"}
{"type":"stream_stopped","reason":"budget_exceeded"}
```

Token limits are boundary-enforced and best-effort within a model call. The
delegation trace confirms the budget is shared with children. Cost, time, and
enforcement remain **UNVERIFIED**. Iteration enforcement is verified as a
pause/continuation gate (`max_iterations_reached`), not an automatic terminal
stop. Reject unsupported guarantees and do not call tokens a strict spending
cap. Fixtures: `budget-exceeded.sse`, `max-iterations.sse`.

## 9. Approval and elicitation

**Verdict: PARTIAL.** Strict safety emitted `tool_call_confirmation` with the
tool-call ID but no separate request ID. POST `/resume` with
`{"confirmation":"approve"}` returned 200 `{"message":"session resumed"}` and
the original stream continued. Repeating it after completion returned the same
200: duplicate resolution is a silent no-op, not a conflict.

Reject is verified under strict safety: the probe requires confirmation before
POSTing `{"confirmation":"reject"}`, which returns 200. The stream and session
record both contain `The user rejected the tool call.`, and the tool's marker is
absent, proving it did not execute; the model may still complete normally.
Wrong-session and elicitation remain **UNVERIFIED**. Deckhand must
serialize by session, map its own approval ID to session/tool ID, and enforce
already-resolved conflicts itself. Probe/fixture: `03-approval.sh`,
`approval.sse`, `rejection.sse`, and `rejection-session.json`.

## 10. Observed event types

**Verdict: VERIFIED for retained traces.** Exact union:

```text
agent_choice, agent_info, agent_switching, budget_exceeded, budget_usage, error,
hook_finished, hook_started, mcp_init_finished, mcp_init_started, message_added,
max_iterations_reached, partial_tool_call, session_title, stream_started, stream_stopped,
sub_session_completed, team_info, token_usage, tool_call,
tool_call_confirmation, tool_call_output, tool_call_response, toolset_info,
user_message, warning
```

Persist raw payloads first and keep an unknown fallback. Regenerate with:

```sh
sed -n 's/^data: //p' scripts/runtime-probes/fixtures/*.sse |
  jq -r '.type' | sort -u
```

## Adapter recommendation

Use a **dedicated `serve api` process per run**, not the CLI control plane, for
the first adapter. It supplies tested isolation controls, per-run DB/data/work
directories, server-owned SSE capture, explicit child events, approvals, shared
budget telemetry, and snapshots. CLI control-plane replay/control was not proven.

The adapter must keep the upstream POST alive independent of browsers, persist
every frame, supervise detached groups or explicitly tracked inherited
descendants, use bounded TERM-then-KILL shutdown, record gaps on capture loss,
and project terminal state conservatively.

## Capabilities Deckhand must not advertise yet

- Isolated local skills or config-relative MCP dependencies without staging/preflight.
- Execution continuing after Deckhand's upstream POST is lost.
- Gap-free replay or capture reattachment.
- Complete nested/concurrent trees or globally unique tool IDs.
- Hard in-flight token/cost/time guarantees, or max iterations as a terminal cap.
- Crash-safe descendant cleanup after plugin SIGKILL.
- Request-addressed/idempotent runtime approvals or elicitation.
- Cost semantics for unpriced/custom providers.
