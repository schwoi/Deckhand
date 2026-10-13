# Building complex agent systems in Deckhand

Status: Proposed implementation specification
Date: 2026-10-13
Scope: Agent topology view, Run Inspector, versioned configurations and isolated runs, Evaluation Workbench

## Product outcome

Users can understand an agent team, run a specific configuration without edits interrupting it, inspect what happened, and compare changes against repeatable tests.

A representative workflow:

1. Open a team and inspect its delegation and handoff topology.
2. Edit its instructions, tools, or relationships and save a revision.
3. Start a run against that revision in a fresh workspace.
4. Inspect agent activity, tool calls, approvals, errors, and available usage data.
5. Turn a useful test prompt into an evaluation case.
6. Compare the candidate revision with a baseline on the same suite.
7. Restore an earlier revision or continue improving the candidate.

The task board is a future integration. These features expose stable revision and run IDs that board cards can reference. Implementing Docker Agent board integration is outside this specification.

## Current behavior and constraints

Deckhand edits plain Docker Agent YAML files through synchronized form and YAML editors. Validation includes the bundled schema and reference checks. Each file can define a team of agents, models, MCP servers, shared toolsets, permissions, and budgets.

The server currently supervises one `docker agent serve api` process over the entire agents directory. Saving, creating, deleting, and importing files restarts it. Chat is a browser-owned POST/SSE connection proxied to the runtime; closing that connection aborts the upstream request. Sessions are persisted by Docker Agent, but Deckhand does not own a durable run/event model. The chat reducer produces a flattened transcript and discards events it does not recognize.

The locally verified runtime reference is Docker Agent v1.150.0. Session control-plane APIs also exist for CLI-launched runs, but their compatibility with `serve api`, cancellation behavior, hierarchy information, and usage accounting need verification. See [runtime reference](runtime-reference.md) and [board research](task-board-research.md).

## Scope and principles

- Keep Docker Agent YAML as the portable source configuration. Deckhand-specific history, graph layout, run records, and evaluations live separately.
- Use the same execution path for interactive runs and evaluation attempts.
- Capture execution on the server independently of browser subscriptions.
- Preserve unknown YAML keys and runtime event types.
- Separate configured relationships from observed execution. A graph edge grants a capability; it does not prove that delegation occurred.
- Represent missing telemetry as unavailable. Do not substitute zero cost, infer successful completion from a disconnected stream, or invent parent/child relationships.
- Keep the local, single-user deployment model. Hosted collaboration and remote workers are outside the first release.
- Configuration isolation and working-directory isolation do not constitute a security sandbox. Show the effective workspace mode and runtime safety settings.

## Shared domain and records

| Term | Meaning |
| --- | --- |
| Configuration | One library YAML file defining an executable agent or team. Has a stable ID independent of its filename. |
| Draft | Mutable authoring content, including invalid intermediate content. |
| Revision | Immutable snapshot of saved configuration content and its local configuration dependencies. |
| Run | Execution of one revision in one workspace, with a root runtime session and zero or more sub-sessions. |
| Turn | A user message and the execution it triggers within a run. A run may contain several turns. |
| Agent instance | An observed execution participant identified by runtime session/instance identifiers where available. Distinct from an agent definition name. |
| Event | Persisted runtime or Deckhand lifecycle information associated with a run. |
| Evaluation suite | Versioned collection of cases, assertions, and execution settings. |
| Evaluation attempt | One case/repetition executed as a fresh run against one revision. |
| Evaluation batch | Frozen suite snapshot, selected revisions, and their scheduled attempts. |

Minimum records:

