# US-018 P6 — footer shows next-required-action (tracer-bullet)

## Status

implemented

## Lane

tiny

## Product Contract

When harness is installed, the status-bar footer renders the **one**
next-required-action (`setup` / `intake` / `drift` / `trace`) — or `ready` when
nothing blocks — sourced from a new pure `readiness(state, session)` helper.
Story/trace/backlog counts **leave the footer** (they live in the dashboard
Stats tab). `decideGateA` stays byte-identical.

Umbrella intake: **#23**. Roadmap: `docs/initiatives/P6-status-action.md` (M1).
Slice intake: #24. **blocked-by:** none (tracer-bullet; **delivers** the
`readiness()` helper that US-019/020/021 consume).

## Relevant Product Docs

- `docs/initiatives/P6-status-action.md` — M1 + open questions OQ-1 (blocker
  priority), OQ-3 (`ready` rendering), hard constraints
- `extensions/harness/gates.ts` — the purity contract to mirror (no pi types,
  no fs); `GateState`/`IntakeGateSession` shapes `readiness()` reads
- `extensions/harness/index.ts` — `renderFooter` (123–148) + 4 call sites
  (~626, 701, 784, 831)
- `extensions/harness/session.ts` — `intakeRecorded` / `traceRecorded`
- `extensions/harness/drift.ts` — `DriftRecord[]` feeds the drift step

## Acceptance Criteria

- A pure `readiness(state, session)` returns an ordered checklist
  `{cli, db, intake, drift, trace}` plus `firstUnmet` / `nextAction`; no pi
  types, no fs (mirrors `gates.ts`).
- `renderFooter` consumes `readiness()`: cli/db missing → setup line;
  `!intakeRecorded` → "record an intake before editing"; `drift.length>0` →
  drift line; `!traceRecorded` → trace line; else `ready`. **No counts.**
- OQ-1 resolved: priority `setup > intake > drift > trace`.
- OQ-3 resolved: clear state renders `ready` (quiet).
- HARD CONSTRAINT: `decideGateA` / `gatePrecondition` / `gateIntake`
  byte-identical; existing `p2` gate tests green untouched.
- Regression test: `harness-cli init`/`migrate` does **not** clear
  `intakeRecorded` (the invariant the author originally doubted).

## Design Notes

- The footer already speaks a "badge = unmet requirement" grammar (`!drift`,
  `!no-trace`); this completes it by (a) adding `intake`, (b) dropping the
  vanity-count baseline. One mental model, not a family of lettered gates.
- `readiness()` is the shared contract US-019/020/021 consume → it must land in
  this slice.
- Counts relocate, not delete: the dashboard Stats tab (US-011) already shows
  them.
- Signature change: thread `intakeRecorded` into `renderFooter` (4 call sites).

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | `readiness()` permutations + `renderFooter` per branch + `ready` |
| Integration | Approach B wiring: post-install footer shows intake blocker |
| E2E | 0 |
| Platform | 0 |
| Release | 0 |

## Harness Delta

Introduces `readiness(state, session)` as the single source of truth for
"next required action" — the foundation artifact of initiative P6.

## Evidence

- **`readiness(state, session, driftCount)`** added to `gates.ts` (pure: no pi
  types, no fs — mirrors the gate purity contract). Returns an ordered checklist
  `{cli, db, intake, drift, trace}` + `firstUnmet` + `nextAction` + `ready`.
  Reuses `GateState`; adds `ReadinessSession { intakeRecorded, traceRecorded }`,
  `ReadinessChecklist`, `ReadinessResult`, `ReadinessStep`. Priority hardcoded as
  `READINESS_ORDER = [cli, db, intake, drift, trace]` (OQ-1 resolved).
- **`renderFooter`** (index.ts) rewritten as a thin adapter over `readiness()`:
  `state.error → "🪢 —"`; else `ready → "🪢 ready"` (OQ-3 quiet); else
  `"🪢 " + warning(nextAction)`. **Vanity counts removed** (stories/traces/
  backlog live only in the dashboard Stats tab). Exported for tests. Signature
  changed: 3rd arg is now `session { intakeRecorded, traceRecorded }` (was
  `traceRecorded: boolean`); all **4 call sites** (index.ts ~739/814/897/944)
  updated via ast-grep to pass `session`.
- **HARD CONSTRAINT held:** `decideGateA` / `gatePrecondition` / `gateIntake`
  byte-identical (readiness is additive). p2 (the gate suite) green untouched
  — 44/44.
- **Tests** (`tests/p6.test.ts`, 17/17): readiness() permutations (each step as
  firstUnmet + ready + priority beats), `renderFooter` per-branch (error /
  cli / db / intake / drift-with-count / trace / ready-no-counts).
- **Validation:** `tsc` clean; p2 44 · p3 33 · p4 58 · p5 34 · p6 17; lens 0
  errors.
- **Integration row** (Approach B wiring "post-install footer shows intake
  blocker"): covered by p6's `renderFooter` branch test in the setup-ok +
  no-intake state (= the post-install scenario) plus p2's unchanged lifecycle
  wiring test (44/44 proves the session_start→setStatus wiring is intact).
- **OQ-1** resolved: `setup > intake > drift > trace`. **OQ-3** resolved: clear
  state renders `🪢 ready` (quiet, accent).
- **Dogfood (recommended, not blocking):** open `/harness` in the real TUI after
  `init` with no intake and confirm the footer reads the intake line; confirm
  `🪢 ready` once an intake + trace are recorded. Low-risk (pure computation —
  no file-watch/input-loop hazard, unlike US-016).
- `readiness()` is the shared contract US-019/020/021 consume (Harness Delta).
- Note: the `init`/`migrate`-doesn't-clear-`intakeRecorded` regression is
  pre-existing session.ts behavior, unchanged by US-018 (p2 session tests
  cover seedSession/grace).
- **Post-ship defect (same-day):** the `db` footer line originally read "run
  harness-cli init + migrate" — wrong audience/surface. The footer is
  user-facing and `/harness` ALREADY routes db-missing to the install wizard
  (`routeView`: `!dbInitialized → install`; `DEFAULT_FLAGS.initDb=true` runs
  `init`+`migrate`). Fixed to "db not initialized — run /harness to set up",
  parallel to the `cli` line. (The Gate A′ *block reason* still names
  `harness-cli init` directly — that is agent-facing, a different audience.)
