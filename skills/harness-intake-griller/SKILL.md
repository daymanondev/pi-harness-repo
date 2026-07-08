---
name: harness-intake-griller
description: On-demand clarification interview for a single story or slice that is ambiguous. Explores the repo, asks one question at a time, recommends-then-confirms, and sharpens understanding so the automatic intake classification can proceed. Use when a story is unclear, has UI or behavior questions, or its acceptance is fuzzy — not as a mandatory per-slice intake gate.
---

> **Which skill?** This **clarifies one story/slice** when it is ambiguous. To
> **shape a whole new initiative** before any slice exists, use
> [`harness-project-kicker`](../harness-project-kicker/SKILL.md) (its *sharpen*
> phase). See `docs/GLOSSARY.md` for the grill/sharpen distinction. The intake
> *classification* itself is automatic per `docs/FEATURE_INTAKE.md` ("the
> harness does") — this skill feeds it understanding; it is **not** a gate.

<what-to-do>

Clarify an ambiguous story/slice with **minimum ceremony**. The harness
classifies risk automatically; you supply understanding, resolving only genuine
ambiguities.

### 1. Decide whether to grill at all

Grill **only** when the story is genuinely ambiguous — you can't tell what
behavior to build, the acceptance is fuzzy, or there are open UI/behavior
questions. If it is clear (a kicker one-line contract, or an obvious change),
**skip the grill** and let automatic classification proceed — grilling a clear
story is ceremony that redirects scope (the anti-pattern this rework removes;
initiative #44 / ADR-0015).

### 2. Explore before you ask (ground in live state)

Before asking anything, read the repo:

- `scripts/bin/harness-cli query matrix` — proof status of related stories.
- `scripts/bin/harness-cli query intakes` and `query sql` — what is already
  classified around this area (and its `parent_intake_id` initiative, if any).
- `rg` the codebase and `docs/product/*` — the affected surface.

### 3. One question at a time; recommend, then confirm

Ask **one** focused question at a time. For each, **recommend** an answer
grounded in what you found, then let the operator confirm or correct — never an
open-ended interrogation. A question is genuine only if it is **not derivable
from state** AND **material** (it changes what behavior gets built, the
acceptance, or the risk surface). Immaterial questions (naming, style) are
deferred to implementation. Target ~1–2 genuine questions; zero is normal.

### 4. Sharpen the sketch

Distill the clarified understanding into a tight behavior sketch:

- **Tracer-bullet** — the thinnest end-to-end path this story delivers (one
  sentence) and the demo it shows.
- **In / out of scope** — one line each.
- **Resolved ambiguities** — the forks you closed and the chosen resolution.

If the story came from `harness-project-kicker`, a one-line contract already
exists — refine it, do **not** redo the requirement-level sharpen (that happened
at the kicker, per ADR-0012).

### 5. Hand off to the automatic classification

The grill's output is **understanding**, not a durable row. The intake
classification (input type, flags, lane, story shape, validation) is
**automatic** per `docs/FEATURE_INTAKE.md` — the harness does it, informed by
your sharpened sketch. You do **not** gate implementation on a per-slice
`spec_slice` intake; recording an intake is the harness's normal per-work-item
step, not a grill ceremony. See [INTAKE-FORMAT.md](./INTAKE-FORMAT.md).

If the clarified work is actually a **whole new initiative** (not one slice),
redirect to `harness-project-kicker`.
</what-to-do>

<supporting-info>

## When NOT to use this skill

- The story is clear — let automatic classification proceed; do not grill.
- The repo lacks `repository-harness` (run `/harness` or `harness-cli init`
  first); an unmeasured repo produces nothing enforceable.
- The request is a whole new initiative — redirect to
  `harness-project-kicker` (requirement-level *sharpen*).
- The user says "just do it" — respect it; classification still records an
  intake, but no grill.

## Domain awareness

`docs/FEATURE_INTAKE.md` is authoritative for input types, lanes, the 10 risk
flags, and hard gates; this skill owns only the *clarification procedure*. On
disagreement, surface friction (`harness-cli backlog add`) and defer to
FEATURE_INTAKE.

## What changed (initiative #44)

Was a per-slice `spec_slice` intake gate with a "grilled ●/○" badge — drift
from upstream (no grill concept) and an immutability trap (`intake` is
record-only; `story update` lacks `--lane`). Now: on-demand clarification;
classification is automatic + append-only (a later change = a new
`change_request` intake, never an amend). See ADR-0015.
</supporting-info>
