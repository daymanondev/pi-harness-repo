# US-030 Overnight Auto-Pilot: Unattended Implement-All-Grilled Runner

## Status

planned

## Lane

normal

> **Grilled:** `spec_slice` intake #43 links this story (`●`). Classification:
> flags `existing-behavior` (reuses shipped US-027 `sendUserMessage` dispatch;
> regression risk to the dashboard) + `weak-proof` (planned stub, matrix all-`no`).
> No hard gate in v1 (commit-to-local-branch, no remote push; high-risk stories
> gated for human). 2 flags → normal with stronger validation.

## Product Contract

A **dashboard-launched, unattended orchestrator** ("auto-pilot") that loops over
every grilled (`●`) story still in `planned` status and, for each, sequentially:
spawns a **worker sub-agent** (or runs inline in the main agent) to implement the
story from its packet → runs `harness-cli story verify` → records a
`harness-cli trace` linked to the story → (optionally) auto-commits to a local
branch → (optionally) records backlog friction → proceeds to the next. Runs the
whole queue sequentially, unattended, through the night.

**Entry point = a dashboard AUTO-PILOT tab + settings panel** (the operator's
fork choice). The dashboard does **not** spawn sub-agents itself (US-028's
blocker — ExtensionAPI has no `spawnSubagent`); instead it builds a **configured
loop-prompt** and dispatches it via the shipped US-027 `sendUserMessage` path.
The receiving **agent** then runs the loop and spawns `worker` sub-agents through
its own `subagent` tool + `wait`. This sidesteps US-028 entirely, so **US-030 is
unblocked by US-028** (which remains the deferred *interactive pane-watch*
variant).

- `isGrilled` is computed **inline** (`harness-cli query sql` →
  `SELECT DISTINCT story_id FROM intake WHERE input_type='spec_slice' AND
  story_id IS NOT NULL`) — the loop has **no dashboard dependency** for the
  grilled signal. The packet's original "no dashboard dep" note referred to this
  signal routing, not the entry point.
- **Headless execution**: pi async subagents + `wait`, NOT mux panes (US-028 is
  the interactive pane mode; auto is different).
- **Depends on US-029** (stories pre-grilled) for *implementation* — the pilot
  implements grilled stories, it does not grill. Grilling US-030 itself does not
  require US-029; running it does.
- **High-risk stories are gated**: the pilot auto-implements only `tiny`/`normal`
  grilled stories. High-risk stories are skipped + flagged for human review
  (FEATURE_INTAKE.md requires human confirmation before high-risk implementation).
- **No remote push in v1**: workers commit to a local branch only. Remote push is
  a separate high-risk slice (External-systems + Audit/security hard gates).

## Relevant Product Docs

- `docs/stories/US-027-dashboard-backlog-triage-keys.md` — the `sendUserMessage`
  dispatch primitive this slice reuses.
- `docs/stories/US-023-dashboard-grilled-badge-next-action.md` — the `isGrilled`
  signal (spec_slice intake linkage) the loop queries inline.
- `docs/stories/US-029-bulk-grill-runner.md` — prep phase (grills the queue so the
  pilot has stories to implement).
- `docs/stories/US-028-dashboard-dispatch-backend-deferred.md` — why the dashboard
  cannot spawn sub-agents and how US-030 bypasses it (agent-side spawn).
- `docs/decisions/0014-dashboard-dispatch-policy.md` — permits in-session
  `sendUserMessage` dispatch (the authority for the dispatch path).
- `docs/decisions/0010-initiative-slices-workflow-model.md` — initiative/slice
  model this story belongs to.
