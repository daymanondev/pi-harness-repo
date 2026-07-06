# US-015 P5 — TIMELINE tab render (tracer-bullet)

## Status

implemented

## Lane

normal

## Product Contract

When the observer is installed (`detect().observerInstalled`), pressing `t` in
the DASHBOARD shows the last ~50 `harness-cli` calls as **flow rows** — `cmd`,
`exit`-colored, `duration_ms` — with the `db_before → db_after` diff
(`intake: 2 → 3`) as the lead column, parsed from
`.harness-observer/events.jsonl`. `Enter` opens a detail pane of full
`stdout`/`stderr`. Degrades to a dim message when the observer or file is
absent or a line is unparseable — never throws out of the overlay.

Replaces the placeholder at `extensions/harness/dashboard.ts` (the
`(timeline tab ships in P5)` line).

Umbrella intake: **#20** (P5 timeline). Roadmap: `docs/initiatives/P5-timeline.md` (M1).
Slice intake: #21. **blocked-by:** none (reuses the P4 dashboard shell + tab routing).

## Relevant Product Docs

- `pi-harness-design/DESIGN.md` §8.2 (Timeline view), §11 (P5)
- `docs/initiatives/P5-timeline.md` — M1 + open questions OQ-1/OQ-3
- `extensions/harness/dashboard.ts` — `DashboardTab`, `DASHBOARD_TABS`,
  `reduceDashboardNav`, `DashboardData` (the seams to extend)
- `.harness-observer/events.jsonl` — the real schema (verified)

## Acceptance Criteria

- A pure `parseEventsJsonl(text) → TimelineEvent[]` parses the real
  `.harness-observer/events.jsonl` (9-key lines: `ts, cmd[], exit, duration_ms,
  cwd, stdout, stderr, db_before, db_after`) and is robust to truncated/garbage
  lines (skips them, never throws).
- A pure diff renderer turns `db_before`/`db_after` into the
  `table: before → after` headline; rows where both are `{}` (reads, `--version`)
  omit the diff column (OQ-3 resolved).
- `t` renders the last **N=50** (OQ-1 resolved) events, exit-colored (`success`
  /`error`), with a selection cursor + `Enter` drill-down to a detail pane.
- Observer/file absent → a dim in-tab message; never throws.
- Wiring in `index.ts` reads `events.jsonl` (best-effort) into
  `DashboardData.timeline`; the existing `t` key already routes (no new key
  model).

## Design Notes

- **Real schema (verified against 2062 logged events):** every line carries
  `ts, cmd (string[]), exit (int), duration_ms (int), cwd, stdout, stderr,
  db_before (obj), db_after (obj)`. `db_*` are `{intake, story, decision,
  backlog, trace, intervention}` count maps — the diff is directly derivable.
- **Reuse, don't fork.** Extended `DashboardData` with `timeline:
  TimelineEvent[]`; added `renderTimelineTab` (+ detail) beside the existing tab
  renderers; `timeline` was already in `DASHBOARD_TABS` (key `t`).
- **Timeline IS a list tab** (resolved): added `"timeline"` to `ListTab` /
  `LIST_TABS` / the reducer `lens` / `DrillTarget.kind`, so the US-014
  master-detail cursor + `Enter` drill apply for free — no local cursor needed.
- **N=50 cap lives in `fetchTimeline`** (`parseEventsJsonl(text).slice(-TIMELINE_MAX)`),
  so `data.timeline` is already capped and the lens count matches the rendered
  rows. `TIMELINE_MAX = 50` is exported for tests.
- **`toCounts` drops non-number entries** (`typeof === "number"`), so a `null`
  count does not materialize as `0`.
- **OQ-2 (install.sh pinning) belongs to US-017**, not this slice.
- **OQ-4 (async re-render) belongs to US-016** — this slice is static +
  manual `r` refresh only.

## Validation

**unit** (pure, `tests/p5.test.ts`): `parseEventsJsonl` (well-formed / skips
blank+unparseable+non-object / missing-field degradation / non-numeric drop),
`timelineDiff` (changed-only / empty-for-reads / no-op / multi-table),
`reduceDashboardNav` timeline cursor+drill+Esc, `renderTimelineTab` (rows,
exit ✓/✗, delta for mutations, none for reads, cursor marker, empty-state +
error degrade), drill-down detail (stdout/stderr/no-state-change), and box-width
alignment at 76 + the 60-col floor. **integration** (Approach B, real
`index.ts`): fixture repo with `.harness-observer/events.jsonl` → `/harness` →
`t` renders rows + deltas; `t j Enter` drills to stdout; missing file degrades.
No e2e/platform (matches US-010/011/012).

| Layer | Expected proof |
| --- | --- |
| Unit | parser + diff + tab/detail renderers + box-width (p5 26/26) |
| Integration | Approach B wiring against a fixture events.jsonl (3 wired tests) |
| E2E | |
| Platform | |
| Release | |

## Harness Delta

None. (Roadmap-level open questions OQ-1/OQ-3 resolved here; OQ-2 → US-017,
OQ-4 → US-016.)

## Evidence

- `npx tsc --noEmit` → exit 0 (clean).
- `npx tsx tests/p5.test.ts` → **26 passed, 0 failed**.
- Regression: `tests/p2.test.ts` 44/44, `tests/p3.test.ts` 33/33,
  `tests/p4.test.ts` 58/58 (p4 updated: footer hint `[1-5,t]`, `timeline` now a
  populated tab not a placeholder, `LENS` + `dashData` carry the timeline field).
- `lens_diagnostics` (mode=all): 0 errors; only non-blocking style warnings
  consistent with the repo baseline (same classes as `p4.test.ts`).
- Rendered against the real `.harness-observer/events.jsonl` schema (2062 logged
  events): the `db_before → db_after` delta is directly derivable; reads /
  `--version` correctly omit the delta column.
