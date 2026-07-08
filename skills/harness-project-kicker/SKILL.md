---
name: harness-project-kicker
description: Initiative shaper for a harness repo — sharpen a raw requirement into understanding, record one new_initiative intake, write initiative notes (NOT a monolithic spec), decompose into small vertical-slice stories linked to the intake, then drive the per-slice classify→implement→trace loop. User-invoked at initiative kickoff.
disable-model-invocation: true
---

# Harness Project Kicker

Turn one raw requirement into a sharpened understanding, one `new_initiative`
intake, initiative notes (a roadmap, NOT a spec), slice stories **linked to that
intake**, and a **driven per-slice loop**. The kicker never writes code and never
writes a monolithic spec.

> **Which skill?** Initiative-level: it *sharpens* a whole initiative and
> decomposes it into slices. To *clarify* one already-decomposed story that is
> unclear, use [`harness-intake-griller`](../harness-intake-griller/SKILL.md) — on
> demand, not a gate. Per `docs/GLOSSARY.md`: **sharpen** = understand a
> requirement (this skill, no durable row); **grill** = clarify a story. Slice
> classification is automatic ("the harness does", `FEATURE_INTAKE.md`).

## When to reach for this skill

At the **start of a new initiative** — a raw requirement (new product area, idea,
prompt) to shape into safe, decomposed work before any code. Do **not** run this
on an existing story (a story is downstream of an intake). The first job is to
**understand** (sharpen), not to slice; when in doubt, ask another question
before recording anything.

## Process

> Each step ends on a **completion criterion**. Sharpen reference:
> `SHARPEN-FORMAT.md` (step 2). Decomposition + linkage: `KICK-FORMAT.md`
> (steps 5–6).

### 1. Triage — one behaviour, or an initiative?

One behaviour → **stop**, redirect to `harness-intake-griller`. A product area
needing many stories → continue. Scan the ten hard-gate risk flags
(`FEATURE_INTAKE.md`); note any that obviously apply.

**Done:** classified "one behaviour → griller" or "initiative → continue".

### 2. Sharpen the requirement (before any intake)

Load `SHARPEN-FORMAT.md`. Interview — **one question at a time,
recommend-then-confirm**, grounded in `query matrix`/`stats`/`backlog` + `rg`.
Resolve shape, tracer-bullet, scope, fuzz, risk surface. Produces
**understanding, not rows** — each slice is classified just-in-time when worked.
"Intake every feature upfront" is the monolithic-spec anti-pattern (ADR-0010).

**Done:** a sharpened requirement (`SHARPEN-FORMAT.md` Output).

### 3. Record the umbrella intake (verified, not guessed)

Record **exactly one** intake, summary sourced from the sharpen:

```
harness-cli intake --type new_initiative --lane <tiny|normal|high-risk> \
  --summary "<from the sharpen: problem, area, why, named features, scope>" \
  --flags <comma-separated>
```

Capture the **intake id** — every slice links to it (step 6).

**Done:** one `new_initiative` row, summary reflects the sharpen, id written down.

### 4. Write initiative notes — a roadmap, not a spec

Write `docs/initiatives/NNNN-<slug>.md`: goal, affected docs, candidate stories,
validation shape, open questions, exit criteria. Names milestones, **not** tasks.
If it behaves like a to-do list, shrink it.

**Done:** notes exist; milestones not tasks; open questions recorded.

### 5. Decompose into slices

Load `KICK-FORMAT.md`. Break each milestone into **tracer-bullet vertical
slices** (one-line contract + `blocked-by` if dependent). Quiz the user on
granularity, dependencies, merge/split; iterate until approved.

**Done:** every milestone decomposed; every slice has a one-line contract;
approved; none exceeds its lane budget.

### 6. Create stories, link to the intake, drive the loop

Order by dependency. Create one **planned** story per slice and **link it to the
umbrella intake** via `parent_intake_id`:

```
harness-cli story add --id US-NNN --title "<slice contract>" --lane <lane>
harness-cli query sql "UPDATE story SET parent_intake_id=<INTAKE_ID> WHERE id='US-NNN'"
```

`parent_intake_id` (migration 009) is the durable slice→initiative link the
dashboard groups on. No CLI flag for it (prebuilt binary, ADR-0005) → set via
`query sql` (write-capable). A story packet (`docs/stories/US-NNN-*.md`) is
written when the slice moves to in_progress (classify→implement→trace), not at
kickoff; planned candidates need no packet (ADR-0015 just-in-time model). Then
**do not stop after slice 1** — drive:

```
slice N -> classify (intake --type spec_slice --story US-NNN) [griller only if unclear]
        -> implement -> trace -> slice N+1
```

Classification is automatic; the griller is an on-demand clarifier, not a gate.
You may classify + start the first 1–2 tracer-bullets at kickoff; the rest stay
just-in-time.

**Done:** every slice a planned story linked via `parent_intake_id`; loop
described; first tracer-bullet handed off; **no code written by the kicker**.

## Rules

- **Roadmap, not tracker.** Initiative notes map milestones, never a to-do list
  or growing spec (ADR-0010). If it tracks, shrink it.
- **Sharpen, don't record.** Step 2 understands; it does not classify or record
  per-feature work. If it starts producing intake rows, it has drifted — stop.

## Related

- `skills/harness-intake-griller/SKILL.md` — story clarifier (on demand, not a gate)
- `SHARPEN-FORMAT.md` — requirement-level interview (step 2)
- `KICK-FORMAT.md` — decomposition, slice→intake linkage, worked example (steps 5–6)
- `docs/FEATURE_INTAKE.md` — input types, lanes, flags
- `docs/CONTEXT_RULES.md` — token budget per lane, resume rule
- `docs/decisions/0010-initiative-slices-workflow-model.md` — the workflow model
- `docs/decisions/0012-kicker-grills-requirement-before-intake.md` — sharpen-before-umbrella (renamed; substance kept)
