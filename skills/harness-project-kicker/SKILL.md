---
name: harness-project-kicker
description: Project-start flow for a harness repo — grill a raw requirement into a sharpened understanding, record one umbrella intake, write a roadmap (NOT a monolithic spec), decompose into small vertical-slice stories, then drive the per-slice intake loop (slice → griller → execute → trace → next). User-invoked at project kickoff.
disable-model-invocation: true
---

# Harness Project Kicker

Turn one raw requirement into a sharpened understanding, one umbrella intake, a
roadmap (NOT a monolithic spec), a list of small **slice** stories, and a
**driven per-slice loop**. The kicker never writes code and never writes a
monolithic spec.

> **Which skill?** This is the **requirement-level** flow: it *sharpens* a
> whole initiative and decomposes it into slices. To classify + record **one
> already-decomposed slice**, use
> [`harness-intake-griller`](../harness-intake-griller/SKILL.md). Per
> `docs/GLOSSARY.md`: **sharpen** = understand a requirement (this skill, no
> durable row); **grill** = classify + record a slice (griller, produces the
> `spec_slice` intake).

## When to reach for this skill

Run this at the **start** of a new project (or when a new initiative arrives
mid-project), the moment you hold a raw requirement and need to shape it into
safe, classified, decomposed work before any code is written.

Do **not** run this on an existing story — a story is downstream of an intake,
not input to one. (See ADR-0010, extended by ADR-0012.)

## Leading word — requirement

Every decision in this skill is judged by one question: **do you actually
understand the requirement yet?** A kickoff requirement is usually fuzzy — one
sentence that hides many features, or a goal stated as a mechanism. The first
job is to **understand** it (grill), not to slice it. Slicing comes later,
applied to a sharpened requirement. When in doubt, ask another question before
recording anything.

## Inputs

A raw requirement (prose, a conversation, or a brief). Nothing is assumed to be
classified yet — that is this skill's job.

## Process

> Each step ends on a **completion criterion** — a checkable condition that
> tells you the step is genuinely done. The grill reference lives in
> `GRILL-FORMAT.md` (step 2); the decomposition heuristics live in
> `KICK-FORMAT.md` (step 5).

### 1. Triage — one behaviour, or an initiative?

Read the raw requirement. Ask one question and answer it out loud: **is this
one small behaviour, or a whole product area that needs many stories?**

- If it is one small behaviour → **stop**. This is not a kicker job. Redirect to
  `harness-intake-griller` and end the skill.
- If it is a product area (an initiative) → continue to step 2.

Also scan the ten hard-gate risk flags from `FEATURE_INTAKE.md` (auth, data
loss, public contracts, …). Note any that obviously apply; they become an early
lane signal and are stress-tested properly in step 2.

**Done when:** the input is classified as either "one behaviour → griller" or
"initiative → continue", and never both.

### 2. Grill the requirement (before any intake is recorded)

Load `GRILL-FORMAT.md`. Run a relentless, requirement-level interview — **one
question at a time, recommend-then-confirm**, grounded in live durable state
(`query matrix`, `query stats`, `query backlog`, `rg` the codebase). Resolve,
in order:

- **Shape** — roughly how many independent features / product areas are buried
  in this? Name them.
- **Core value / tracer-bullet** — the thinnest end-to-end path that proves the
  idea.
- **Scope** — in-scope vs out-of-scope (confirm the out-of-scope list; it is
  the one most likely to be wrong).
- **Fuzz** — which terms are vague, and which assumptions should surface as
  questions instead.
- **Risk surface** — go through all 10 flags; mark any that touch the
  requirement **anywhere** (coarse signal, not per-slice classification).

The grill produces **understanding, not durable rows**. It records nothing
per-feature — that is the griller's job, per slice, just-in-time. Drift toward
"intake every feature upfront" is the monolithic-spec anti-pattern ADR-0010
rejects; the grill *understands*, the per-slice griller *records*.

**Done when:** you hold a sharpened requirement (shape named, tracer-bullet
stated, scope lists confirmed, fuzz resolved or deferred, risk surface marked)
— the shape described in `GRILL-FORMAT.md`'s "Output" section.

### 3. Record the umbrella intake (verified, not guessed)

Record **exactly one** intake for the whole initiative, and source its summary
from the grill output, not your first guess:

```
harness-cli intake --type new_initiative --lane <tiny|normal|high-risk> \
  --summary "<one paragraph sourced from the grill: the problem, the product
             area, the why, the named features, the confirmed scope>"
```

Capture the returned intake id. Every slice this kicker produces will hang off
this one id — there is no per-slice intake from the kicker.

**Done when:** exactly one `new_initiative` intake row exists for this
initiative, its summary reflects the grill output, and its id is written down.

### 4. Write the roadmap — not a spec

Write a short **roadmap** document (initiative notes). It names the product
areas or milestones — it does **not** list tasks, acceptance criteria, or
implementation steps. Keep it reference-grade: architecture shape, hard
constraints, the **open questions** surfaced by the grill, exit criteria.

Apply the roadmap rule (below): if it grows past a few screens or starts
behaving like a to-do list, stop and shrink it.

**Done when:** a roadmap exists; it names milestones, not tasks; the grill's
open questions are recorded; and no acceptance criterion or step-by-step lives
in it.

### 5. Decompose into slices

