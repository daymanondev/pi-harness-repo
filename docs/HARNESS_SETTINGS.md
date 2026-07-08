# Harness Settings

Operator-tunable settings for the pi-harness extension. The dashboard is the
primary surface; the knobs below are what an operator can change or request.

## Dashboard

- **Tabs** (hotkey): `1` matrix · `2` stats · `3` backlog · `4` tools · `5` drift
  · `6` decisions · `7` initiatives · `t` timeline.
- **Matrix status-filter** (`f`): cycles all → unclassified → planned → done.
- **Classified badge**: `●` = the story has **any** intake linked (ready to
  implement); `○` = unclassified (classify first). Replaces the former "grilled"
  badge (ADR-0015). The signal is the latest linked intake; changes append a new
  `change_request` intake rather than amending.
- **Initiatives tab** (`7`): groups slice stories under their `new_initiative`
  intake via `story.parent_intake_id` (migration 009) — "which slice belongs to
  which initiative" at a glance.
- **Click-to-run** (`s`): dispatches the selected matrix / backlog / initiatives
  row to the agent in-session via `pi.sendUserMessage` (ADR-0014). Pane-spawn
  dispatch is deferred (US-028).

## Intake / classification

- Classification is **automatic** — the harness classifies each work item
  (`docs/FEATURE_INTAKE.md`: "the harness does"). The grill
  (`harness-intake-griller`) is an on-demand clarification tool, **not** a gate.
- Evolution = a **new** `change_request` intake (append), never an amend. There
  is no "re-intake" concept.

## Slice → initiative linkage

- `story.parent_intake_id` (migration `009-story-parent-intake.sql`) links a
  slice to its `new_initiative` intake. The kicker sets it via:

  ```bash
  scripts/bin/harness-cli query sql "UPDATE story SET parent_intake_id=<intake_id> WHERE id='US-NNN'"
  ```

  The prebuilt CLI has no command for the column (ADR-0005), so `query sql` is
  the channel — the same channel `story_hierarchy` (migration 008) already
  requires. `parent_intake_id` is mutable, so a slice can be re-parented if
  decomposition changes.

## Skills

Two skills ship under `skills/` (declared in `package.json` → `pi.skills`):

- `harness-project-kicker` — initiative shaper (sharpen → `new_initiative` intake
  → initiative notes → decompose slices → link via `parent_intake_id` → drive
  the loop). User-invoked at kickoff.
- `harness-intake-griller` — on-demand clarification for an ambiguous story/slice.
  Not a gate (ADR-0015).

See `docs/GLOSSARY.md` (grill / sharpen / classified) and
`docs/decisions/0015-realign-grill-to-clarification.md`.

## Auto-pilot (US-030, in progress)

A settings panel for unattended implement-all-classified runs is in progress
(US-030): run-mode (main/sub), auto-commit-to-local-branch, auto-backlog,
backlog-priority, lane-scope, story-cap, halt-on-fail, verify-gating, worker
tool-budget, dry-run. Tracked in `docs/stories/US-030-overnight-auto-pilot.md`.

## Adding a setting

Dashboard rendering is pure (`extensions/harness/dashboard.ts` — no pi imports);
state + SQL are wired in `extensions/harness/index.ts`. To add a knob: extend
`DashboardData` / `DashboardNav`, wire the query in `index.ts`, add a parser +
test under `tests/`, and document it here.
