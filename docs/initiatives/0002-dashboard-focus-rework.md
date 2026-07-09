# Initiative 0002 — Dashboard focus rework (declutter + initiative-aware matrix + cmux doc-open)

- **Intake:** #56 (`new_initiative`, normal lane)
- **Status:** in progress
- **Date:** 2026-07-09

## Goal

The `/harness` dashboard accumulated eight tabs (matrix, stats, backlog,
tools, drift, timeline, decisions, initiatives). In daily dogfooding only
**Matrix** and **Backlog** carry signal; the rest are noise. This initiative
reshapes the dashboard around those two surfaces, makes the Matrix answer
*"which story belongs to which initiative?"* at a glance, and adds a cmux-native
way to read a story/initiative doc in a side surface without leaving the flow.

## Tracer-bullet

Open `/harness` → see only **Matrix + Backlog**; each matrix row carries its
initiative `#id` badge (derived from `parent_intake_id`); press `o` on a row →
the story packet opens in a cmux side surface.

## Milestones (not tasks)

1. **Declutter** — Matrix + Backlog become the only top-level tabs; the other
   six tabs and their tab-only fetches are removed. Detection, gates, and the
   next-action footer are untouched (they do not depend on the removed tabs).
2. **Initiative-aware matrix** — every matrix row shows its initiative `#id`;
   a group-by-initiative toggle (`g`) collapses rows under initiative headers.
3. **cmux doc-open** — `o` opens the focused story/initiative doc in a cmux
   side surface. Pure component signals; the handler execs (Command-Query
   preserved). A narrow, benign un-defer of US-028 (doc-open only — not the
   deferred provider-build spawn).

## Scope

**In:**

- Remove tabs: stats, tools, drift, timeline, decisions, initiatives (+ their
  render functions, `TAB_KEYS` entries, nav branches, and tab-only data fetches).
- Keep data the surviving surfaces need: `initiatives` (matrix badge + detail),
  `packets` (status/lane), `provenance` (detail lane), `classifiedStoryIds`.
- Matrix initiative `#id` badge + `g` group-by toggle.
- `o` → cmux side-surface doc-open (story packet; initiative doc when grouped).

**Out (named, so it cannot creep back):**

- Re-adding removed tabs (recoverable via git + this ADR's rationale).
- Non-cmux fallbacks (tmux/zellij/`ctx.newSession`) — we use cmux.
- US-028 full dispatch backend (provider build, parallel pane spawn).

## Open questions

- Gate A vs fresh-context subagents (backlog #17, still *proposed*): this
  initiative is implemented by the main agent as sole writer (one-writer rule);
  subagents do read-only analysis/review. If #17 lands, later slices could move
  to fork-context workers.

## Risk surface

- **Existing behaviour** — removing tabs breaks the p4/p5 tests that assert
  them. Intended; the tests are updated to match the new two-tab world.
- **External systems** — cmux spawn is local and benign (open a markdown doc),
  narrower than US-028's deferred external-provider build. Lane normal.

## Candidate stories

| Story | Slice | Lane |
| --- | --- | --- |
| US-040 | Dashboard declutter — keep only Matrix + Backlog tabs | normal |
| US-041 | Matrix initiative `#id` badge + group-by toggle | normal |
| US-042 | `o` opens focused doc in a cmux side surface | normal |

All three slices link to intake #56 via `story.parent_intake_id`.

## Validation shape

- `tsc` clean across `extensions/**/*.ts` + `tests/**/*.ts`.
- All test suites pass (p2–p6) after the tab removal + new features.
- `harness-cli audit` clean; drift gate B′ clean (no new drift).
- Dashboard renders: Matrix + Backlog only; matrix rows show initiative `#id`;
  `g` groups; `o` opens the doc in a cmux side surface.

## Exit criteria

- US-040..US-042 implemented + committed.
- Dashboard verified rendering with the two surfaces + initiative awareness +
  cmux doc-open.
- No regression to detection, gates, or the next-action footer.
