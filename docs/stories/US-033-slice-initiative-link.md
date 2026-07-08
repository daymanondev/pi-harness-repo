# US-033 Slice→initiative durable link (parent_intake_id migration 009 + query-sql wiring)

## Status

implemented

## Lane

normal

## Product Contract

A slice story can be durably linked to its parent initiative intake via
`story.parent_intake_id`, so the dashboard can render an initiative→slices
hierarchy **without** inventing a parent "initiative story" (upstream models an
initiative as a `new_initiative` intake + notes, not a story).

## Relevant Product Docs

- `docs/FEATURE_INTAKE.md` — intake classifies one work item; `new_initiative` type.
- `docs/HARNESS.md` — "Large product areas should use scoped initiative notes."
- `docs/initiatives/0001-realign-to-upstream.md` — the initiative this serves (#44).
- `scripts/schema/009-story-parent-intake.sql` — the migration.
- `docs/decisions/0015-realign-grill-to-clarification.md` — records the decision (US-037).

## Acceptance Criteria

- Migration 009 adds `story.parent_intake_id` (nullable, FK→`intake.id`) + an
  index; applies cleanly on top of schema v8.
- The six initiative-#44 slices (US-033..US-038) carry `parent_intake_id = 44`.
- The read/write path is documented: the prebuilt CLI (ADR-0005) has no command
  for this column, so it is read/written via `harness-cli query sql`
  (write-capability verified).
- Additive only: no existing row, column, or constraint is altered.

## Design Notes

- **Why `parent_intake_id` (not `story_hierarchy`):** upstream says an initiative
  is an intake + notes, **not** a parent story. `parent_intake_id` is a 1-hop
  slice→intake link that matches that mental model. `story_hierarchy`
  (upstream migration 008) remains available for story→story grouping but is not
  the initiative link. (Pros: 1-hop queryable, matches initiative=intake.
  Cons: a pi-harness extension column the CLI doesn't surface — mitigated by
  `query sql`.)
- **Write path (kicker):** after `story add` for each slice, the kicker runs
  `scripts/bin/harness-cli query sql "UPDATE story SET parent_intake_id=<intake_id> WHERE id='US-NNN'"`.
- **Read path (dashboard):** `scripts/bin/harness-cli query sql "SELECT id,title,status FROM story WHERE parent_intake_id=<id> ORDER BY id"`.
- **Immutability note:** `parent_intake_id` is mutable via `query sql` (unlike
  `intake` rows), so a slice can be re-parented if decomposition changes — this
  is intentional and dissolves part of the re-intake trap.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | n/a (schema migration) |
| Integration | 0 (no code path yet; dashboard wiring is US-036) |
| E2E | 0 |
| Platform | 0 |
| Release | 0 |

## Harness Delta

- `scripts/schema/009-story-parent-intake.sql` (new migration; schema_version → 9).
- Intake #44 (`new_initiative`) + `docs/initiatives/0001-realign-to-upstream.md`.
- Six slice stories US-033..US-038 linked to intake #44.

## Evidence

- `harness-cli migrate` → "Applying migration 9... Applied 1 migration(s)."
- `query sql "SELECT name FROM pragma_table_info('story') WHERE name='parent_intake_id'"` → returns `parent_intake_id`.
- `query sql "SELECT id,title,parent_intake_id FROM story WHERE parent_intake_id=44"` → US-033..US-038, all `44`.
- `query sql "UPDATE story SET notes=notes WHERE id='US-NOOP-TEST'"` → exit 0 (write-capable).
