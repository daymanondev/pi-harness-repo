# US-004 P2 — enforcement gates (A / A′ / B / B′ / C)

> **Session handoff story.** Created as the post-compact target so a fresh
> session opens with a clear P2 objective. Source spec: `pi-harness-design/DESIGN.md` §9.2.

## Status

planned

## Lane

normal

## Product Contract

pi-harness must turn the harness Task Loop from documentation into runtime
rails, using pi's **blockable** `tool_call` event and the injectable
`before_agent_start`. Enforcement is on by default for any repo where
`cliInstalled && dbInitialized`; failure is always a guide (carry the exact
command to run), never a wall.

## Relevant Product Docs

- `pi-harness-design/DESIGN.md` §9.1 (live-state injection), §9.2 (Gate A/A′/B/B′/C), §13.5/§13.6 (open bypass/scope questions)
- `extensions/harness/detect.ts` (existing detection — P2 adds `intakeRecorded`)
- `docs/HARNESS.md` → Task Loop + Done Definition
- `docs/CONTEXT_RULES.md` (what to read per phase/lane)

## Acceptance Criteria

### Gate A — Intake gate (hard-block on implementation)

- On `tool_call`, intercept `write`/`edit`/`bash` (non-harness-cli) mutation tools.
- If `cliInstalled && dbInitialized && !intakeRecorded` → return `{ block: true, reason }` carrying the exact `intake` command.
- `intakeRecorded` seeded each `before_agent_start` by diffing `query intakes` count vs previous turn; cleared the moment a `tool_result` for `harness-cli intake` lands (exit 0).
- Never block `harness-cli` read/query/init calls.

### Gate A′ — Precondition gate (db not initialised)

- When `!dbInitialized`, all mutation tools block with a route to `init` + `migrate` + re-`query matrix`, never to editing.

### Gate B — Trace gate (soft nag before done)

- `before_agent_start` appends a "no trace this session" reminder every turn until `query traces` shows a new row.
- Footer shows `⚠ no trace` badge in the same state.

### Gate B′ — Drift gate (hard-block on close) — folded from US-003

- Run `detectDrift(cwd, exec)` cross-check (markdown `## Status` ↔ durable `story.status`, plus orphan/evidence checks).
- Refuse the done/trace step when `drift.length > 0` for the story being closed.
- Footer shows `🪢 ⚠ N drifted` whenever any drift exists.

### Gate C — Friction prompt (non-blocking)

- On non-zero `bash` exit or retried `edit`, raise a one-line widget: "Hit friction? `harness-cli backlog add …`".

### Cross-cutting

- All four gates guarded by `cliInstalled && dbInitialized` (only gate real harness repos).
- Bypass UX (§13.5): decide hard-block vs soft-block-with-`/harness` override before P2 ships.
- Scope (§13.6): decide whether the gate also fires on mutating `bash` (e.g. `git commit`) or only `write`/`edit`.
- Live-state injection (§9.1) ships with this phase: a few-line `before_agent_start` message with current counts.

## Design Notes

- `intakeRecorded` lives in the per-cwd session state map populated by `detectHarness`/`detectHarnessCached`.
- `detectDrift` is pure + injected-exec (same pattern as `parseStats`); source of durable truth = `query matrix`, source of markdown truth = read `docs/stories/US-*.md` `## Status`.
- Reuse the drift cross-check already prototyped in `trace #5`/`#6` notes (the node script).
- Gate A reason string must always include the exact command (§9.2: "a guide, not a wall").

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | `detectDrift` fixtures cover all 4 drift kinds + clean case; `isHarnessCliCall` regex |
| Integration | in a fixture repo: edit blocked pre-intake, allowed post-intake; drift blocks done |
| E2E | N/A |
| Platform | N/A |
| Release | N/A |

## Harness Delta

- Folds retired US-003 (Gate B′ + drift footer + Drift tab placeholder).
- Extends `extensions/harness/{detect,index}.ts`; likely adds `gates.ts` + `drift.ts`.
- Resolves §13.5 (bypass UX) and §13.6 (gate scope) as part of implementation.

## Evidence

To be added after P2 implementation.