- `Configuration`: ID, current name/path, timestamps, draft generation, latest revision ID, archived flag.
- `Revision`: ID, configuration ID, parent revision ID, creation time, optional note, exact source YAML, validation results/schema version, bundle manifest and content hash.
- `Run`: ID, revision ID, mode (`interactive` or `evaluation`), lifecycle status, timestamps, workspace descriptor, runtime version, effective execution settings, root session ID, outcome/reason, trace completeness, optional evaluation attempt ID.
- `Turn`: ID, run ID, ordinal, submitted input, submission time, lifecycle status and outcome.
- `Event`: run ID, monotonically increasing Deckhand sequence, source sequence/ID if present, receive time, source time if present, runtime session/agent/message/tool IDs, raw payload, normalized kind, normalization version.
- `EvaluationSuite`: ID, name, mutable draft and immutable versions containing cases, grader definitions and execution settings.
- `EvaluationBatch`: ID, suite version, revision IDs, settings, status, attempts and aggregate results.

Store Deckhand metadata and events in a separate SQLite database under `DECKHAND_HOME`. Leave runtime-managed session databases separate. Large immutable bundles and run workspaces live on disk and are referenced by manifest. Publish a revision only after its complete bundle is durable; clean abandoned staging directories on startup.

## 1. Agent topology view

### User experience

Add **Topology** to the configuration editor alongside the existing sections. The graph reflects the current draft. Historical revisions and runs expose a read-only topology for their pinned revision.

Each local agent is a node showing name, description, model reference, toolset count, and entry-point status. Clicking it opens its existing form editor in a side panel. Model/tool details are expandable; they do not become graph nodes by default.

Use directed, labeled edges with distinct styles:

- **Delegation** from `sub_agents`: the caller can delegate work to the target.
- **Handoff** from `handoffs`: the caller can transfer the conversation to the target.
- Annotate `force_handoff` separately using verified runtime semantics; unresolved targets are diagnostics, not silently omitted links.

External references are visible placeholder nodes showing the reference and resolution state. Do not fetch OCI references automatically when opening the graph. Multiple relationship types between the same pair remain distinguishable.

Provide fit-to-view, pan/zoom, search, focus on an agent and its immediate relationships, an edge legend, and a list alternative with keyboard-accessible navigation. Keep selection and graph layout stable across nonstructural edits. Store layout outside YAML, keyed by configuration ID and node identity.

First release supports node selection and editing through forms, plus explicit add/remove relationship controls. Drag-to-connect and arbitrary workflow nodes are deferred. Relationships describe Docker Agent behavior; the graph is not a deterministic execution DAG.

### Diagnostics

Display existing validation errors on their nodes/edges and link each diagnostic to the field or YAML path. Add warnings for agents unreachable from the selected entry point and cycles, with explanatory wording rather than prohibiting valid cyclic designs. An external reference is unresolved until verified, rather than assumed missing.

If YAML no longer parses, show the last parseable graph labeled as stale and disable topology mutations. If it parses but fails schema validation, display the representable graph with issues; execution remains blocked.

### Acceptance criteria

- A team with delegation and handoff links renders both accurately, including cycles, self-links, and external references.
- Renaming or deleting an agent through topology uses the shared reference-update logic, including verified `force_handoff` references.
- Form and YAML edits update the graph without losing unknown configuration keys.
- Opening a run's topology shows its revision even after the current draft changes.
- Every graph relationship is available through the accessible list view.
- A fixture with 50 agents and 150 relationships remains navigable; search, selection, and fit-to-view respond within one second on the documented reference machine.

## 2. Versioned configurations and isolated runs

### Saving and history

Keep **Save** as the normal editor action. A changed save creates an immutable revision and updates the library YAML. An identical bundle does not create a duplicate revision. A note is optional. Invalid parseable YAML may be saved for later repair, matching current authoring behavior, but invalid revisions cannot run. Invalid unsaved text remains a draft and cannot become an executable revision.

History shows revision time, note, validation state, and associated runs/evaluations. Compare two revisions using exact YAML diff plus a semantic summary of agent/model/tool/permission changes. Formatting-only changes remain visible in the text diff.

