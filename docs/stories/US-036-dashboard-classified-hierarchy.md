# US-036 Dashboard: Classified/Ready Badge + Initiative→Slices Hierarchy + Click-to-Run

## Status

implemented

## Lane

normal

## Product Contract

The dashboard's readiness signal is **classified** (a story has ANY intake
linked), not the old "grilled" (a `spec_slice` intake only). This realigns the
dashboard to upstream repository-harness theory, where the grill is a
clarification tool — not a per-slice intake gate — and a story is ready to
implement once it has an intake. A new **initiatives** tab shows each
`new_initiative` intake as a group header with its slice stories indented
beneath (via the new `story.parent_intake_id` link, migration 009), so the
operator can see which slice belongs to which initiative. `[s]` click-to-run
dispatch is preserved on matrix, backlog, AND initiatives.

## Relevant Product Docs

- `docs/initiatives/0001-realign-to-upstream.md` — the realign initiative (#44)
- `docs/stories/US-023-dashboard-grilled-badge-next-action.md` — the original
  grilled-badge (this slice reworks it to classified)
- `docs/decisions/0014-dashboard-dispatch-policy.md` — the `[s]` dispatch policy
- `scripts/schema/009-story-parent-intake.sql` — the slice→initiative link
- `extensions/harness/dashboard.ts` — pure view (badge, router, initiatives tab)
- `extensions/harness/index.ts` — fetch wiring (classified SQL, initiatives SQL)

## Acceptance Criteria

1. **classified-badge**: each Matrix row shows `●` if ANY intake links the story
   (`SELECT DISTINCT story_id FROM intake WHERE story_id IS NOT NULL`), `○`
   otherwise. The column header is `c` (was `g`).
2. **nextActionFor router**: `classified → implement`; `unclassified → classify`
   (prompt: "record an intake; use harness-intake-griller only if unclear").
3. **initiatives tab** (key `7`): lists `new_initiative` intakes as headers,
   each with its slices indented (badge + id + title). Drill → story detail
   (with an `initiative: #NN` line). `[s]` dispatches the selected slice.
4. **filter rename**: the matrix status-filter stop `ungrilled` → `unclassified`
   (the classify queue); empty-state "classify queue empty".
5. **story detail**: shows `classified: yes|no`, `next: classify|implement`, and
   `initiative: #NN` when the story has a `parent_intake_id`.
6. **dispatch preserved**: `[s]` on matrix/backlog/initiatives hands the row to
   the agent in-session (US-027/ADR-0014); backlog still triages.
7. **purity + tests**: dashboard.ts stays pure (no pi imports). `npx tsc
   --noEmit` clean. Existing tests updated; new initiatives cases added.

## Design Notes

- **Why any-intake, not spec_slice**: upstream has no "grilled" concept. The
  grill is now a clarification tool; the readiness signal is simply "has a
  linked intake" (classified). A `change_request` or `new_initiative` linkage
  counts — a story with any intake is ready to implement.
- **initiatives tab is a ListTab**: cursor indexes the flat slice list across all
  groups (headers are non-selectable separators). `lens.initiatives` is the
  total slice count. Drill reuses `renderStoryDetail` (looks up the full
  MatrixRow for proof columns; falls back to zero-proof). Dispatch reuses
  `dispatchPromptFor` with `kind: "matrix"`.
- **parent_intake_id lookup**: `renderStoryDetail` takes an optional
  `parentIntakeId` (computed via `findParentIntake` over `data.initiatives`),
  shown as `initiative: #NN`. No schema change to MatrixRow — the join happens
  via the initiatives fetch.
- **Commands/Queries** (component-side, via `harness-cli query sql`):
  - classified: `SELECT DISTINCT story_id FROM intake WHERE story_id IS NOT NULL`
  - initiatives intakes: `SELECT id||'|'||summary FROM intake WHERE input_type='new_initiative' ORDER BY id DESC`
  - initiatives slices: `SELECT parent_intake_id||'|'||id||'|'||title||'|'||COALESCE(status,'') FROM story WHERE parent_intake_id IS NOT NULL ORDER BY parent_intake_id, id`

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | tsc clean; p4 130 passed (was 123; +7 US-036 cases) |
| Integration | 1 — wired dispatch + tab fetch path exercised by existing p4 wiring tests |
| E2E | 0 (TUI overlay; manual) |
| Platform | 0 |
| Release | 0 |

## Harness Delta

- Reworks the US-023 "grilled" signal → "classified" (any intake). Renames the
  public `parseGrilledStoryIds`→`parseClassifiedStoryIds`, `NextAction.grilled`
  →`classified`, `next: "grill"|"implement"`→`"classify"|"implement"`,
  `DashboardData.grilledStoryIds`→`classifiedStoryIds`, filter `ungrilled`→
  `unclassified`. This is a breaking rename of the dashboard's public surface —
  downstream consumers of these symbols must update.
- Adds the `initiatives` tab + `InitiativeGroup`/`parseInitiatives`/DashboardData
  .initiatives, backed by migration 009's `parent_intake_id`.
- Superseded-in-part: the per-slice-grill semantics of US-023 (see ADR-0015).

## Evidence

- `npx tsc --noEmit` → exit 0.
- `npx tsx tests/p4.test.ts` → 130 passed / 0 failed (+7 US-036: parseInitiatives
  group/empty; initiatives tab render/empty-state; reducer `7` tab switch + `s`
  dispatch empty/non-empty). Updated existing US-023/US-026/US-027 assertions for
  the grilled→classified / ungrilled→unclassified / grill→classify rename.
- `npx tsx tests/p5.test.ts` → 31 passed / 0 failed (helper updated).
- Regressions: p2 46, p3 33, p6 36 — all 0 failed.
- Files: `extensions/harness/dashboard.ts`, `extensions/harness/index.ts`,
  `tests/p4.test.ts`, `tests/p5.test.ts`.
