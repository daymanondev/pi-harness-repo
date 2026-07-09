# US-043 Dashboard action menu — declutter list, navigable menu in detail

## Status

implemented

## Lane

normal

## Product Contract

The `/harness` dashboard list view carries too many action hotkeys (`s` start,
`o` open doc) alongside its view toggles. This slice declutters the list so it
only does navigation + view toggles, and moves the **actionable** commands
(start, open doc) into the **detail view** as a navigable menu: the operator
presses ↑/↓ to move a selection marker and Enter to run the selected action —
not one-key shortcuts. The menu also gains **related-doc** options (decisions,
initiative notes, product docs referenced by the packet), not only the story's
own packet.

`detect.ts`, `gates.ts`, `drift.ts`, the footer, and the matrix `f`/`g` view
toggles are unchanged.

## Relevant Product Docs

- `docs/stories/US-040-dashboard-declutter.md` — prior declutter (Matrix+Backlog only)
- `docs/stories/US-042-open-doc-cmux-surface.md` — the `o` open-doc this reworks
- `docs/stories/US-027-dashboard-backlog-triage-keys.md` — the `s` dispatch this reworks
- `docs/initiatives/0002-dashboard-focus-rework.md` — the dashboard focus initiative
- `extensions/harness/dashboard.ts` — pure reducer + render
- `extensions/harness/index.ts` — overlay component + wiring

## Acceptance Criteria

1. **no list-view action hotkeys**: pressing `s` or `o` on a non-drilled list
   (matrix or backlog) is a no-op; only navigation (`↑↓`/`j`/`k`), drill
   (`Enter`), view toggles (`f` matrix filter, `g` matrix group), `r` refresh,
   `1`/`2` tabs, and `Esc` close act on the list.
2. **detail action menu**: when a row is drilled open, the detail pane renders an
   `Actions:` block listing selectable items, with a `▸` marker on the active
   item (index = `nav.menuCursor`, default 0) and `  ` otherwise.
3. **menu navigation**: in the drilled state `↑`/`k` and `↓`/`j` move
   `menuCursor` (clamped to `[0, menuLen-1]`); `Enter` runs the selected item;
   `Esc` returns to the list and resets `menuCursor` to 0.
4. **story menu contents**: `buildStoryMenu` returns, in order: (a) a dispatch
   item labelled `Start — implement <id>` (classified) or `Start — classify
   <id>` (unclassified); (b) if a packet exists, `Open story packet`
   (`docs/stories/<filename>`); (c) one `Open <basename>` item per related doc
   from `referencedDocs(packet.text)` excluding the packet's own path, capped.
5. **backlog menu contents**: `buildBacklogMenu` returns a single dispatch item
   `Start — triage #<id>`.
6. **related docs**: `referencedDocs` extracts `docs/decisions/*.md`,
   `docs/initiatives/*.md`, `docs/product/*.md` paths referenced in packet
   markdown, de-duped, order-preserving, capped (default 8).
7. **wiring**: `menuSelect` resolves the active menu item — dispatch reuses
   `dispatchTarget()` + `dispatchPromptFor`; openDoc sends the item's `path`.
   `lens.menu` is computed from the menu builder for the current drill target.
8. **footer hints**: non-drilled `[↑↓/j,k] move · [Enter] open · [r] refresh ·
   [Esc] close` (matrix adds `· [f] filter`); drilled `[↑↓/j,k] choose ·
   [Enter] select · [Esc] back`. The old `[s] start` hint lines are removed
   from both list and detail. (`[g] group` is intentionally omitted from the
   matrix footer to stay within BOX_WIDTH — the toggle still works; it is
   consistent with the declutter intent.)
9. **purity + read-only**: `dashboard.ts` imports no pi types/runtime; the render
   path performs no durable writes (US-014 invariant preserved).
10. **green**: `npx tsc --noEmit` exit 0; `p2`/`p3`/`p4`/`p6` all pass.

## Design Notes

### DashboardNav — add menuCursor

```ts
export interface DashboardNav {
  tab: DashboardTab;
  cursor: number;            // list row cursor (list view)
  drill: DrillTarget | null;
  matrixFilter?: MatrixFilter;
  groupByInitiative?: boolean;
  menuCursor?: number;       // 0-based cursor within the detail action menu
}
```

### Menu types + builders (export, unit-testable)