**Restore** copies an old revision into the draft; saving creates a new revision with the current revision as its parent and records the restored source. It never mutates the old revision. Concurrent saves use draft generation checks and return a conflict rather than overwriting unseen edits.

Start run requires an explicit revision ID. From a dirty editor, offer **Save and run** or **Run last saved revision**, with the selected revision identified. Preflight reports validation, dependencies, credentials availability, workspace, and runtime compatibility before enqueueing.

### Snapshot boundary

A revision bundle contains the exact original YAML and copied local configuration dependencies: referenced instruction files, skills/config files, and other resolvable configuration assets. Store original reference, bundle location, and digest for each. Rewrite references only in the generated execution copy; preserve source YAML verbatim.

The initial resolver must define and test the supported dependency fields before release. An unsupported local configuration dependency blocks a reproducible run with a field-level explanation. Resolve relative paths against the source configuration directory, guard recursive references, and never silently drop a dependency. Mutable tool state (task stores, memory databases) and working repositories are workspace inputs, not immutable configuration assets.

Resolve external agent references to immutable content/digests where supported. If a reference cannot be pinned, mark the run as depending on mutable external content and require the user to select that execution mode. Evaluation comparisons requiring pinned inputs reject such references. Remote MCP implementations, hosted model aliases, network responses, and provider behavior remain external variability even with a complete bundle.

Record runtime version, provider/model identifiers, settings, dependency digests, workspace baseline, and any overrides. Store credential variable names and availability, never their values. New credential values can be used later without claiming identical execution conditions. Reject literal credentials in newly published revision bundles with guidance to use environment references; leave the draft editable.

### Execution architecture

Introduce a run manager behind a runtime adapter. First implementation targets a dedicated `serve api` child process per active run, with:

- An immutable materialized configuration directory containing only that run's team/dependencies.
- A separate runtime session database, run data directory, and loopback listener.
- A working directory passed using verified runtime mechanisms.
- Server-owned message submission, event capture, approvals, and lifecycle management.

Capability testing may select a CLI control-plane adapter instead if `serve api` cannot meet these requirements. This decision must preserve the run/event API; UI code does not call runtime-specific routes. No production implementation depends on unverified CLI flags or endpoints.

Queue runs beyond a configurable concurrency limit (initial default: two active runtimes). Reserve a slot before launch and release it after process cleanup. Edits, imports, and deletes of library files never restart active isolated runs. Existing global runtime controls apply only to legacy sessions during migration.

Workspace modes:

| Mode | Behavior |
| --- | --- |
| Fresh directory | New run-owned directory; default for general-purpose runs. Mutable tool stores use run-owned paths unless explicitly declared shared. |
| Git worktree | New worktree/branch from an explicit commit; default for repository evaluation fixtures. Baseline and branch are recorded. |
| Existing directory | User selects a directory; UI labels it shared and warns that concurrent runs may affect the same files. Evaluation v1 disallows this mode. |

Absolute tool storage paths and explicit shared resources must be reported by preflight. Remap supported default/relative mutable stores into the run workspace; reject unsupported paths in isolated mode instead of claiming separation. Filesystem tools may still reach other host paths unless the configured Docker Agent sandbox prevents it.

### Lifecycle and interaction

Run lifecycle: `queued → starting → ready ↔ running`, with `waiting_for_approval` during a blocked turn and `stopping` during cleanup. Terminal states are `completed`, `failed`, `cancelled`, and `interrupted`.

