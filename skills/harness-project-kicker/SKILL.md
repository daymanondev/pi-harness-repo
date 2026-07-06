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

> Each step ends on a **completion criterion** — a checkable condition that
> tells you the step is genuinely done. Decomposition heuristics live in
> `KICK-FORMAT.md`; load it when you reach step 4.

### 1. Size the input

Read the raw requirement. Ask one question and answer it out loud: **is this
one small behavior, or a whole product area that needs many stories?**

- If it is one small behavior → **stop**. This is not a kicker job. Redirect to
  `harness-intake-griller` and end the skill.
- If it is a product area (an initiative) → continue to step 2.

Also scan the ten hard-gate risk flags from `FEATURE_INTAKE.md` (auth, data
loss, public contracts, …). Note any that apply; they decide the lane in step 2.

**Done when:** the input is classified as either "one behavior → griller" or
"initiative → continue", and never both.

### 2. Record the umbrella intake

Record **exactly one** intake for the whole initiative:

```
harness-cli intake --type new_initiative --lane <tiny|normal|high-risk> \
  --summary "<one paragraph: the problem, the product area, the why>"
```

Capture the returned intake id. Every slice this kicker produces will hang off
this one id — there is no per-slice intake from the kicker.

**Done when:** exactly one `new_initiative` intake row exists for this
initiative and its id is written down.

### 3. Write the roadmap — not a spec

Write a short **roadmap** document (initiative notes). It names the product
areas or milestones — it does **not** list tasks, acceptance criteria, or
implementation steps. Keep it reference-grade: architecture shape, hard
constraints, open questions.

Apply the roadmap rule (below): if it grows past a few screens or starts
behaving like a to-do list, stop and shrink it.

**Done when:** a roadmap exists; it names milestones, not tasks; and no
acceptance criterion or step-by-step lives in it.

### 4. Decompose into slices

Load `KICK-FORMAT.md` and break each milestone into **tracer-bullet vertical
slices**. For each slice write a one-line contract (the end-to-end behavior it
delivers) and a `blocked-by` if it depends on another slice.

Then quiz the user on three things, and iterate until they approve:

- granularity — too coarse, too fine, or right?
- dependencies — are the `blocked-by` relationships correct?
- merge/split — should any slices be combined or split further?

**Done when:** every milestone is decomposed into at least one slice; every
slice has a one-line contract; the user has approved the list; and no slice is
larger than its lane's token budget.

### 5. Sequence and hand off

Order the slices by dependency (blockers first) and create one **planned**
story row for each, linked to the umbrella intake:

```
harness-cli story add --id US-NNN --title "<slice contract>" --lane <lane>
harness-cli story update --id US-NNN --status planned
```

Then **stop**. Hand only the **first** slice to `harness-intake-griller`, which
classifies it and fills its packet. The kicker does not write code, does not
fill packets, and does not start the second slice.

**Done when:** every slice exists as a planned story under the umbrella
intake; the first slice has been handed to the griller; and **no code has been
written by the kicker**.

## The roadmap rule

The roadmap is a **map of milestones**, not a to-do list and never a growing
monolithic spec. `FEATURE_INTAKE.md` warns against creating or extending a
monolithic spec after intake; `docs/decisions/0010-…` records why. If the
roadmap starts behaving like a work tracker, stop and shrink it.

## Hand-off

The kicker's last step hands the **first slice only** to the
`harness-intake-griller` skill, which classifies and records that slice. The
kicker itself does not implement.

## Worked example (the shape a run produces)

Input: _"I want offline mode — gates still block with no network."_

- **Step 1** — this is a product area, not one behavior → continue.
- **Step 2** — one intake: `intake --type new_initiative --lane high-risk
  --summary "Offline gate enforcement…"` → id #N.
- **Step 3** — roadmap names milestones only: _detect offline_, _offline gate
  decision_, _trace buffering_. No tasks, no acceptance criteria.
- **Step 4** — slices (one-line contracts, from `KICK-FORMAT.md`):
  - _US-NNN — detect offline at session_start, surface in footer (end-to-end:
    detect → footer → test)._
  - _US-NNN — gates fail-closed when offline (decision + tests)._
  - _US-NNN — buffer trace locally, sync on reconnect._
  Quiz the user → approve.
- **Step 5** — three `planned` stories under intake #N; hand only the first to
  the griller. **Stop. No code written by the kicker.**

The real validation is the next genuine project kickoff — this example only
fixes the expected shape.

## Related

- `skills/harness-intake-griller/SKILL.md` — per-slice classifier (the hand-off target)
- `docs/FEATURE_INTAKE.md` — input types (`new_initiative`, `spec_slice`), lanes
- `docs/CONTEXT_RULES.md` — token budget per lane, the "keep story current" resume rule
- `docs/decisions/0010-initiative-slices-workflow-model.md` — the workflow model this skill codifies
