# US-014 Dashboard Drill-Down Navigator (Master-Detail on List Tabs)

## Status

implemented

## Lane

normal

## Product Contract

The dashboard is a control surface, not a status board. Today its five tabs
only re-display one query each as a flat list — an operator can see a story id
but cannot open it, see its linked intake/traces, or read a backlog item's full
text. This story makes the dashboard explorable:

- On every **list tab** (Matrix, Backlog, Drift) the operator can move a
  selection cursor over rows and press Enter to open a **detail pane** for that
  entity, and Esc to return to the list.
- The detail pane shows the entity's full record **plus its linked durable
  entities** (a story shows its intake + traces; a drift row shows its fix
  hint), turning the dashboard from a gauge into a navigator.
- The dashboard stays **read-only**: no durable writes originate from it
(Command/Query boundary, ARCHITECTURE.md). "Actions" are advisory text (a
suggested command / a file path the operator reads and runs themselves through
the gates), never direct mutations.

Research basis: blakecrosley *"Agentic Design Is Control Surface Design"*;
Armalo AI *"Mission Control UX for Agentic OS Operators"*; TUI master-detail
patterns (AWS-tui stack drill-down, LFK read-only mode, Linear/Sentry
detail panes); Laminar/Antão Almada on evidence-based auditing + diagnostic
navigation of linked traces.

## Relevant Product Docs

- `pi-harness-design/DESIGN.md` — P4 (observability/dashboard) section: read-only contract.
- `docs/ARCHITECTURE.md` — Command/Query Boundary (dashboard = query surface).
- Code: `extensions/harness/dashboard.ts` (renderers), `extensions/harness/index.ts` (`HarnessOverlayComponent` key handling + `fetchDashboardData`).
- Gap (not blocking): no `docs/product/dashboard.md` exists yet; a follow-up may extract the dashboard contract into a product doc.

## Acceptance Criteria

1. **Cursor navigation**: on Matrix/Backlog/Drift tabs, `↑`/`↓` (and `j`/`k`) move a selection cursor; cursor clamps to `[0, listLength-1]`; empty list shows a dim "no rows" hint and disables drill.
2. **Drill-in / back**: `Enter` on a selected row opens the entity's detail pane; `Esc` returns to the list. `Esc` on the list still closes the overlay (existing behavior preserved).
3. **Regression — existing keys**: tab-switch `1`-`5`, `r` (refresh), and the install-view keys keep working unchanged.
4. **Story detail pane** (Matrix tab): renders the story's **packet markdown** — `id`, title, status, lane, and excerpts of Acceptance Criteria + Evidence — parsed from `docs/stories/US-NNN-*.md` (reuses `parseMarkdownStatus`). Shows the packet path. If no packet file exists, shows a dim "(no packet — orphan durable)". (Linked intake/trace ids deferred — see CLI limitation note.)
5. **Backlog detail pane** (Backlog tab): shows id, title, status, risk, predicted_impact, actual_outcome (full, unwrapped).
6. **Drift detail pane** (Drift tab): shows story id, kind, both sides of the mismatch (durable vs markdown), and the **fix hint** via the existing `fixHintFor()` (shared with Gate B′).
7. **Purity + testability**: detail renderers are pure functions in `dashboard.ts` (no pi runtime, `fg`-injected theming) and are covered by unit tests like the existing tab renderers.
8. **Nav reducer test**: cursor move / clamp, drill-in / back, tab-switch reset, and empty-list disable-drill are covered by direct unit tests of the pure `reduceDashboardNav` brain (no component instantiation needed).
9. **Data**: `DashboardData` gains `packets: Record<string, { filename: string; text: string }>`, populated eagerly at overlay open by reading `docs/stories/US-NNN-*.md` (small files; <50ms for ~13 packets). Story detail renders from this map; no extra queries. Defaults to `{}`.

## Design Notes

