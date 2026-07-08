# US-035 Rework harness-project-kicker -> initiative shaper; rename grill -> sharpen

## Status

implemented

## Lane

normal

## Product Contract

The harness-project-kicker skill shapes new initiatives: it sharpens a raw
requirement, records one `new_initiative` intake, writes initiative notes,
decomposes into slice stories, and links each slice to its initiative intake via
the new `parent_intake_id` column. The former "grill phase" is renamed
"sharpen" throughout; **grill** is reserved for on-demand story clarification
(the griller), and slice classification is automatic (the harness does it).

## Relevant Product Docs

- `docs/FEATURE_INTAKE.md` — input types, lanes, "the harness does" classification
- `docs/decisions/0010-initiative-slices-workflow-model.md` — the workflow model
- `docs/decisions/0012-kicker-grills-requirement-before-intake.md` — sharpen-before-umbrella (phase renamed; substance kept)
- `docs/initiatives/0001-realign-to-upstream.md` — the parent initiative (#44)
- `scripts/schema/009-story-parent-intake.sql` — the `parent_intake_id` link (US-033)

## Acceptance Criteria

- "grill phase" renamed to "sharpen" throughout the kicker skill; `GRILL-FORMAT.md`
  renamed to `SHARPEN-FORMAT.md` (old file removed, no dangling references).
- Step 6 documents the `parent_intake_id` linkage (`query sql` UPDATE) so slices
  are durably linked to their initiative intake.
- "Which skill?" cross-ref header distinguishes kicker/sharpen (initiatives) from
  grill (clarify a story), pointing to `docs/GLOSSARY.md`.
- Detail split into `SHARPEN-FORMAT.md` (interview) + `KICK-FORMAT.md`
  (decomposition + linkage + worked example), keeping `SKILL.md` readable.

## Design Notes

- Commands: `harness-cli intake --type new_initiative`; `story add`; `query sql
  "UPDATE story SET parent_intake_id=<id> WHERE id='US-NNN'"`.
- The CLI has no `--parent-intake` flag (prebuilt binary, ADR-0005), so the
  linkage is read/written via `query sql` (verified write-capable: a no-op UPDATE
  returned exit 0).
- Classification of a slice into an intake is automatic per upstream
  `FEATURE_INTAKE.md` ("the harness does"); the griller is an on-demand clarifier,
  not a per-slice gate. This realigns to upstream theory — grill/kicker are
  pi-harness additions; upstream `hoangnb24/repository-harness` has no grill concept.
- Off-by-one fix: `KICK-FORMAT.md` said "Loaded by step 4"; decomposition is step 5.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | markdown lint clean on all 3 skill files (write tool: ✓ Markdown clean) |
| Integration | grep confirms no residual `GRILL-FORMAT` / "grill phase" references |
| E2E | n/a (skill docs) |
| Platform | n/a |
| Release | n/a |

## Harness Delta

- Renamed `GRILL-FORMAT.md` -> `SHARPEN-FORMAT.md`; rewrote `SKILL.md` + `KICK-FORMAT.md`.
- Added the `parent_intake_id` linkage step (consumes migration 009 from US-033).
- Aligns with ADR-0015 (US-037, sibling): grill=clarification, sharpen=requirement understanding.
- `docs/GLOSSARY.md` grill/sharpen entries are owned by sibling workers (US-034/US-037);
  this skill references them but does not edit GLOSSARY (out of scope).

## Evidence

- Intake #47 (`spec_slice`, US-035) recorded this session.
- Files: `skills/harness-project-kicker/{SKILL.md, SHARPEN-FORMAT.md, KICK-FORMAT.md}`;
  `GRILL-FORMAT.md` removed.
- `story update --id US-035 --status implemented`.