Load `KICK-FORMAT.md` and break each milestone into **tracer-bullet vertical
slices**. For each slice write a one-line contract (the end-to-end behaviour it
delivers) and a `blocked-by` if it depends on another slice.

Then quiz the user on three things, and iterate until they approve:

- granularity — too coarse, too fine, or right?
- dependencies — are the `blocked-by` relationships correct?
- merge/split — should any slices be combined or split further?

**Done when:** every milestone is decomposed into at least one slice; every
slice has a one-line contract; the user has approved the list; and no slice is
larger than its lane's token budget.

### 6. Sequence and drive the per-slice loop

Order the slices by dependency (blockers first) and create one **planned**
story row for each, linked to the umbrella intake:

```
harness-cli story add --id US-NNN --title "<slice contract>" --lane <lane>
harness-cli story update --id US-NNN --status planned
```

Then **do not stop after slice 1.** The old behaviour (hand the first slice to
the griller and vanish) abandoned slices 2..N as planned orphans. Instead, set
up and describe the driven loop explicitly:

```
slice N  -> harness-intake-griller (intake spec_slice + packet)
         -> execute
         -> trace
         -> slice N+1
```

You may intake the **first 1–2 tracer-bullet slices** at kickoff to validate
the decomposition — hand those to `harness-intake-griller` now, which
classifies each and fills its packet. The remaining slices stay **just-in-time**:
each is intaken by the griller when it starts. This is **not** "intake every
feature upfront" (the monolithic-spec anti-pattern); it is understanding-once,
recording-on-demand.

The kicker itself still does not write code, does not fill packets beyond the
tracer-bullets it hands off, and does not start the second slice's
implementation.

**Done when:** every slice exists as a planned story under the umbrella
intake; the loop is described; the first tracer-bullet slice has been handed
to the griller; the remaining slices have a clear just-in-time intake path;
and **no code has been written by the kicker**.

## The roadmap rule

The roadmap is a **map of milestones**, not a to-do list and never a growing
monolithic spec. `FEATURE_INTAKE.md` warns against creating or extending a
monolithic spec after intake; `docs/decisions/0010-…` records why. If the
roadmap starts behaving like a work tracker, stop and shrink it.

## The grill-vs-record guard

The grill (step 2) **understands** the requirement. It does not classify or
record per-feature work. Per-slice classification and recording is the
`harness-intake-griller`'s job, done just-in-time as each slice starts
(ADR-0010, extended by ADR-0012). If the grill starts producing intake rows
for individual features, it has drifted into the monolithic-spec anti-pattern —
stop and keep it at the requirement tier.

## Worked example (the shape a run produces)

Input (deliberately **fuzzy**, the kind that exposes the gap): *"I want the pi
agent to really know about repository-harness — detect it, install it, show me
what's going on, maybe a timeline, all behind one command."*

- **Step 1** — this is a product area, not one behaviour → continue. Obvious
  risk flags: none at a glance (revisit in step 2).
- **Step 2** — grill (`GRILL-FORMAT.md`):
  - Shape: ~4 independent areas — detection, install, visualization, timeline.
  - Tracer-bullet: detect installed harness at session_start, show a footer
    (detect → footer → test).
  - Scope: in = detect/install/visualize; out = authoring harness policy,
    mobile shell. Timeline = phase 2.
  - Fuzz: "really know" → session-aware live state; "what's going on" →
    matrix/stats/backlog; "maybe timeline" → optional, deferred.
  - Risk surface: touches durable layer reads (no writes) — no hard gate;
    public contracts? only if the command becomes a documented API (defer).
- **Step 3** — one intake, summary sourced from the grill:
  `intake --type new_initiative --lane normal --summary "Four-area initiative:
  detect, install, visualize, timeline… tracer-bullet = detect+footer…"` → id #N.
- **Step 4** — roadmap names milestones only: *detect*, *install wizard*,
  *dashboard*, *timeline (phase 2)*. Open question: installer source pinning.
- **Step 5** — slices (one-line contracts, from `KICK-FORMAT.md`):
  - *US-NNN — detect at session_start, surface in footer (end-to-end: detect →
    footer → test).*
  - *US-NNN — install wizard: one command onboards (detect-absent → run
    installer → init db → shim).*
  - *US-NNN — dashboard: proof-matrix tab from query matrix.*
  - … Quiz the user → approve.
- **Step 6** — N `planned` stories under intake #N; the loop is described;
  hand the **first tracer-bullet** (detect+footer) to the griller now to
  validate the decomposition; the rest intaken just-in-time. **Stop. No code
  written by the kicker.**

The real validation is the next genuine project kickoff — this example only
fixes the expected shape.

## Related

- `skills/harness-intake-griller/SKILL.md` — per-slice classifier (the loop target)
- `GRILL-FORMAT.md` — requirement-level interview reference (step 2)
- `KICK-FORMAT.md` — decomposition heuristics (step 5)
- `docs/FEATURE_INTAKE.md` — input types (`new_initiative`, `spec_slice`), lanes
- `docs/CONTEXT_RULES.md` — token budget per lane, the "keep story current" resume rule
- `docs/decisions/0010-initiative-slices-workflow-model.md` — the workflow model this skill codifies
- `docs/decisions/0012-kicker-grills-requirement-before-intake.md` — extends 0010: grill before umbrella, drive the loop