```ts
export type MenuAction =
  | { kind: "dispatch" }
  | { kind: "openDoc"; path: string };

export interface MenuItem { label: string; action: MenuAction; }

export function referencedDocs(packetText: string, max?: number): string[]
export function buildStoryMenu(
  row: MatrixRow,
  packet: PacketRef | undefined,
  classifiedStoryIds: ReadonlySet<string>,
  parentIntakeId: number | undefined
): MenuItem[]
export function buildBacklogMenu(row: BacklogRow): MenuItem[]
```

- `buildStoryMenu`: (1) dispatch (label classified vs unclassified); (2) packet
  → `Open story packet`; (3) `referencedDocs(packet.text)` minus the packet's
  own path → `Open <basename>` (basename = last segment sans `.md`), cap ~6.
- `buildBacklogMenu`: dispatch → `Start — triage #<id>`.

### Reducer (`reduceDashboardNav`)

- Delete the `s` and `o` branches (list + drilled).
- Drilled state: Esc → clear drill + reset menuCursor; `r` → refresh; `1`/`2`
  → tab switch (reset cursor/drill/menuCursor/matrixFilter); `↑`/`k`,`↓`/`j`
  → clamp `menuCursor` within `[0, lens.menu-1]`; Enter → `action: "menuSelect"`.
- `f`/`g` stay matrix-list-only (non-drilled) — unchanged.
- `DashboardNavResult.action` union becomes `"close" | "refresh" | "menuSelect"`.
- Lens gains `menu: number` (menu-item count for the current drill; 0 when not
  drilled).

### Render

- `renderStoryDetail` / `renderBacklogDetail`: drop the `[s] start` hint line;
  append an `Actions:` block with the `▸`/`  ` marker per menu item (index vs
  `menuCursor`). Thread `menuCursor` + `classifiedStoryIds` + `parentIntakeId`
  through `renderDetail`.
- Footer per AC 8.

### Wiring (`index.ts`)

- Compute `lens.menu` from the menu builder for the current drill target.
- On `menuSelect`: resolve `nav.menuCursor ?? 0` → dispatch (reuse
  `dispatchTarget()` + `dispatchPromptFor`) or openDoc (`onDone({ action:
  "openDoc", path })`). Remove old direct dispatch/openDoc branches.

### Commands

- Validation: `npx tsc --noEmit`; `npx tsx tests/p4.test.ts`; `p2`/`p3`/`p6`.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id <id> --unit 1 --integration 1 --e2e 0 --platform 0`.

| Layer | Expected proof |
| --- | --- |
| Unit | pure reducer + menu-builder unit tests (p4) |
| Integration | overlay wiring drives drill → menu → menuSelect (p4 layer 2) |
| E2E | deferred (manual dogfood in real pi) |
| Platform | n/a (pi overlay) |
| Release | n/a |

## Harness Delta

None. Flow followed: intake #61 (change_request, normal) recorded before
implementation; this packet created to clear the orphan_durable drift before
the gate widened. No decision record needed (normal lane, no architecture/
contract/auth/data-ownership change — purely a UI affordance rework within the
existing overlay).

## Evidence

Implemented by a worker subagent (run 08bb17bf), re-verified independently
in the orchestrator session.

- `npx tsc --noEmit` → exit 0.
- `npx tsx tests/p4.test.ts` → 101 passed, 0 failed (menu builders, reducer
  menu nav, render, footer hints, wiring).
- `npx tsx tests/p2.test.ts` → 48 passed, 0 failed (gates byte-identical).
- `npx tsx tests/p3.test.ts` → 33 passed, 0 failed.
- `npx tsx tests/p6.test.ts` → 36 passed, 0 failed.

Verified by hand in `dashboard.ts`: `DashboardNavResult.action` union is
`"close" | "refresh" | "menuSelect"` (no `dispatch`/`openDoc` reducer
actions); `s`/`o` are no-ops on the list; drilled ↑/↓ clamp `menuCursor`
via `lens.menu`; `renderActionMenu` paints the `▸` marker; `index.ts`
`menuItemsFor` + `runMenuAction` resolve menuSelect → dispatch/openDoc.

Deviation from AC 8: matrix list footer shows `[f] filter` only (`[g] group`
omitted for width); see AC 8 note above. Accepted — aligns with the
declutter goal.