- **Component state**: add `private selectedRow = 0` and `private drilled: { kind: "matrix"|"backlog"|"drift"; index: number } | null = null` to `HarnessOverlayComponent` (`index.ts`). Reset `selectedRow` to 0 on tab change.
- **handleInput** delegates to a pure `reduceDashboardNav(nav, key, lens)` brain in `dashboard.ts` (testable without instantiating the component): arrows/`j`/`k` → move cursor (clamp to list length); `Enter` → set `drilled` from current `tab`+`cursor`; `Esc` → if drilled, clear (back to list), else `onDone({action:"close"})` (unchanged). Tab switch resets `cursor=0` + `drilled=null`.
- **Render**: `renderDashboardLines` takes the nav state (`{tab, cursor, drill}`); when `drill` is set, dispatch to `renderStoryDetail` / `renderBacklogDetail` / `renderDriftDetail`; else render the list with the selected row highlighted (`▸` marker).
- **Detail renderers** (pure, `dashboard.ts`): `renderStoryDetail(row, packet, fg, width)`, `renderBacklogDetail(row, fg, width)`, `renderDriftDetail(row, fg, width)`. Reuse `gapSpaces`/box helpers; ANSI-aware width already handled.
- **Story detail sources from the packet file**: `fetchPackets(cwd)` reads `docs/stories/US-NNN-*.md` → `Record<storyId, {filename, text}>` at overlay open. The renderer extracts `## Status` (reuses `parseMarkdownStatus` from drift.ts), `## Lane`, and the first lines of `## Acceptance Criteria` / `## Evidence` via a section extractor. No fs reads inside the pure renderer.
- **CLI limitation (drives the packet-based design)**: `query traces` and `query intakes` do NOT expose `intake.story` / `trace.intake` columns, and have no `--json`. So story→intake→trace linking is not derivable from query output. Linked-entities navigation is deferred to a later slice (add columns/`--json` upstream, or parse packet link refs).
- **No clipboard**: pi SDK has no clipboard API. `[o]`/`[c]` are **not** Phase 1; the detail pane prints the packet path / a suggested `harness-cli` command as advisory text the operator reads. (A later slice may add a `result.action: "notify-cmd"` bridge if a copy/notify path is added.)
- **Read-only preserved**: no `harness-cli intake|trace|story|backlog` calls originate from the dashboard. Command/Query boundary intact.
- **Performance**: eager fetch adds 2 cheap queries (`query traces`, `query intakes`) at overlay open; acceptable at current scale. If counts grow, switch story-detail links to lazy fetch-on-drill (deferred).

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-014 --unit 1 --integration 1 --e2e 0 --platform 0`.

| Layer | Expected proof |
| --- | --- |
| Unit | detail renderers (story/backlog/drift) return expected lines for fixture rows; cursor clamp + empty-list behaviour. |
| Integration | `fetchDashboardData` populates `packets`; story detail renders status/lane/AC/Evidence from the packet text. |
| E2E | (deferred) real overlay key flow — not feasible without an interactive TUI harness. |
| Platform | n/a (TUI extension, no platform targets). |
| Release | n/a. |

verify_command: `npx tsx tests/p4.test.ts && npx tsc --noEmit`

## Harness Delta

- Realizes **backlog #5** ("Dashboard is view-only: no way to act on what it shows") — partial: navigation/drill-down delivered; direct write-actions deliberately out of scope (read-only constraint). #5 stays open until a later slice decides whether advisory/clipboard actions close it.
- Reuses `fixHintFor()` from `drift.ts` (single source of truth for drift fix hints, shared with Gate B′).
- No new decision record required: read-only constraint is unchanged (local, reversible UI choice). If a later slice proposes dashboard-originated writes, that crosses the Command/Query boundary and WILL require a decision record.
- **Follow-up (deferred)**: linked-entities navigation (story↔intake↔trace graph) blocked by `query traces`/`query intakes` not exposing link columns; consider a CLI enhancement (`--json` + story/intake columns) or packet-link parsing in a later slice.

## Evidence

- verify_command `npx tsx tests/p4.test.ts && npx tsc --noEmit` → 57 passed, 0 failed; tsc clean.
- New unit tests (+11): `reduceDashboardNav` (cursor clamp up/down, Enter drills / Esc pops vs closes, tab-switch resets cursor+drill, empty-list disables drill+move, non-list tab no-op, drilled ignores cursor keys) + detail renderers (story with packet → id/status/lane/path/AC+Evidence; story orphan → "no packet file"; backlog → full fields + detail tail; drift → mismatch sides + fixHint).
- Story detail sources from the packet markdown via `parseMarkdownStatus` + `extractSection`; backlog detail surfaces the predicted/actual tail; drift detail reuses `fixHintFor` (shared with Gate B′).
- Box-width invariants hold (every line = 76 / 60 cols) with the new 2-char selection-marker column (`▸` / `  `).
- Wiring tests unchanged & green: tab switch (1-5), refresh loop (`r`), Esc close, failing-query degradation.
- Linked intake/trace drill-down deferred: `query traces`/`query intakes` expose no story/intake columns and have no `--json` (see Harness Delta follow-up).