- `ready` means an interactive run is alive but idle between turns. A completed turn does not automatically complete an interactive run.
- Evaluation runs finish after their specified input turns and settle their runtime before grading.
- **Finish run** terminates an idle interactive runtime and records completion. **Cancel** removes a queued run or stops an active runtime; it is idempotent.
- Stream errors are recorded even if later recovered. Terminal outcome uses authoritative runtime evidence plus process state; a sub-agent error alone does not fail the entire run.
- Disconnecting a browser does not cancel a run. The server continues capture, and reopening the page resumes persisted events.
- Graceful cancellation uses verified runtime controls when available, with process termination as a bounded fallback. For Docker Agent v1.150.0, use active-session DELETE first. Track and verify descendants explicitly: killing only the plugin or its process group is insufficient after SIGKILL because shell tools may use another PGID. Distinguish confirmed termination from incomplete cleanup.
- Server shutdown cancels owned processes deliberately. Unexpected server/process loss marks unresolved runs `interrupted`; evaluation jobs are not silently rerun.
- Startup reconciles persisted ownership with live processes, verifies identities before signaling, and records missing trace intervals. Reattachment is allowed only if the adapter proves it can recover; otherwise terminate verified orphaned processes and preserve interrupted records.

A completed/interrupted run can be **Run again** as a new run. Resuming the same live interactive run is distinct from replaying its input in a fresh workspace. Recovery that resumes a terminated conversation is deferred until the adapter verifies it.

Archiving a configuration retains revisions and run links. Deleting a run removes only its owned workspace/process/session records after termination, never an existing user directory. Revisions referenced by retained runs or batches cannot be purged. Manual retention controls show disk usage; no automatic deletion of worktrees with uncommitted results in v1.

### Acceptance criteria

- Saving revision B during a run of A neither alters A's materialized configuration nor interrupts its stream.
- Two runs of the same revision have distinct sessions, mutable stores, listeners, and owned workspaces in isolated modes.
- Restoring A creates a new revision on save; previous history and runs remain intact.
- A stale editor save produces a conflict with an option to review the current content.
- Closing/reopening the browser preserves progress and the full captured event history.
- Credential/preflight failures do not launch an execution process or consume a concurrency slot indefinitely.
- Cancellation, timeout, process exit, and server restart leave accurate terminal states without verified orphan processes.
- Missing dependencies and shared paths are reported before execution; invalid revisions cannot start.

## 3. Run Inspector

### User experience

Add **Runs** navigation with filters for configuration, revision, lifecycle status, date, and interactive/evaluation mode. Each row shows outcome, duration, available cost, and trace completeness. Existing chat becomes the conversation view of an interactive run; Inspector links are available from chat, revision history, and evaluation results.

The run detail provides:

1. **Overview:** revision, runtime version, workspace/baseline, execution settings, status, timing, usage, and outcome reason.
2. **Activity:** persisted timeline grouped by turn and agent instance. Show model output, exposed reasoning when supplied, tool calls/results, approvals, delegation/handoff evidence, errors, and lifecycle events.
3. **Agents:** observed instances and parent/child tree only where runtime identifiers establish those links. Otherwise show a flat participant list labeled with the missing hierarchy information.
4. **Configuration:** pinned YAML, dependency manifest, and read-only topology.
5. **Logs:** run-scoped runtime logs and unrecognized event payloads for diagnosis.

Selecting an activity item opens inputs, outputs, timestamps, relevant IDs, and a link to the configured agent/tool where known. Search and filter by agent instance, tool, event kind, and errors. Expand large outputs on demand and paginate/virtualize history.

Keep pending approvals visible when switching tabs. Approval commands use run/session/tool identity rather than agent name alone, and report if the pending request has already resolved. Do not display Pause or Steer controls until capability tests verify their behavior. Cancel and connection status remain visible.

### Event capture and accounting

Persist every received runtime event before notifying subscribers. Retain unknown types for inspection. Normalize separately so later adapter versions can rebuild projections from stored data. Store runtime logs independently from semantic events.

Deckhand sequences support reconnect with `after=<sequence>` and durable paging. Replayed source events deduplicate only using reliable source IDs/sequences within their source scope. Do not deduplicate identical text payloads heuristically. Where the runtime cannot replay missed events, record a gap and set trace completeness to partial.

