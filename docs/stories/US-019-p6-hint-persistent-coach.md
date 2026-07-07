# US-019 P6 — hint widget becomes a persistent next-action coach

## Status

implemented

## Lane

tiny

## Product Contract

The below-editor hint widget stops returning `undefined` (vanishing) once the
DB is initialized; it becomes a persistent next-action line sourced from
`readiness()`, so the user always sees the next step without opening the
dashboard.

Umbrella intake: **#23**. Roadmap: `docs/initiatives/P6-status-action.md` (M2).
**blocked-by:** US-018 (consumes `readiness()`).

## Relevant Product Docs

- `docs/initiatives/P6-status-action.md` — M2
- `extensions/harness/index.ts` — `hintLines` (150–196) + its `setWidget` call
- `extensions/harness/gates.ts` — `readiness()` (delivered by US-018)

## Acceptance Criteria

- `hintLines` returns a next-action line whenever `readiness().firstUnmet` is
  set — including after the DB is ready (it no longer vanishes).
- When nothing blocks, the widget clears (no stale hint).

## Design Notes

- Today `hintLines` only covers the install case; it returns `undefined` once
  `cli+db` are present. Extend it to consult `readiness()`.
- Consumes the `readiness()` contract from US-018 (hence blocked-by).

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | `hintLines` returns next-action for each `firstUnmet` branch |
| Integration | 0 |
| E2E | 0 |
| Platform | 0 |
| Release | 0 |

## Harness Delta

None (presentation only).

## Evidence

`hintLines(state, drift, session)` exported from index.ts — now consults
`readiness()` once the DB is ready: returns `["Harness: <nextAction>."]` for
any `firstUnmet` (intake/drift/trace) and `undefined` when ready (cleared, no
stale hint). Install/db-init branches unchanged. Call site index.ts:~820
threads `drift` + `session`. p6 tests: 5 hintLines branches (install, db-init,
intake, drift, trace, ready→undefined). tsc clean; p2 44 p3 33 p4 58 p5 34
p6 34; lens 0.