- `docs/FEATURE_INTAKE.md` — input types/lanes; high-risk human-confirmation rule.
- `skills/harness-intake-griller/SKILL.md` — this grill (intake #43).
- pi-subagents skill (async runs + `wait`), `docs/TRACE_SPEC.md` (per-story trace).

## Acceptance Criteria

### Dashboard entry + settings (v1)

- [ ] An **AUTO-PILOT tab** (or action on the Matrix tab) is reachable in the
  `/harness` dashboard and renders a settings panel.
- [ ] Settings panel exposes the operator's four requested controls:
  - **Run mode**: `main-agent` (inline loop) | `sub-agent` (spawn `worker` per story).
  - **Auto-commit**: on/off (on → commit each completed story to a local branch).
  - **Auto-backlog**: on/off (record harness friction / `backlog add` found during impl).
  - **Backlog priority**: `off` | `backlog-first` (drain open backlog before stories) | `interleave` (1 backlog item per N stories).
- [ ] Settings panel also exposes the safety-critical controls derived during grill:
  - **Lane scope**: `tiny` | `tiny+normal` | `all-non-high-risk` (high-risk always gated — non-negotiable).
  - **Story cap / max iterations**: safety limit per run (e.g. 20; 0 = unlimited).
  - **Halt-on failures**: stop after N consecutive failures (0 = never halt; default 3).
  - **Verify gating**: `required` (must pass verify to commit/proceed) | `best-effort` (commit anyway, record fail).
  - **Worker tool budget**: `restricted` (block `git push`, `rm -rf`, force) | `standard`. Default `restricted`.
- [ ] A **dispatch action** builds a loop-prompt from the settings and sends it via
  `sendUserMessage` (US-027 pattern). No new spawn API; no harness-cli mutation
  from the overlay itself (read-only invariant held except the dispatch).

### Loop body (agent-side, runs after dispatch)

- [ ] The loop queries grilled+planned stories via inline SQL (`isGrilled`), filtered
  by lane-scope and story-cap.
- [ ] For each story **sequentially**: spawn `worker` sub-agent (async, when
  run-mode=sub) → `wait` → `harness-cli story verify <id>` → `harness-cli trace`
  linked to the story → (auto-commit to local branch if on) → (record backlog
  friction if on) → next.
- [ ] High-risk stories are skipped and flagged in a summary, never auto-implemented.
- [ ] On worker/verify failure: record a failure-trace and **continue** to the next
  story, up to the halt-on-failures threshold.
- [ ] No `git push` or remote operation occurs in v1.
- [ ] A run **summary** is produced at the end (stories done / failed / skipped,
  verify pass/fail counts, backlog items recorded).

### Out of scope (v1)

- Remote push to a remote (separate high-risk slice + ADR).
- Settings persistence across sessions / resume-from-checkpoint (implies a new
  `autopilot_runs` table → `data-model` flag; deferred).
- Interactive per-story pane-watching (US-028).

## Design Notes

- **Commands** (agent-side, existing CLI — no new schema):
  - `harness-cli query sql "SELECT DISTINCT story_id FROM intake WHERE input_type='spec_slice' AND story_id IS NOT NULL"` — grilled set.
  - `harness-cli query sql "… story WHERE status='planned' AND risk_lane IN ('tiny','normal')"` — runnable queue (joined with grilled set).
  - `harness-cli story verify <id>` — per-story proof.
  - `harness-cli trace --summary … --story <id> --outcome …` — per-story trace.
  - `harness-cli backlog add --title … --pain …` — friction captured during impl.
  - `harness-cli story update --id <id> --status implemented …` — status flip on success.
- **Queries**: grilled set + planned-status filter computed once at loop start;
  re-checked per iteration is unnecessary (sequential, no concurrent writers).
- **API**: none new. Dashboard dispatches via `sendUserMessage` (US-027).
- **Tables**: none new in v1. (Checkpoint/persistence deferred — would add
  `autopilot_runs` + tick `data-model`.)
- **Domain rules**:
  - High-risk lane → always gated (skip + flag), never auto-implemented.
  - Failure is recoverable: record trace, continue, count toward halt threshold.
  - One commit per completed story (when auto-commit on), branch naming
    `auto/<story-id>` (or a shared `auto/overnight-<date>` branch — setting TBD).
  - Worker inherits a restricted tool budget (block push/destructive) regardless of
    the worker's own defaults.
- **UI surfaces**: `/harness` dashboard → AUTO-PILOT tab → settings panel →
  dispatch action; run summary rendered at completion (and optionally surfaced via
  the next-action footer / intercom notification).

### Proposed additional settings (operator asked to surface interesting options)

Beyond the four the operator named, the panel should consider:

- **Worker model + turn budget** — override the worker model and cap turns per
  story (prevents a single stuck story from burning the night).
- **Dry-run / plan-only** — spawn workers in plan-only mode (no writes) to preview
  the queue, then a real run. Cheap safety before an overnight commit run.
- **Trace tier** — `compact` vs `full` per story (controls trace volume overnight).
- **Notifications** — intercom a summary to a session on completion / on
  halt-on-failures (so the morning operator is pinged, not just the dashboard).
- **Backlog-priority semantics** — `backlog-first` drains open backlog items before
  stories; `interleave` runs one backlog item per N stories. Needs a clear
  definition of "resolve a backlog item" (likely: grill + implement the backlog
  item's fix as a tiny slice).

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-030 --unit 1 --integration 1 --e2e 0 --platform 0`.

`verify_command` baseline: `npx tsc --noEmit` (repo-wide gate); the p4 dashboard
suite gains AUTO-PILOT tab cases at implementation. e2e proof = a dogfood run on
one tiny grilled story (deferred to the first real overnight run, mirroring the
griller-skill e2e caveat on US-013/US-032).

| Layer | Expected proof |
| --- | --- |
| Unit | settings → dispatch-prompt builder (pure fn, US-027 `dispatchPromptFor` pattern); settings parser; grilled-set SQL reuse. |
| Integration | AUTO-PILOT tab wiring in `dashboard.ts`/`index.ts`; p4 suite cases (render, dispatch, error degrade); `npx tsc --noEmit` clean. |
| E2E | Dogfood: run the pilot on one tiny grilled story end-to-end (implement → verify → trace → commit). Deferred to first real run. |
| Platform | (none — headless agent procedure; runs wherever pi runs) |
| Release | Full dogfood overnight run + log/trace review. |

## Harness Delta

- New dashboard control-surface feature (initiative #29 / ADR-0010 slice model).
  Reuses US-027 `sendUserMessage` dispatch (permitted by ADR-0014) — no new ADR
  needed for v1 (normal lane, no hard gate).
- **Reusable pattern surfaced**: the dashboard dispatches a *prompt* and the
  *agent* spawns sub-agents — this bypasses the US-028 "dashboard can't spawn
  subagents" constraint for any future headless dispatch feature. Worth recording
  as a backlog note if a second consumer appears.
- Candidate backlog items (out of v1 scope, to file when implementation begins):
  - Settings persistence + resume-from-checkpoint (→ `autopilot_runs` table,
    `data-model` flag, normal lane).
  - Remote-push toggle (→ high-risk slice: External-systems + Audit/security hard
    gates, requires ADR).
  - Backlog-priority "resolve a backlog item" semantics definition.
  - `story update` has no `--lane` (backlog #14) — the pilot cannot reclassify a
    story's lane; it only reads `risk_lane` to gate high-risk.

## Evidence

- Grill: `spec_slice` intake #43 links this story (`●` grilled). See
  `scripts/bin/harness-cli query sql "SELECT * FROM intake WHERE story_id='US-030'"`.
- No implementation yet (status `planned`). Acceptance criteria + design notes
  filled at grill time per `skills/harness-intake-griller/SKILL.md`.
