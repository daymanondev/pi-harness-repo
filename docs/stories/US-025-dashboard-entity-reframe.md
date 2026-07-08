# US-025 Dashboard Entity Reframe: Story/Backlog Work Surface; Intake/Trace/Decision as Provenance (Part B)

## Status

implemented

## Lane

normal

**Slice intake:** #35 (spec_slice, normal) · **Umbrella initiative:** #29
(control-surface, backlog #5). **Siblings:** US-023 (intake #30), US-024
(intake #34).

## Product Contract

The dashboard's five entities split into two tiers by how the operator uses
them: **Tier 1 work surfaces** (`story`, `backlog`) are where the operator
*acts*; **Tier 2 provenance** (`intake`, `trace`, `decision`) is *evidence about
the work* — read for context, not acted on directly. Today every entity is
presented as a flat peer; this slice makes the tiering concrete **inside story
detail**.

Narrow scope (grilled, intake #35):

- Story detail (`renderStoryDetail`) gains a read-only **Provenance lane** showing
  the story's own **linked intake** (`intake.story_id` → id + input_type) and
  **recent traces** (`trace.story_id` → trace ids). Cross-cutting browse of all
  traces / all decisions stays on the existing `timeline` / `decisions` tabs.
- **Decisions are omitted** from the lane — the `decision` table has no
  `story_id` FK, so there is no durable per-story decision link. US-024 owns
  decision surfacing (the `decisions` tab + ADR body). The lane prints a dim
  pointer to it.
- **No durable writes** — read-only, US-014 Command-Query invariant honored.
  Data comes from two existing FKs only; no schema/migration.

Explicitly out of scope (grilled findings):

- The `docs/HARNESS.md` "## Entity Tiers" write is **dropped** — `HARNESS.md` is a
  core harness-flow file and is off-limits per the operator's constraint. The
  tier model lives only informally, in the dashboard's tab structure.
- The `stats` / `tools` / `drift` tabs are **derived views, not entities**; the
  operator's "they feel useless" complaint is real but is a separate concern
  (candidate backlog item), not this slice.
- Making the dashboard **interactive** (in-place actions, not advisory text) is a
  separate architectural fork = backlog #5 / US-028 dispatch backend + a
  not-yet-written ADR-0014 (launch-surface / execution-safety). This slice stays
  advisory.

## Acceptance Criteria

- Story detail renders a `Provenance` lane for every story: linked intake
  (`#NN input_type`, ●grilled marker) and trace ids; degrades to a dim `—` when
  none.
- Pure, total parsers for intake-by-story and traces-by-story
  (`query sql`-backed), mirroring the US-023 `parseGrilledStoryIds` pattern;
  never throw on partial/empty output, degrade to a dim row.
- Decisions slot is a dim pointer to the `decisions` tab / US-024 — never invents
  a story↔decision link, never parses decision markdown.
- Read-only honored: no `harness-cli` write command originates from the dashboard
  render path.
- `npx tsx tests/p4.test.ts` covers the lane for: (a) grilled story with
  intake+traces, (b) story with no intake (orphan), (c) intake but no traces,
  (d) empty/partial query output. `npx tsc --noEmit` clean.

## Design Notes

- **Entity vs tab** (the root of the grill): the 5 entities are
  `story, backlog, intake, trace, decision`; the 7 tabs are a *mix* — entity
  work-surface tabs (`matrix`=story, `backlog`), entity provenance tabs
  (`timeline`=trace, `decisions`=decision; `intake` appears only as the US-023
  grilled-badge), and derived-view tabs (`stats`, `tools`, `drift`). The tier
  model applies to entities; it says nothing about the derived-view tabs.
- **Timeline note:** only the *live tail* was retired (US-016 / intake #28); the
  TIMELINE tab is alive (manual `r` refresh) and stays a cross-cutting provenance
  surface.
- **Decisions tab already landed** in code (`renderDecisionsTab`, key `6`) though
  `query matrix` still shows US-024 `planned` — a markdown↔durable drift to clean
  up separately.
- Queries: `query sql "SELECT id,input_type FROM intake WHERE story_id=?"` and
  `query sql "SELECT id FROM trace WHERE story_id=? ORDER BY id DESC LIMIT N"`.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | p4 — Provenance lane render + intake/traces-by-story parsers |
| Integration | Approach-B wiring (fetch into DashboardData) |
| E2E | no |
| Platform | no |
| Release | no |

`npx tsx tests/p4.test.ts && npx tsc --noEmit`

When updating durable proof status:
`scripts/bin/harness-cli story update --id US-025 --unit 1 --integration 1 --e2e 0 --platform 0`.

## Relevant Product Docs

- `extensions/harness/dashboard.ts` — `renderStoryDetail`, `DASHBOARD_TABS`
- `docs/stories/US-023-*.md` (grilled-badge / `nextActionFor` pattern),
  `US-024-*.md` (decisions tab — sibling)
- `docs/FEATURE_INTAKE.md` (input types / lanes — reference only; not edited)

## Harness Delta

- Proposed (deferred): a `docs/HARNESS.md` "## Entity Tiers" section was part of
  the original US-025 premise but is **dropped** (core-flow off-limits). If the
  operator later lifts the constraint, this is the natural place to formalize the
  tier model; until then it lives informally in the dashboard structure.
- Surfaced: the **interactive-dashboard fork** (backlog #5 / US-028 + ADR-0014)
  is the real answer to "I want to act on the dashboard, not just read it." Out
  of scope here; flagged for a separate grilling.
- **Upstream-coupling risk (acknowledged, deferred):** `fetchProvenance` is
  inlined in `extensions/harness/index.ts` — an upstream/author file (same as
  the 9 existing fetches). If a harness update ships a new `index.ts` that
  overwrites it, re-apply `fetchProvenance` + its `Promise.all` entry + return
  field; the **p4 US-025 tests will fail-loud (red)** if clobbered, so breakage
  is caught on the next test run, not silently. Long-term fix = extract the
  fetch layer into a dedicated `queries.ts` (separate refactor story) so our
  code stops living in the author's file.

## Evidence

- Intake #35 (spec_slice, normal) — classification + grill findings.
- Slice of initiative #29 (intake #29); siblings US-023 (intake #30), US-024
  (intake #34).
- Implemented (narrow scope): read-only Provenance lane in `renderStoryDetail`
  — intake (`#id input_type` via `intake.story_id`) + traces (ids via
  `trace.story_id`, cap 5 + `(+N more)`); decisions omitted (dim pointer to the
  decisions tab / US-024 — no `decision.story_id` FK). Pure
  `parseIntakesByStory` / `parseTracesByStory` / `buildProvenance` in
  `dashboard.ts`; `fetchProvenance` (2 SELECTs) wired into `index.ts`
  `Promise.all`. HARNESS.md entity-tiers write dropped (core-flow off-limits).
- Verification: `npx tsc --noEmit` exit 0; `npx tsx tests/p4.test.ts` 88 passed
  (+8 US-025: 2 intake-parser + 1 trace-parser + 1 build + 4 render incl. traces
  cap); regression p2 46 / p3 33 / p5 31 / p6 36 — 0 fail. p2 = gates
  byte-identical (the `index.ts` change is additive fetch only).
