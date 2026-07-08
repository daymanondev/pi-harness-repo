# US-027 Dashboard Dispatch Key (Backlog + Matrix) — in-session sendUserMessage

## Status

implemented

## Lane

normal

## Product Contract

A single `s` key on the dashboard's dispatchable list tabs (Matrix + Backlog)
hands the selected item to the **current agent session** by closing the overlay
and calling `pi.sendUserMessage(prompt)`. The prompt mirrors the operator's
manual idiom ("please check @AGENTS.md, follow the harness flow and …") so the
resulting turn is indistinguishable from one the operator typed.

- **Backlog row** → a triage prompt: the agent reviews + verifies the item,
  then decides close / promote-to-story / reframe **with the operator**. The
  decision is a discussion, not a keystroke — the dashboard never mutates
  durable state.
- **Matrix/story row** → reuses `nextActionFor` (US-023): ungrilled → grill
  (run `harness-intake-griller`); grilled → implement (against the packet).

The US-023 advisory text in the detail pane (`next: grill|implement` + the
`→ prompt` line) is **unchanged** — it stays as the *label* ("what will
happen"); `s` is the *action* layer on top ("do it now"). The original c/p/e
advisory-keys design was dropped: under the operator's workflow, closing
always goes through the agent anyway, so command skeletons were redundant.

In-session only — **no pane spawn**. Pane-spawn dispatch stays deferred to
US-028 + ADR-0014's launch-surface clause. See ADR-0014.

Umbrella intake: **#29** (control-surface). Slice intake: **#39** (this reframe).

## Acceptance Criteria

- `s` on the Matrix tab (non-empty) dispatches the selected story: prompt =
  `grill US-NNN` (ungrilled) or `implement US-NNN against docs/stories/US-NNN-*.md`
  (grilled), via `nextActionFor`.
- `s` on the Backlog tab (non-empty) dispatches the selected item: prompt =
  `start with backlog #N … triage … close / promote / reframe`.
- `s` is a no-op on non-dispatchable tabs (stats/tools/drift/timeline/decisions)
  and on an empty list.
- `s` works in both list and drilled states (the cursor holds the row either
  way); the drilled detail panes show a `[s] start` hint.
- On dispatch, the overlay closes and exactly one `pi.sendUserMessage(prompt)`
  fires; no `harness-cli` mutation runs from the dashboard (read-only invariant
  held — ADR-0014).
- Every dispatch prompt leads with `please check @AGENTS.md, follow the harness
  flow and …`.
- Footer legend shows `[s] start` on Matrix/Backlog (list + drilled); other
  tabs unaffected.

## Validation

- `npx tsx tests/p4.test.ts && npx tsc --noEmit` (verify_command).
- +14 p4 tests: `dispatchPromptFor` (backlog/matrix-grill/matrix-implement/idiom
  - backlog-detail `[s]` hint), reducer `s` signal (matrix/backlog dispatch,
  empty no-op, stats no-op, drilled dispatch, nav-preserved), wiring (`s` on
  backlog → `sendUserMessage` triage prompt; `s` on matrix → grill prompt; Esc
  → no message).
- Regression: p2 46 / p3 33 / p4 123 / p5 31 / p6 36 — 0 fail; tsc clean.

| Layer | Expected proof | Status |
| --- | --- | --- |
| Unit | `dispatchPromptFor` + reducer `s` signal (pure) | yes |
| Integration | Approach B: `s` → overlay result → `pi.sendUserMessage` | yes |
| E2E | | |
| Platform | | |
| Release | | |

## Relevant Product Docs

- `extensions/harness/dashboard.ts` — `dispatchPromptFor`, `DispatchTarget`,
  `reduceDashboardNav` (`s` branch), `DashboardNavResult.action`, footer
  legend, `renderBacklogDetail` / `renderStoryDetail` `[s]` hints.
- `extensions/harness/index.ts` — `HarnessOverlayResult` `dispatch` variant,
  `HarnessOverlayComponent.dispatchTarget()` + handleInput mapping, command
  handler `pi.sendUserMessage`.
- `docs/decisions/0014-dashboard-dispatch-policy.md` — first-dispatch policy.
- `docs/stories/US-023-*.md` (advisory pattern this extends), `US-028-*.md`
  (pane-spawn, still deferred).

## Harness Delta

- **ADR-0014** — narrows US-023's advisory-only rule to permit in-session
  `sendUserMessage` from the dashboard; pane-spawn still deferred (US-028).
  First real dispatch slice; records why the dashboard can hand off to the
  agent without crossing the launch-surface line.
- Closes backlog #5 ("Dashboard is view-only") for real — the dashboard is now
  a control surface (one-key act on what it shows).

## Evidence

- tsc: `npx tsc --noEmit` exit 0 (extensions + tests).
- p4: 123 passed, 0 failed (+14 US-027 cases: dispatchPromptFor ×5, reducer `s`
  ×6, wiring ×3).
- Regression: p2 46 / p3 33 / p5 31 / p6 36 — 0 fail.
- Read-only held: the dispatch path issues `pi.sendUserMessage` only; no
  `harness-cli` mutating command runs from the overlay (verified by code read
  of `handleHarnessCommand` + the wiring `Esc → no message` test).
