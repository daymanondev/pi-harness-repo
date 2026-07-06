---
name: harness-project-kicker
description: Project-start flow for a harness repo — turn a raw requirement into a new_initiative intake, a roadmap (NOT a monolithic spec), and a list of small vertical-slice stories, then hand the first slice to the griller. User-invoked at project kickoff.
disable-model-invocation: true
---

# Harness Project Kicker

Turn one raw requirement into one umbrella intake + a roadmap + a list of small
**slice** stories, then stop. The kicker never writes code and never writes a
monolithic spec.

## When to reach for this skill

Run this at the **start** of a new project (or when a new initiative arrives
mid-project), the moment you hold a raw requirement and need to shape it into
safe, classified, decomposed work before any code is written.

Do **not** run this on an existing story — a story is downstream of an intake,
not input to one. (See ADR-0010.)

## Leading word — slice

Every decision in this skill is judged by one question: **is this one slice, or
many?** A slice is a thin vertical cut that delivers a complete but narrow path
end-to-end — never a horizontal slab of one layer. When in doubt, split.

## Inputs

A raw requirement (prose, a conversation, or a brief). Nothing is assumed to be
classified yet — that is this skill's job.

## Process

> Step bodies live in this section. They are written in US-008; this skeleton
> fixes only the shape and the order. Each step ends on a checkable completion
> criterion (to be filled in US-008).

### 1. Size the input

(_filled in US-008_)

### 2. Record the umbrella intake

(_filled in US-008_)

### 3. Write the roadmap — not a spec

(_filled in US-008_)

### 4. Decompose into slices

(_filled in US-008_)

### 5. Sequence and hand off

(_filled in US-008_)

## The roadmap rule

The roadmap is a **map of milestones**, not a to-do list and never a growing
monolithic spec. `FEATURE_INTAKE.md` warns against creating or extending a
monolithic spec after intake; `docs/decisions/0010-…` records why. If the
roadmap starts behaving like a work tracker, stop and shrink it.

## Hand-off

The kicker's last step hands the **first slice only** to the
`harness-intake-griller` skill, which classifies and records that slice. The
kicker itself does not implement.

## Related

- `skills/harness-intake-griller/SKILL.md` — per-slice classifier (the hand-off target)
- `docs/FEATURE_INTAKE.md` — input types (`new_initiative`, `spec_slice`), lanes
- `docs/CONTEXT_RULES.md` — token budget per lane, the "keep story current" resume rule
- `docs/decisions/0010-initiative-slices-workflow-model.md` — the workflow model this skill codifies
