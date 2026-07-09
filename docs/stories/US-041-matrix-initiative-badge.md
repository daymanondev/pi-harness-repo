# US-041 Matrix initiative #id badge + group-by-initiative toggle

## Status

implemented

## Lane

normal

## Product Contract

The Matrix tab lists every story but did not show **which initiative each story
belongs to** — the operator could only see that in the (now removed) drill-down
detail pane. This slice makes the slice→initiative link (`parent_intake_id`,
migration 009) visible **on the matrix itself**, two ways:

1. **Flat view**: every row carries an `init` column showing its parent
   initiative `#NN` (accent) — or `–` (dim) when the story has no initiative.
2. **Grouped view** (`g` toggle): rows collapse under initiative headers
   (`#NN <summary>`, newest first) with the stories indented beneath; stories
   with no initiative fall into a trailing `(no initiative)` bucket.

This answers *"which stories belong to which initiative?"* at a glance, with no
tab switch and no drill-down.

## Relevant Product Docs

- `docs/initiatives/0002-dashboard-focus-rework.md` — this initiative (#56)
- `docs/stories/US-033-*` — the `parent_intake_id` durable link
- `docs/stories/US-036-*` — the (removed) initiatives TAB whose grouping this
  folds into the matrix
- `extensions/harness/dashboard.ts` — pure view (badge, group render, `g` toggle)

## Acceptance Criteria

1. **flat badge**: each matrix row shows an `init` column — `#NN` (accent) for a
   story with a `parent_intake_id`, `–` (dim) otherwise. The column header is
   `init`.
2. **`g` toggle**: pressing `g` on the matrix tab (not drilled) switches to a
   grouped view; pressing `g` again returns to flat. `g` is a no-op on backlog
   and when drilled. Switching tabs resets grouping to off (mirrors `matrixFilter`).
3. **grouped layout**: initiative headers (`#NN <summary>`, newest intake first)
   with the group's stories indented beneath; a final `(no initiative)` bucket
   holds unlinked stories. Headers are non-selectable; the cursor indexes the
   flat story list (headers consume no cursor index), so drill + `[s]` dispatch
   keep working unchanged.
4. **discovery**: the matrix list shows `[g] group` (flat) / `[g] flat` (grouped)
   next to the existing `[f] cycle`.
5. **no data change**: the linkage is read-only from `data.initiatives` (already
   fetched). No new fetch, no index.ts change, no durable write.
6. **purity + tests**: `dashboard.ts` stays pure. `npx tsc --noEmit` clean.
   `p4` gains `buildIntakeByStory` + flat-badge + reducer-`g` + grouped-view
   tests; all suites pass.

## Design Notes

- **`buildIntakeByStory`**: a single `Map<storyId, intakeId>` built once per
  render from `data.initiatives`, reused by both views (badge lookup + bucketing).
- **grouped cursor model is unchanged**: the grouped view is purely presentational.
  The cursor still indexes `filteredMatrix` (the flat filtered list); the grouped
  renderer walks the buckets incrementing a flat index, marking the row whose
  flat index === cursor. Drill resolves into `filteredMatrix` exactly as in flat
  mode, so story-detail + dispatch need no change.
- **no init column in grouped rows**: the header already states the initiative,
  so the per-row `#NN` would be redundant; grouped rows drop it (flat rows keep
  it).
- **status-filter composes**: `f` and `g` are independent — filtering narrows the
  list, grouping re-buckets the (already filtered) list.

## Evidence

Implemented (intake #59 spec_slice). `dashboard.ts`: added
`DashboardNav.groupByInitiative?`; `reduceDashboardNav` `g` handler (matrix-only,
non-drilled, toggles + cursor-reset) + `groupByInitiative:false` on tab switch;
exported `buildIntakeByStory(groups): Map<string,number>`; `renderMatrixTab`
gained an `intakeByStory` param + `init` column (`#NN` accent / `–` dim, width 4)
- `[g] group` discovery; new `renderMatrixGrouped` (initiative headers newest-
first, indented stories, trailing `(no initiative)` bucket, flat-index cursor);
`renderDashboardLines` builds `intakeByStory` (+ `summaryByIntake` for grouped)
and branches on `nav.groupByInitiative`. No index.ts change (uses existing
`data.initiatives`). `tests/p4.test.ts`: +5 tests (buildIntakeByStory, flat
badge, `g` toggle, `g` no-op/reset, grouped view). Verified: `npx tsc --noEmit`
exit 0; p2 48 / p3 33 / p4 98 / p6 36 all pass. Real-data render confirmed: flat
rows show `#44/#50/#56`/`–`; grouped buckets stories under each initiative
header. Slice of initiative #56.
