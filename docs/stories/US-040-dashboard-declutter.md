# US-040 Dashboard declutter — keep only Matrix + Backlog tabs

## Status

implemented

## Lane

normal

## Product Contract

The `/harness` dashboard had grown to eight tabs (matrix, stats, backlog,
tools, drift, timeline, decisions, initiatives). In daily dogfooding only
**Matrix** and **Backlog** carry signal; the rest are noise. This slice
reduces the overlay to those two surfaces and deletes all code that existed
only to serve the removed tabs — a true cleanup ("dọn"), not a hide.

Detection (`detect.ts`), the enforcement gates (`gates.ts`), drift detection
(`drift.ts` → Gate B′ + footer), and the next-action footer/injection are
**unchanged**: none of them depend on the removed tabs. Drift still runs
through `detectDrift` directly (not the deleted drift TAB), so the footer +
Gate B′ keep working.

## Relevant Product Docs

- `docs/initiatives/0002-dashboard-focus-rework.md` — this initiative (#56)
- `docs/stories/US-011-*` — the original stats/backlog/tools triplet (tabs removed here)
- `docs/stories/US-012-*` — the drift TAB (removed; `computeDrift`/Gate B′ retained)
- `docs/stories/US-015-*`, `US-024-*`, `US-036-*` — timeline / decisions / initiatives tabs (removed)
- `extensions/harness/dashboard.ts` — pure view (2 tabs only)
- `extensions/harness/index.ts` — fetch wiring (6 fetches only)

## Acceptance Criteria

1. **two tabs only**: `DashboardTab = "matrix" | "backlog"`; `DASHBOARD_TABS`
   lists exactly `1 matrix` + `2 backlog`; no other hotkeys switch tabs.
2. **dead code deleted**: the render functions, parsers, and types that served
   only stats/tools/drift/timeline/decisions/initiatives tabs are removed
   (`renderStatsTab`, `renderToolsTab`, `renderDriftTab`, `renderTimelineTab`,
   `renderDecisionsTab`, `renderInitiativesTab`, `parseStats`,
   `parseToolsJson`, the timeline parsers, the ADR parsers, etc.).
3. **data pruned**: `DashboardData` keeps only `matrix, backlog, packets,
   classifiedStoryIds, provenance, initiatives, errors` (the fields the
   surviving surfaces + story-detail need); `fetchDashboardData` runs only the
   6 kept fetches.
4. **surviving surfaces intact**: Matrix (rows, classified badge, status,
   proofs, `[f]` filter, `[s]` dispatch, drill → story detail with initiative
   `#id` + provenance) and Backlog (rows, drill → backlog detail, `[s]`
   dispatch) render exactly as before.
5. **detection/gates/footer untouched**: drift detection (Gate B′) and the
   next-action footer/injection behave identically (drift is computed via
   `detectDrift`, independent of the removed drift TAB).
6. **purity + tests**: `dashboard.ts` stays pure (no pi imports). `npx tsc
   --noEmit` clean across `extensions`+`tests`. `p2/p3/p4/p6` pass; `p5`
   (timeline-only) deleted.

## Design Notes

- **Why hard-delete, not hide**: the operator called the dashboard "a garbage
  dump" and the six tabs "meaningless". Hiding would leave dead, tested code;
  deleting is the real cleanup. The tabs remain recoverable via git + the
  initiative notes (0002), and each was a completed US whose history is
  preserved.
- **Kept `initiatives` data, removed the tab**: `parseInitiatives` /
  `InitiativeGroup` / `fetchInitiatives` are retained because the matrix
  story-detail pane uses `findParentIntake` to show a story's initiative, and
  US-041 (next slice) shows the initiative `#id` on every matrix row. The
  *separate* initiatives TAB is what was redundant.
- **`flattenInitiativeSlices` removed**: it only fed the initiatives-list drill
  in `renderDetail`; with that branch gone it is unused.
- **Drift TAB ≠ drift detection**: removing `renderDriftTab` + the dashboard
  `drift` fetch does not affect Gate B′ or the footer, which use
  `detectDrift`/`driftCache` directly.

## Evidence

Implemented (intake #57 spec_slice, worker fork run; intake #58 self-unblock).
`dashboard.ts` rewritten to a 2-tab surface (`DashboardTab = "matrix" |
"backlog"`, `DASHBOARD_TABS` = `1 matrix / 2 backlog`); ~30 tab-only symbols
deleted; `DashboardData` pruned to `matrix, backlog, packets,
classifiedStoryIds, provenance, initiatives, errors`; `renderDashboardLines`
- `renderDetail` dispatch only matrix/backlog; `reduceDashboardNav` lens →
`{matrix, backlog}`. `index.ts`: removed `fetchStatsCounts`/`fetchToolRows`/
`fetchDrift`/`fetchTimeline`/`fetchDecisions`; `fetchDashboardData`
`Promise.all` over the 6 kept fetches; `handleInput` lens + `dispatchTarget`
trimmed. `tests/p5.test.ts` deleted (timeline-only); `tests/p4.test.ts`
trimmed to the kept surfaces (matrix/backlog/dispatch/normalizeKey/story-
detail/grilled-badge/filter/provenance/wiring + the pure `computeDrift`
block). Verified: `npx tsc --noEmit` exit 0; p2 48 / p3 33 / p4 93 / p6 36 all
pass; direct `detectDrift` = 0 drifts (Gate B′ + footer unaffected). Net
−2025 lines. Slice of initiative #56.
