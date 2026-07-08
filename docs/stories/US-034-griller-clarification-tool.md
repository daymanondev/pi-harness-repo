# US-034 Rework harness-intake-griller into a clarification tool

## Status

implemented

## Lane

normal

## Product Contract

The `harness-intake-griller` skill is an **on-demand clarification interview**
for a single ambiguous story/slice — not a mandatory per-slice `spec_slice`
intake gate. Intake classification stays **automatic** per
`docs/FEATURE_INTAKE.md` ("the harness does"). This is slice 2 of initiative
# 44 (intake #44).

## Relevant Product Docs

- `docs/FEATURE_INTAKE.md` — intake rules (authoritative)
- `docs/GLOSSARY.md` — grill/sharpen vocabulary
- `docs/decisions/0010-initiative-slices-workflow-model.md`
- `docs/decisions/0012-kicker-grills-requirement-before-intake.md`
- `docs/decisions/0015-*.md` — ADR-0015, the supersession (US-037)
- `docs/initiatives/0001-realign-to-upstream.md`

## Acceptance Criteria

- Grill is an on-demand clarification interview, **not** a per-slice intake gate.
- No mandatory `spec_slice` intake per slice; classification is automatic per
  FEATURE_INTAKE ("the harness does").
- "Which skill?" cross-ref header present, distinguishing **grill** (clarify a
  story) from **kicker/sharpen** (shape a new initiative), pointing to GLOSSARY.
- SKILL.md under ~100 lines; detail split into INTAKE-FORMAT.md.
- The "grilled = spec_slice intake" invariant is removed (the dashboard owns the
  readiness signal now — reworked to "classified" in US-036).

## Design Notes

- The grill explores repo state before asking (explore-before-ask), asks one
  question at a time, recommends-then-confirms. A genuine question must be
  non-derivable AND material.
- Output is a sharpened behavior sketch (tracer-bullet + in/out + resolved
  ambiguities) that feeds the automatic classification — not a durable row.
- Evolution is append-only: a later change = a new `change_request` intake,
  never an amend. This dissolves the immutability/re-intake trap (a stale
  classification is superseded by a newer intake, not edited).

### Pros / cons

- **Pro** — removes the ceremony that redirected slice scope; keeps automatic
  things automatic (the FEATURE_INTAKE principle); dissolves the immutability
  trap by making classification append-only, not amend-based.
- **Pro** — grill is still available when genuinely needed (UI questions, fuzzy
  acceptance); not deleted, just no longer a gate.
- **Con** — the "grilled ●/○" readiness signal is gone from this skill's
  contract; US-036 replaces it with "classified" (any intake). Temporary
  cross-skill dependency until US-036 + ADR-0015 land.
- **Con** — `docs/GLOSSARY.md` still defines grill as "classify + record a
  slice" (the old meaning); it needs updating to "clarify a story" — out of
  this slice's file scope (flagged for the parent / ADR-0015).
- **Con** — `AGENTS.md` "Project Skills" line still describes the griller as
  for "feature intake, docs, or story shaping"; now slightly inaccurate —
  flagged for the parent (out of this slice's file scope).

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | n/a (skill markdown; no code) |
| Integration | structural self-audit — cross-ref header, <100 lines, no per-slice gate |
| E2E | n/a |
| Platform | n/a |
| Release | n/a |

## Harness Delta

- `skills/harness-intake-griller/SKILL.md` — rewritten as a clarification tool.
- `skills/harness-intake-griller/INTAKE-FORMAT.md` — documents automatic
  classification; flags as a recommended set, not a gate; append-only evolution.
- `skills/harness-intake-griller/DECISION-FORMAT.md` — marked optional
  companion for high-risk classifications (not part of the clarification flow).
- Depends on: ADR-0015 (US-037), GLOSSARY grill/sharpen update, dashboard
  classified-badge (US-036).

## Evidence

- Rewritten: `skills/harness-intake-griller/SKILL.md`, `INTAKE-FORMAT.md`,
  `DECISION-FORMAT.md`.
- Intake #46 (spec_slice, US-034) recorded this session (flow gate A satisfied).
- Structural self-audit: cross-ref header present; SKILL.md <100 lines; no
  "spec_slice intake gate" / "grilled invariant" remains; classification framed
  as automatic per FEATURE_INTAKE.
- `harness-cli story update --id US-034 --status implemented ...` (below).
