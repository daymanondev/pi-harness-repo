# US-026 Dashboard Matrix Status-Filter Cycle (Part D Automation)

## Status

implemented

## Lane

normal

## Product Contract

The Matrix tab lists **all** stories in one flat list — 22 implemented, 2
retired, 6 planned — so the work that actually matters (the 6 planned, of which
all are ungrilled) is buried under ~24 done rows. The original US-026 contract
(`n` → jump to the single next action + a grill-queue badge count) pointed at
exactly **one** story and hid the rest of the queue. This reshape replaces that
with a list-level **status filter** so the operator can *see the whole queue of
work-in-status-X*, then pick — turning the matrix from "where is the work?" into
"show me the work, by status".

- On the **Matrix tab**, a single key **`f`** cycles a status filter that
  narrows the visible story rows. Cycle (wraps):

  ```text
  all → planned → ungrilled → done → all
  ```

- Stop semantics:
  - `all` — every story (current behavior, no filtering).
  - `planned` — `status = planned` (work not yet started).
  - `ungrilled` — the **grill queue**: planned stories with **no** `spec_slice`
    intake linked (the US-023 intake-linkage signal). This is the primary stop
    this reshape exists to surface.
  - `done` — `status = implemented`.
  - `retired` is deliberately **not** a stop (only 2 stories; they stay visible
    under `all` as low-signal noise).
- The **active filter** is rendered in the matrix hint/footer line
  (e.g. `filter: planned`).
- The dashboard stays **read-only / advisory** (US-014 Command-Query
  invariant): filtering is a client-side view transformation; no durable writes.

Scope: **Matrix tab only.** The Backlog tab has its own status vocabulary
(proposed/accepted/rejected/implemented) and US-027 adds triage keys (`c`/`p`/`e`)
there — a backlog filter is a separate story to avoid coupling two status
models. The `n` → jump-to-one affordance is **dropped**: the footer (US-018)
already surfaces the single next-required-action globally, so next-action
routing is not lost — the matrix gains list-level filtering instead.

## Relevant Product Docs

- `extensions/harness/dashboard.ts` — `DashboardNav` + `reduceDashboardNav`
  (US-014 key→nav reducer, extended with `f`), `renderMatrixTab` /
  `renderDashboardLines` (active-filter label), `parseGrilledStoryIds`
  (US-023 signal reused for the `ungrilled` stop — no new data fetch)
- `extensions/harness/index.ts` — `handleInput` wiring (`f` dispatches through
  the reducer) + the matrix data fetch (already carries `grilledStoryIds`)
- `docs/stories/US-023-*.md` — the grilled/ungrilled intake-linkage signal this
  filter reuses; `nextActionFor` (unchanged)
- `docs/stories/US-014-*.md` — drill-down navigator + its read-only invariant
  (this slice extends *filtering*, does not relax the invariant)
- `docs/stories/US-027-*.md` — backlog triage keys (sibling slice; explains why
  backlog is out of scope here)
- `docs/FEATURE_INTAKE.md` — input types/lanes (this slice = spec_slice, normal)
- Backlog #5 + umbrella intake #29 (control-surface initiative); this packet's
  grill = intake #37

## Acceptance Criteria

1. **`f` cycles the matrix filter** through `all → planned → ungrilled → done →
   all` (wraps from `done` back to `all`). The key only acts on the Matrix tab;
   on other tabs `f` is a no-op (or reserved — see Design Notes). The active
   filter is shown as a label in the matrix body (e.g. `filter: planned`).
2. **Row filtering is correct per stop**: `planned` shows only `status=planned`;
   `done` shows only `status=implemented`; `ungrilled` shows stories that are
   `status=planned` **AND** have no linked `spec_slice` intake (grill queue,
   US-023 signal); `all` shows every row (byte-identical to today).
3. **Pure derivation**: a pure `filterMatrixRows(rows, grilledStoryIds, filter)`
   in `dashboard.ts` (no pi runtime) is the single source of truth for which
   rows a given filter shows. The `f`-cycle is a pure extension of
   `reduceDashboardNav` that writes a new `matrixFilter` field on `DashboardNav`.
4. **Cursor + drill stay correct under filter**: when a filter shrinks the list,
   the cursor clamps into range (no out-of-bounds). `Enter` drill-down indexes
   into the **filtered** list and resolves to the correct story detail pane
   (drill target = the actual story at the filtered position, not the
   unfiltered index).
5. **Tab switch resets the filter to `all`** (consistent with the existing
   cursor-reset-on-tab-switch idiom). `r` refresh **preserves** the active
   filter (refresh re-fetches data, does not change the view mode).
6. **Read-only preserved (US-014)**: no new durable writes from the dashboard;
   filtering is client-side only. Verify by inspection: no
   `intake`/`story`/`trace`/`backlog` write calls added in the render path.