Use runtime IDs to correlate tool calls and responses, including source session/instance scope to avoid cross-agent collisions. Interleaved deltas are grouped by stable message/instance identity where available. If identity is insufficient, retain arrival order and label uncertain grouping.

Timing is based on server receipt unless source timestamps are available. Distinguish whole-run wall time, turn time, and tool time. Parallel agent durations are not added to produce wall time.

Usage aggregation must verify whether upstream reports deltas or cumulative totals, and whether parent totals include children. Never sum overlapping totals. Show per-agent attribution only if supported, otherwise show authoritative run totals or unavailable. Cost is runtime-reported or explicitly estimated with a versioned pricing source; unknown provider pricing stays unknown.

### Acceptance criteria

- A captured multi-agent run can be inspected after the runtime is stopped, independently of the runtime session API.
- Interleaved messages and duplicate tool IDs in separate source sessions remain correctly scoped.
- Unknown events and unmatched tool responses are retained and visible.
- Reconnecting from a Deckhand event sequence produces no omissions or duplicate persisted rows.
- Runtime gaps, absent parent IDs, and unavailable usage are explicitly represented.
- A child failure followed by root recovery remains an activity error without falsely marking the run failed.
- Browsing a 10,000-event fixture does not render the entire transcript at once; first-page display and filters respond within one second on the documented reference machine.

## 4. Evaluation Workbench

### Authoring cases

Add **Evaluations** navigation and **Evaluate revision** from history. Users create a suite, add cases manually or from a selected run input, and choose baseline/candidate revisions.

Creating a case from a run copies selected user inputs and proposed assertions into an editable draft. It does not copy live credentials, the current mutable workspace, or silently treat the historical answer as correct.

Each case specifies:

- Stable ID, name, description, tags, and ordered user input turns.
- Entry agent and fixture: empty directory, copied fixture files, or git repository plus exact commit.
- Explicit execution overrides, if any, applied equally across compared revisions and recorded in attempts.
- Timeout and supported token/cost limits.
- Assertions with scope (`final answer`, specific turn, or observed tool activity), expected value, and required/optional status.

The suite specifies repetitions (default one), maximum concurrent attempts bounded by the global run limit, batch spending limits where enforceable, and default case settings. Publishing creates an immutable suite version. Launching freezes that version and all selected revisions/settings.

V1 supports deterministic graders:

- Exact text or contains-text assertions with explicit case/whitespace handling.
- Final-answer JSON parsing and JSON Schema validation.
- Required or forbidden tool invocation, optionally matching structured argument fields.
- Observed token, cost, and duration thresholds where measurements are available.

Grade declared output scopes, never concatenated reasoning/tool output. A forbidden tool assertion means no invocation of that tool; it does not claim that equivalent actions through other tools are prevented. Assertions requiring unsupported telemetry are rejected at preflight or marked inconclusive if telemetry becomes missing during execution.

LLM judges, arbitrary shell/code graders, custom grader plugins, synthetic case generation, and CI execution are later extensions. A future LLM judge must pin its configuration, preserve rationale, and report uncertainty separately from deterministic checks.

### Scheduling and results

Every case/repetition/revision gets a fresh isolated run and fixture. No conversation or mutable tool state carries between attempts. Evaluations run unattended: a request requiring approval or elicitation is recorded as `needs_input` and stops that attempt. Existing runtime permissions/safety policies can authorize tools explicitly; the workbench does not silently enable auto-approval.

Grade results distinguish `passed`, `failed_assertion`, `execution_error`, `timed_out`, `needs_input`, `cancelled`, and `inconclusive`. Preserve individual assertion evidence and link to the Inspector. A retry is a new attempt with a link to the previous attempt, never an overwrite.

Comparisons match suite version, case ID, repetition, and settings. Show baseline/candidate results, transitions, duration, tokens, known costs, and YAML/semantic configuration diff. Mark a regression when a baseline pass becomes a candidate failure; separately report infrastructure errors and inconclusive attempts. With repeated attempts, show counts and rates rather than declaring a deterministic regression from a single sample.

