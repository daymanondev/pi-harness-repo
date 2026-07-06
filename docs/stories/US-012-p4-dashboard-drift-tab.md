# US-012 P4 dashboard — Drift tab (markdown↔durable cross-check)

## Status

implemented

## Lane

normal

## Product Contract

Add a **Drift** tab that reads markdown story status and the durable
`harness.db` rows, compares them via a pure drift function, and renders
mismatches (status_mismatch / orphan_markdown / orphan_durable /
missing_evidence) with fix hints. Closes backlog #2 — drift becomes visible
inside one session instead of accumulating silently.

Umbrella intake: #13. Roadmap: `docs/initiatives/P4-dashboard.md` (M4).

**blocked-by:** US-010 (needs the shell). **Not** blocked-by US-011 — drift is
independent of the read-only query triplet.

## Relevant Product Docs

- `pi-harness-design/DESIGN.md` §7 (Drift tab), §11, §9.2 Gate B′
- `docs/initiatives/P4-dashboard.md`
- P2 Gate B′ implementation (the existing drift check to reuse/generalize)

## Acceptance Criteria

- A pure `drift()` function over a fixture with a seeded mismatch returns the
  mismatch kind + a fix hint.
- The Drift tab renders current drift (or "no drift" when clean).
- On the live repo it surfaces the same class of drift Gate B′ blocks on.
- backlog #2 is marked `implemented` when this lands.

## Design Notes

- **Q3 resolved — generalize into a shared pure function.** Extracted
  `computeDrift(durable, markdown) → DriftRecord[]` (pure) in
  `extensions/harness/drift.ts`. Both Gate B′ (`detectDrift`, US-003) and the
  new Drift tab call it — single source of truth for drift logic. Added a
  `fixHint` per `DriftKind` so the tab shows actionable guidance, not just the
  mismatch.

  Authoritative fields:
  - durable = `story.status` (parsed from `query matrix`).
  - markdown = `## Status` token + `## Evidence` presence in
    `docs/stories/US-*.md`.
  - `retired` durable rows without a packet are NOT drift (retire is the
    sanctioned "packet removed" path); other active statuses without a packet
    are.

## Validation

To be filled by `harness-intake-griller` when this slice is reached.

| Layer | Expected proof |
| --- | --- |
| Unit | pure `drift()` over seeded mismatches |
| Integration | tab against a fixture repo with known drift |
| E2E | (deferred) |
| Platform | (n/a) |
| Release | (n/a) |

## Harness Delta

- New planned story under umbrella intake #13 (P4 DASHBOARD initiative).
- Closes backlog #2.
- blocked-by US-010.

## Evidence

- `extensions/harness/drift.ts`: new pure `computeDrift()` + `fixHintFor()` +
  `MarkdownStory` / `DurableStatusMap` / `MarkdownStoryMap` types; `detectDrift`
  refactored to delegate its comparison loop to `computeDrift` (Gate B′ and the
  Drift tab now share one definition of drift). `DriftRecord.fixHint` added.
- `extensions/harness/dashboard.ts`: `DashboardTab` += `"drift"` (hotkey `5`);
  `DASHBOARD_TABS` + `DashboardData.drift`; `renderDriftTab()` renders each
  mismatch (kind + `durable | markdown` + fix hint) or a clean "✓ no drift" line,
  with a dim error row on fetch failure (degrades cleanly, never throws);
  footer hint updated to `[1-5]`.
- `extensions/harness/index.ts`: `fetchDrift()` calls `detectDrift` and maps its
  synthetic "(query matrix failed)" record → `null` so the tab degrades to a dim
  error row like the other query tabs; wired into `fetchDashboardData` (5-way
  `Promise.all`) and the `5` keybinding.
- Validation: `tsc --noEmit` clean; `tests/p4.test.ts` **46/46** (+10 drift
  tests: `computeDrift` over all 4 kinds + clean, `fixHintFor` exhaustiveness,
  `renderDriftTab` clean/list/error); **p3 33/33**, **p2 44/44** no regression;
  lens = 0 errors.
- Closes backlog #2 (markdown↔durable status drift pattern).
