# US-023 Dashboard Grilled-Badge + Next-Action Routing (Tracer-Bullet, Backlog #5)

## Status

implemented

## Lane

normal

## Product Contract

The dashboard answers the two questions an operator has the moment they pick a
story: *is this story grilled?* and *what do I run next?* Today the Matrix tab
lists stories with status + proof flags but gives no grill/readiness signal and
no routing hint (backlog #5: "view-only, no way to act"). This tracer-bullet
adds the thinnest end-to-end control-surface affordance:

- On the **Matrix tab**, each story row carries a **grilled-badge**: `●` if a
  `spec_slice` intake is linked to the story (`intake.story = US-NNN`), `○` if
  not (planned-but-ungrilled).
- Drilling a story (`Enter`) opens the story detail pane, which now shows a
  `grilled:` line and a `next:` line computed by a pure `nextActionFor(story)`:
  - ungrilled (`○`) → `next: grill` — advisory text naming the skill + story
    (`run harness-intake-griller for US-NNN`).
  - grilled (`●`) → `next: implement` — advisory text handing off to a worker,
    citing the packet path + acceptance criteria.
- The dashboard stays **read-only / advisory** (US-014 Command-Query
  invariant): it prints the recommended action; the operator runs it in their
  own pane/session. No durable writes originate from the dashboard. Pane spawn
  is operator-driven, so **no ADR-0014 launch-surface change** is introduced.

Tracer-bullet scope: badge + next-action line + the shared pure router.
Dispatch polish (mux pane spawn), ADR reader, entity reframe, `/harness next`,
backlog triage are later slices (US-024..028).

## Relevant Product Docs

- `pi-harness-design/DESIGN.md` §1 (single state-aware `/harness`), §7
  (DASHBOARD), §11 (phases)
- `extensions/harness/dashboard.ts` — `DASHBOARD_TABS`, the US-014 pure
  key→nav reducer, drill-down detail panes
- `extensions/harness/index.ts` — the multi-query `Promise.all` data fetch
  (add an intakes fetch here)
- `docs/stories/US-014-*.md` — drill-down navigator contract + its read-only
  invariant (this slice extends detail *content*, does not relax the invariant)
- `skills/harness-intake-griller/SKILL.md` — defines "grilled" as the act of
  recording the `spec_slice` intake (+ packet); basis for the intake-linkage
  signal
- `docs/FEATURE_INTAKE.md` — input types/lanes (this slice = spec_slice, normal)
- Backlog #5 + umbrella intake #29 (control-surface initiative)

## Acceptance Criteria

1. **Grilled-badge on Matrix rows**: each story row renders a leading badge
   (`●` grilled / `○` ungrilled) derived from **intake linkage** — a story is
   grilled iff a `spec_slice` intake row links it (`intake.story = US-NNN`).
   The dashboard fetches intakes (alongside the existing matrix/stats/backlog/
   tools/drift queries) and joins in memory. Badge respects fg-injected theming.
2. **Shared pure router**: a pure
   `nextActionFor(story, grilledStoryIds): { grilled: boolean; next: "grill" | "implement"; prompt: string }`
   in `dashboard.ts` (no pi runtime) is the single source of truth for the
   signal + next action + advisory prompt. Both the badge renderer and the
   detail pane consume it.
3. **Detail pane next-action**: the story detail pane (US-014 drill) shows
   `grilled: yes|no` and `next: grill|implement` plus the advisory prompt text
   (skill/packet path). No change to cursor/drill/Esc mechanics.
4. **Read-only preserved**: no new durable writes from the dashboard; the
   action is advisory text only (Command-Query boundary, US-014). Verify by
   inspection: no `intake`/`story`/`trace`/`backlog` write calls added in the
   render path.
5. **Regressions**: tab-switch `1`-`5`/`t`, `r` refresh, `↑/↓`/`j`/`k` cursor,
   `Enter` drill, `Esc` back/close all unchanged.
6. **Purity + tests**: `nextActionFor` and the badge derivation are pure and
   covered by unit tests in `tests/p4.test.ts` (grilled/ungrilled cases +
   prompt text). `npx tsc --noEmit` clean.

## Design Notes

- **Why intake-linkage, NOT packet-existence (v1 signal pivot):** the original
  plan used "packet file exists" as the grilled signal. The drift gate (B′,
  US-003) requires *every* durable story to have a matching packet markdown
  (else `orphan_durable` drift) — so packet-existence is true for ALL stories
  and cannot discriminate grilled. The act of grilling **is** recording the
  `spec_slice` intake (the griller records intake + packet together); so
  **grilled = a `spec_slice` intake links the story**. This is durable,
  gate-independent, and more precise. Demonstration: US-023 has intake #30 →
  `●`; US-024..028 have packets (planned stubs) but no intake → `○` (the grill
  queue). Cost: one intakes-query per render, joined in memory (the dashboard
  already runs a 5-way `Promise.all`; this makes it 6-way).
- **Read-only vs backlog #5:** US-014 explicitly made the dashboard read-only
  with advisory-only actions. Backlog #5 ("act on what it shows") is satisfied
  here **without** relaxing that invariant: the dashboard *routes* (tells you
  grill vs implement + the exact prompt) but the operator opens the pane and
  runs it. This dodges ADR-0014 (launch-surface). If dashboard-driven pane
  spawn is later wanted, US-028 + ADR-0014 handle it.
- **Routing shared with the task loop:** `nextActionFor` is the single branch
  point. When an operator instead says "do US-NNN" in a session (no dashboard),
  the agent consults the same signal (intake linked?) and routes identically —
  consistent behavior across both entry points. (Wiring that agent-side check
  is part of the task loop, not this slice's UI.)
- **Intake parse:** `query intakes` text is already parsed elsewhere; reuse the
  parser. Match on the intake `story` column = the story id. Only `spec_slice`
  counts (a `new_initiative` umbrella linking nothing, or a `change_request`,
  does not mark a story grilled).

## Validation

- `npx tsx tests/p4.test.ts && npx tsc --noEmit` (verify_command on the row).
- New unit cases: `nextActionFor` grilled/ungrilled returns correct branch +
  prompt; badge render for a row with/without a linked intake.
- Manual: open `/harness` → Matrix → confirm `●` on US-023 (intake #30) and `○`
  on US-024..028 (no intake — they ARE the grill queue); drill one → confirm
  the `next:` line.

## Harness Delta

- Adds grilled-status as a first-class, *derived* dashboard signal (no schema
  change) — the concept the whole control-surface initiative (intake #29) turns
  on. Signal = intake linkage (gate-compatible), not packet-existence.
- Establishes the advisory-routing pattern that US-024..027 reuse; US-028
  (spawn) is the only slice that would require relaxing read-only (deferred).

## Evidence

tsc clean (`npx tsc --noEmit`, exit 0). `tests/p4.test.ts` 66 passed / 0 failed
(+8 US-023 cases: `parseGrilledStoryIds` header-ignore + garbage; `nextActionFor`
grilled→implement + ungrilled→grill prompts; matrix badge ●/○ + `g` header label;
detail pane grilled/next lines for both branches). Box-width alignment asserted
at 76 + 60 cols still exact. Regression: p2 46, p3 33, p5 31, p6 36 — all 0
failed. Lens diagnostics 0 errors. Read-only invariant verified by inspection
(no `intake add`/`story`/`trace`/`backlog` writes in the render path — the new
fetch is a read-only `query sql SELECT … story_id … WHERE input_type=
'spec_slice'`).
