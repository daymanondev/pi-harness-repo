# US-044 Hide Start on implemented stories + status-aware next line

## Status

implemented

## Lane

normal

## Product Contract

A story already `implemented` still shows a `Start — implement <id>` menu item
and a `next: implement` advisory line. That is nonsensical — the work is done.
The detail action menu must be **status-aware**: an implemented story has no
Start item (only its doc options remain), and its `next:` line reads `done`
instead of `implement`.

`nextActionFor` (the shared routing router used by the agent task-loop) is left
unchanged — its classified-ness signal stays status-independent. Only the
**detail-view affordances** (menu builder + detail renderer) become
status-aware.

## Relevant Product Docs

- `docs/stories/US-043-dashboard-action-menu.md` — introduced the action menu this refines
- `extensions/harness/dashboard.ts` — `buildStoryMenu`, `renderStoryDetail`

## Acceptance Criteria

1. `buildStoryMenu` omits the dispatch `Start` item when `row.status === "implemented"`; non-implemented rows are unchanged (Start still first).
2. `renderStoryDetail` shows `next: done` (success color) for implemented rows and drops the `→ <prompt>` advisory line for them; non-implemented rows keep `next: implement|classify` + the prompt.
3. When the implemented story's menu is empty (no packet + no related docs), no empty `Actions:` block is rendered.
4. The matrix list classified-badge (●/○) and the `classified:` detail line are unchanged (intake-linkage is still meaningful for implemented stories).
5. `dashboard.ts` stays pure; read-only invariant preserved.
6. Green: `npx tsc --noEmit` exit 0; `p2`/`p3`/`p4`/`p6` pass.

## Design Notes

- `buildStoryMenu`: wrap the dispatch `items.push(...)` in `if (row.status !== "implemented")`.
- `renderStoryDetail`: `const implemented = row.status === "implemented";` → `next:` shows `done`; guard the `→ prompt` line with `if (!implemented)`; render the Actions block only when `menu.length > 0`.
- No change to `nextActionFor`, `dispatchPromptFor`, the reducer, or wiring.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | buildStoryMenu (implemented→no Start) + renderStoryDetail (next:done) unit tests (p4) |
| Integration | n/a (no wiring change) |
| E2E | deferred |
| Platform | n/a |

## Harness Delta

None. intake #64 (change_request, normal). No decision record (normal lane,
no architecture/contract/auth/data change — a UI affordance refinement).

## Evidence

- `npx tsc --noEmit` → exit 0.
- `npx tsx tests/p4.test.ts` → 103 passed, 0 failed (added: buildStoryMenu
  implemented→no Start; renderStoryDetail next:done + no empty Actions).
- `npx tsx tests/p2.test.ts` → 48/48; `p3` → 33/33; `p6` → 36/36.
- The US-043 wiring test "matrix drill+select → classify" was retargeted from
  US-001 (implemented, no longer dispatches) to US-010 (planned) — confirming
  dispatch now correctly skips implemented rows and lands on a to-do row.