7. **Regressions**: tab-switch `1`-`6`/`t`, `r` refresh, `↑/↓`/`j`/`k` cursor,
   `Enter` drill, `Esc` back/close all unchanged. Other tabs (stats/backlog/
   tools/drift/timeline/decisions) unaffected. Backlog tab's future `c`/`p`/`e`
   (US-027) does not collide because `f` is matrix-scoped.
8. **Purity + tests**: `filterMatrixRows` and the `f`-cycle branch of
   `reduceDashboardNav` are pure and covered by unit tests in `tests/p4.test.ts`:
   each stop's row set, empty-result rendering, cursor clamp on shrink, and
   drill-into-filtered-list resolution. `npx tsc --noEmit` clean.

## Design Notes

- **Why a single cycle key over per-status toggles:** one key, exactly one
  active filter at a time → deterministic and trivially testable; matches the
  `r`-refresh single-key idiom; avoids key-budget collisions with US-027's
  `c`/`p`/`e` on the backlog tab. Per-status toggles would also allow
  combinatory filters the operator does not need and the test surface does not
  want.
- **Why `ungrilled` is a distinct stop:** it *is* the grill queue — the primary
  signal this reshape exists to surface. It reuses the US-023 intake-linkage
  signal (`parseGrilledStoryIds`, already fetched for the `●`/`○` badge), so
  **no new data fetch** is needed; the filter joins in memory.
- **Why matrix-only:** the backlog tab's status vocabulary differs
  (proposed/accepted/rejected/implemented) and US-027 will own its interaction
  surface. Folding two status models into one filter story would couple
  unrelated test surfaces; a backlog filter is a clean follow-up story.
- **Why drop `n` → jump-to-one:** "jump to one" is strictly weaker than "filter
  to the queue" — it names one story and hides its siblings. The footer (US-018)
  already provides the single next-required-action globally, so the dashboard
  loses nothing and gains list-level visibility.
- **Filter state:** new `DashboardNav.matrixFilter: "all" | "planned" |
  "ungrilled" | "done"` (default `"all"`). Tab switch resets it alongside
  `cursor` (both reset in the same `TAB_KEYS` branch of `reduceDashboardNav`).
  `r` refresh returns `{ nav, action: "refresh" }` without touching `matrixFilter`.
- **Empty filter result:** when a stop matches zero rows (e.g. `ungrilled` once
  the queue is grilled empty), render a single dim explanatory row
  (`(no ungrilled stories — grill queue empty)`) — mirrors the existing
  `(no open backlog items)` empty-state idiom.

## Validation

- `npx tsx tests/p4.test.ts && npx tsc --noEmit` (verify_command on the row).
- New unit cases: `filterMatrixRows` per stop (all/planned/ungrilled/done) +
  empty-result; `reduceDashboardNav` `f`-cycle forward + wrap (`done`→`all`) +
  no-op on non-matrix tabs; cursor clamp when a filter shrinks the list; drill
  (`Enter`) resolves the correct story from a filtered position; tab-switch
  resets filter; `r` preserves filter.
- Manual: open `/harness` → Matrix → press `f` repeatedly → confirm cycle
  `all→planned→ungrilled→done→all` and that `ungrilled` shows exactly the
  planned stories marked `○` (the grill queue); drill one → correct story;
  switch tab and back → filter reset to `all`.

## Harness Delta

- Reshapes US-026 from "jump-to-one + grill-queue badge" to "matrix status-filter
  cycle". The grill-queue concept is **preserved** as the `ungrilled` stop — it
  is no longer a badge count but a filter view.
- Establishes the per-tab filter pattern (matrix first; backlog filter = later
  story). The `matrixFilter` field on `DashboardNav` is the seam future per-tab
  filters would generalize.
- No schema change, no new data fetch (reuses US-023's `grilledStoryIds`).

## Evidence

tsc clean (`npx tsc --noEmit`, exit 0). `tests/p4.test.ts` 103 passed / 0 failed
(+15 US-026: `filterMatrixRows` all/planned/ungrilled/done/undefined;
`reduceDashboardNav` `f`-cycle forward + wrap done→all + cursor-reset +
no-op-backlog + no-op-drilled + tab-switch-resets-filter + `r`-preserves-filter;
render active-filter label + `[f]` discovery, `planned` narrows the list,
`ungrilled` empty-state, drill-resolves-correct-story-from-filtered-position).
p5 31 (1 `deepEqual` updated for the new `matrixFilter` field on tab-switch —
behaviour was already correct). p2 46 p3 33 p6 36 — all 0 failed. Lens 0 errors.
Read-only invariant held (US-014): the filter is a client-side view transform;
no `intake`/`story`/`trace`/`backlog` writes added in the render path.