The primary pass rate uses all planned attempts as its denominator, alongside passed/failed/error/cancelled/pending counts. Optional pass rate over graded attempts must be labeled with its denominator. Cost totals show coverage and known subtotal; missing values do not become zero. Paired latency/cost changes use only comparable measured pairs and report pair count. Cross-runtime-version comparisons remain allowed but show the changed runtime as a confounding input.

Budget enforcement belongs to the scheduler and runtime adapter. Do not start another attempt after the known budget is exhausted. Running attempts can exceed a batch spending target when provider telemetry is delayed; label that limit best-effort unless the adapter proves a hard bound. Timeout enforcement does not depend on the browser remaining open. Cancellation stops queued and active attempts and preserves existing results.

Allow JSON export of frozen suite/batch metadata, assertion evidence, and run IDs. Exports omit credential values and clearly identify incomplete traces. Full executable bundle export is deferred.

### Acceptance criteria

- A baseline and candidate execute the same frozen suite with separate workspaces and sessions.
- Editing the suite or configuration after launch does not change scheduled attempts.
- Deterministic assertions pass/fail against their specified scopes and expose supporting evidence.
- Unsupported metrics do not silently pass thresholds; unavailable observations are inconclusive.
- A blocked approval, timeout, or process failure has a distinct result from a wrong answer.
- Retries retain original attempts; comparison aggregates never double-count retries.
- Cancelling a batch prevents queued starts and terminates active attempts through the run manager.
- Reopening the browser preserves batch progress and result links.
- Aggregate denominators, cost coverage, and repetition counts remain correct for partial and cancelled batches.

## API boundary

Extend the existing `/api` contract with Deckhand-owned resources. Names below define responsibilities; implementation may refine payload shapes while preserving stable IDs and semantics.

| Endpoint | Responsibility |
| --- | --- |
| `GET /configurations/:id/revisions` | Paginated history. |
| `GET /revisions/:id` | Immutable content, manifest, validation and execution eligibility. |
| `GET /revisions/:id/diff?against=:otherId` | Text diff and semantic summary. |
| `POST /configurations/:id/restore` | Restore a revision into the draft with generation check. |
| `POST /runs` | Preflight and enqueue a pinned revision/workspace; returns run ID. |
| `GET /runs`, `GET /runs/:id` | Paginated listing and persisted detail. |
| `GET /runs/:id/events?after=:sequence` | Durable SSE subscription with replay. |
| `GET /runs/:id/activity?cursor=…` | Paginated persisted activity for historical browsing. |
| `POST /runs/:id/messages` | Submit an interactive turn. |
| `POST /runs/:id/approvals` | Resolve a specific pending approval. |
| `POST /runs/:id/cancel`, `POST /runs/:id/finish` | Idempotent lifecycle commands. |
| `GET/POST /evaluation-suites` | List/create suite drafts. |
| `GET/PUT /evaluation-suites/:id` | Read/edit with generation check. |
| `POST /evaluation-suites/:id/versions` | Publish immutable suite version. |
| `POST /evaluation-batches` | Freeze inputs and schedule attempts. |
| `GET /evaluation-batches/:id` | Progress, results and comparison. |
| `POST /evaluation-batches/:id/cancel` | Stop remaining work. |
| `GET /evaluation-batches/:id/export` | JSON results export. |

Creation and message-submission commands accept idempotency keys. Repeated keys with different payloads conflict. Invalid lifecycle transitions return actionable conflicts; capability failures report the specific unavailable requirement. Use cursors for potentially large lists. UI topology derives from the shared configuration parser/graph projection rather than a separate authoritative graph store.

## Runtime verification gate

Before implementing the run adapter, record executable capability findings against supported Docker Agent versions:

| Question | Required behavior or fallback |
| --- | --- |
| Can a dedicated runtime execute copied YAML with the correct config-relative paths and working directory? | Verify instructions, skills, MCP config, and mutable store path resolution. Block unsupported isolated configurations. |
| Can server-owned POST/SSE capture survive browser disconnects? | Server owns upstream connection and persists events; downstream cancellation affects only that subscriber. |
| How are terminal root outcomes and subordinate activity distinguished? | Verify representative success, recovered child error, limits, approval, and cancellation traces. |
| Are session/agent instance/message IDs sufficient for a hierarchy? | Use proven identifiers; otherwise provide a flat activity view. |
| Are usage reports cumulative, scoped, and inclusive of child usage? | Define one tested aggregation strategy per adapter/version. |
| Can the process be cancelled with active tools and safely reconciled after a crash? | Verify control endpoints/process groups; record incomplete cleanup and block additional writes to an affected workspace. |
| Can snapshots and event replay recover a capture connection? | Reattach only if verified; otherwise mark trace gaps/interruption. |
| Are token/cost limits enforced, and at what granularity? | Advertise hard or best-effort bounds accurately; reject unsupported required limits. |

These gates affect capability availability, not the persistence/domain model. Do not promise resume, fine-grained attribution, or a full agent tree until the necessary evidence exists.

Docker Agent v1.150.0 gate result: use `DELETE /api/sessions/:id?wait=true`
for graceful active cancellation; do not invent pause/cancel/stop routes. Treat
`max_iterations_reached` as waiting, root `stream_stopped` as terminal, and
subordinate errors as activity until root settles. Handoffs retain one session
ID and are evidenced by the handoff tool plus agent attribution; delegations
create child sessions and parent edges. Relative memory and stdio MCP paths
resolve from the run working directory; local skills require staging into a
server-visible project search root, and `todo.path` is unsupported. SIGKILL can
leave tool descendants alive even after killing a detached plugin group.

## Migration and delivery order

1. **Runtime capability verification:** test the installed version, document semantics and select the first adapter.
2. **Revisions and run foundation:** stable configuration IDs, dependency bundles, database, supervisor, isolated workspaces, durable event capture and basic interactive runs.
3. **Run Inspector:** history, activity projection, filtering, approvals, error/usage presentation and run-linked pinned configuration.
4. **Topology:** draft and revision graph, form integration, accessible alternative and diagnostics. This can be developed independently after graph semantics are defined.
5. **Evaluation Workbench:** suite versions, scheduler, deterministic graders, comparisons and export using the established run foundation.

On migration, inventory existing YAML files and establish initial revision history without modifying source content. Invalid or unsupported files remain editable with execution issues. Existing runtime sessions remain available through a **Legacy sessions** view; historical transcripts cannot be backfilled into reliable event traces or assigned a revision unless matching provenance exists. New execution uses isolated runs once the foundation passes acceptance checks. Keep the legacy supervisor separate until legacy compatibility is intentionally retired.

## Validation strategy

- Unit checks for graph projection/reference updates, revision manifests, lifecycle transitions, event correlation, usage accounting and grader scopes.
- Integration checks with a controllable runtime stub for interleaved events, approvals, unknown events, replay, disconnects, malformed frames, process exit and missing telemetry.
- Filesystem/process checks for revision durability, generation conflicts, isolated mutable paths, queue limits, cancellation and restart reconciliation.
- Real Docker Agent smoke checks for a single agent, delegation/handoff team, local file dependency, tool approval, git workspace, usage reports and an evaluation fixture. Record the tested runtime version.
- UI checks for stale draft topology, historical pinned views, reconnect, large trace browsing, keyboard graph navigation and partial batch comparisons.

The first release is complete when all four feature acceptance criteria pass and users can follow the representative workflow without a configuration edit interrupting an existing run, an inspection view inventing telemetry, or an evaluation silently reusing mutable state.
