# US-038 Settings panel + skill audit (keep/delete; ensure skills run correctly)

## Status

implemented

## Lane

normal

## Product Contract

Audit the two repo skills for correctness (resolve, valid references, accurate
descriptions) and document the operator-tunable settings surface. Part of
initiative #44 (realign to upstream).

## Relevant Product Docs

- `skills/harness-intake-griller/SKILL.md`, `skills/harness-project-kicker/SKILL.md`
- `docs/GLOSSARY.md`, `AGENTS.md` (Project Skills)
- `docs/HARNESS_SETTINGS.md` (new)
- `docs/decisions/0015-realign-grill-to-clarification.md`

## Acceptance Criteria

- Both skills have valid YAML frontmatter (name + description, third person,
  "Use when...") and all file references resolve.
- No stale `GRILL-FORMAT` references remain after the →`SHARPEN-FORMAT` rename.
- `AGENTS.md` Project Skills describes both skills accurately (kicker =
  initiative shaper; griller = clarification) and points to ADR-0015.
- `docs/GLOSSARY.md` grill/sharpen entries reflect the new model (+ `Classified`).
- `docs/HARNESS_SETTINGS.md` catalogs the tunable knobs + how to extend.
- `tsc --noEmit` clean; tests pass.

## Design Notes

- **Skill audit result:** both skills resolve. Griller SKILL.md = 98 lines
  (<100 ✓); references `docs/FEATURE_INTAKE.md`, `docs/GLOSSARY.md`,
  `INTAKE-FORMAT.md` (all exist). Kicker SKILL.md = 125 lines (broader scope —
  sharpen + intake + notes + decompose + linkage + drive loop; detail split into
  `KICK-FORMAT.md` / `SHARPEN-FORMAT.md`); references all resolve. No stale
  `GRILL-FORMAT` refs. Kicker has `disable-model-invocation: true` (user-invoked
  at kickoff) — intentional.
- **Settings decision:** the dashboard is the primary surface; the real code
  settings panel is US-030 (auto-pilot, in progress). For this slice, settings
  are documented in `docs/HARNESS_SETTINGS.md` (tabs, classified badge,
  initiatives grouping, click-to-run, intake/classification, slice→initiative
  linkage, how to add a knob). Adding speculative code settings was rejected to
  keep the green build solid (correctness > features, per the goal's "xịn").
- Both skills kept (none deleted): each has a distinct, non-overlapping role
  (initiative-shaping vs story-clarification).

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | n/a (structural audit + docs) |
| Integration | 0 |
| E2E | 0 |
| Platform | 0 |
| Release | 0 |

## Harness Delta

- `docs/HARNESS_SETTINGS.md` (new).
- `docs/GLOSSARY.md` (grill/sharpen rewritten; `Classified` added).
- `AGENTS.md` (Project Skills — both skills, accurate).
- `extensions/harness/dashboard.ts` (stale "grilled" comment → "classified").

## Evidence

- Skill audit: `grep` of file refs in both SKILL.md → all resolve; `ls` of both
  skill dirs; no `GRILL-FORMAT` remnants; frontmatter valid.
- `wc -l`: griller 98, kicker 125.
- `tsc --noEmit` exit 0; `npx tsx --test tests/*.test.ts` → 36 passed, 0 failed.
