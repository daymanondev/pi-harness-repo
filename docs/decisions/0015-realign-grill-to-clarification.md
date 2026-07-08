# 0015 Realign grill to clarification; supersede the per-slice grill gate

Date: 2026-07-08

## Status

Accepted. Partially supersedes [0010](./0010-initiative-slices-workflow-model.md)
(the per-slice `spec_slice` grill-gate semantics) and
[0012](./0012-kicker-grills-requirement-before-intake.md) (the "grill" naming of
the requirement-understanding phase). The substance of both — one umbrella
`new_initiative` intake, just-in-time decomposition, and understanding the
requirement before the umbrella is recorded — is retained; only the mandatory
per-slice grill ceremony, the immutable "grilled" badge, and the grill-phase
naming change.

## Context

`harness-intake-griller`, `harness-project-kicker`, and the US-023 "grilled
badge" are **pi-harness additions**. They do not exist in upstream
`hoangnb24/repository-harness`: none of the upstream
`README`/`HARNESS`/`FEATURE_INTAKE`/`ARCHITECTURE` docs nor the `scripts/schema`
migrations mention grill, kicker, or a grilled badge (verified 2026-07-08).
Upstream's model is:

- **Intake** = classify one work item, automatically — `FEATURE_INTAKE.md`:
  *"The human does not need to classify risk. The harness does."*
- **Initiative** = **notes + candidate stories**, not a parent story and not a
  two-tier intake ceremony — `HARNESS.md`: *"Large product areas should use
  scoped initiative notes."*
- **Evolution** = a **new** `change_request` intake (append), never an amend.
  `FEATURE_INTAKE.md`: *"Do not create or extend a monolithic spec by default
  after intake."*

Upstream's loop has no grill step: classify → story/initiative notes →
validation → implement → trace.

The drift created a concrete **immutability / re-intake trap**. ADR-0010 turned
each slice's classification into a mandatory `spec_slice` intake ("the act of
grilling *is* recording the `spec_slice` intake"), and US-023 made a binary
"grilled ●/○" badge out of it. But `intake` is record-only (no update/delete)
and `story update` has no `--lane`/`--title`/`--flags`. So a slice has **two
immutable lane values** — the kicker's provisional `story.risk_lane` and the
griller's confirmed `intake.risk_lane` — that can diverge and never be
reconciled. When a slice evolves (scope grows, a change_request lands), its
one-time classification goes stale and there is no path to re-intake. The grill
ceremony, not the immutability itself, is the root cause: upstream never grills
slices, so it never needs to re-grill them — it simply appends a new
`change_request` intake.

The upstream sync was verified on 2026-07-08:
`docs/{HARNESS,FEATURE_INTAKE,ARCHITECTURE,CONTEXT_RULES,TOOL_REGISTRY,IMPROVEMENT_PROTOCOL,TRACE_SPEC}.md`
are **byte-identical** to upstream `main`; `scripts/schema/001..008` match
upstream. Only `README.md` differs, which is our pi-harness product surface, not
drift. Core is current.

## Decision

Realign the griller/kicker/dashboard layer to upstream theory:

1. **Grill is an on-demand clarification tool, not a per-slice intake gate.**
   `harness-intake-griller` is used when a story or intent is ambiguous (the
   agent does not understand a story, has UI questions, unclear acceptance). It
   is a one-question-at-a-time, repository-grounded interview that *sharpens
   understanding*. It is **not** a mandatory ceremony and does not gate
   implementation. (US-034.)
2. **Intake classification is automatic, one per work item, append-only.**
   Per `FEATURE_INTAKE.md`, the harness classifies each work item when it is
   worked. Evolution is a **new** `change_request` intake (a fresh event), never
   an amend. There is no "re-intake" concept — changes append. (Substance of
   ADR-0010's per-slice intake is retained as *just-in-time classification*;
   the mandatory *grill* gate around it is dropped.)
3. **Initiative = `new_initiative` intake + notes + candidate stories.**
   ADR-0010's substance is retained: one umbrella intake, decompose before
   coding, the current story is the resume state. The initiative is the intake
   plus `docs/initiatives/NNNN-*.md` notes — not a parent story.
4. **"grilled" badge → "classified".** A story is **classified** when **any**
   intake links it (not only `spec_slice`). Classified → ready to implement;
   unclassified → classify (record an intake; use the grill only if unclear).
   The stale one-time "grilled" signal is gone: classification is the latest
   linked intake, and changes append new intakes. (US-036.)
5. **`story.parent_intake_id` is the durable slice→initiative link.** Migration
   `009-story-parent-intake.sql` adds an additive, nullable
   `parent_intake_id INTEGER REFERENCES intake(id)` so the dashboard can render
   an initiative → slices hierarchy in one hop, without inventing a parent
   "initiative story" (upstream keeps initiatives as intake + notes). The
   prebuilt CLI (ADR-0005) has no command for the column, so it is read/written
   through `harness-cli query sql` (verified write-capable). (US-033.)
6. **Kicker's "grill phase" is renamed "sharpen".** ADR-0012's substance —
   understand the requirement before recording the umbrella intake — is
   retained. Only the name changes: the requirement-understanding phase is
   "sharpen" (GLOSSARY), reserving "grill" for the slice/story clarification
   tool. (US-035.)

## Supersedes

- **ADR-0010** — the per-slice `spec_slice` grill-gate semantics ("individual
  slices are intaken as `spec_slice` only as each is started" *as a grill*; the
  grilled badge as the readiness signal). Retained: one umbrella `new_initiative`
  intake, DESIGN-as-roadmap, decompose-before-coding, just-in-time
  classification, no "intake everything upfront".
- **ADR-0012** — the "grill" naming of the requirement-understanding phase and
  the `GRILL-FORMAT.md` companion. Retained: understand-before-intake, the
  driven per-slice loop, leading word "requirement". Renamed: the phase and its
  format doc are "sharpen".

## Alternatives Considered

1. **Keep the per-slice grill; add an `intake update`/amend command.** Rejected.
   Amend would muddy the immutable event log (intake is a classification
   *event*; the current state should be derivable from the latest event, not by
   rewriting history). More fundamentally, the grill ceremony itself is the
   problem — it turned automatic classification into a mandatory manual gate and
   invented a stale one-time badge. Fixing the immutability alone would leave
   the gate.
2. **Model the initiative as a parent story via `story_hierarchy` (migration
   008).** Rejected. Upstream theory says an initiative is notes + candidate
   stories, not a story; `story_hierarchy` is upstream-sanctioned for
   story→story grouping but repurposing it as initiative→slices would invent a
   parent "initiative story" that upstream deliberately avoids. `parent_intake_id`
   links the slice directly to the initiative *intake* (1-hop) and matches the
   mental model that the initiative *is* the `new_initiative` intake.
3. **Drop the grill entirely.** Rejected. Clarification has genuine value when a
   story is unclear or has open UI/acceptance questions; it just should not be a
   mandatory gate or the readiness signal. Keeping it as a lightweight on-demand
   tool preserves that value without the drift.

## Consequences

Positive:

- The grill is lighter: on-demand clarification, no per-slice ceremony.
- The immutability / re-intake trap dissolves by construction — changes append a
  new `change_request` intake; the current classification is the latest linked
  intake; nothing needs amending.
- The dashboard signal is honest: "classified" (any intake) reflects the latest
  state, not a stale one-time flag.
- One additive, nullable column (`parent_intake_id`) gives the dashboard an
  initiative → slices view without a parent-story invention.
- Naming is unambiguous: "sharpen" (requirement, kicker) vs "grill"
  (clarification, per-story).

Tradeoffs:

- The dashboard (US-036) and both skills (US-034, US-035) are reworked; ADR-0010
  and ADR-0012 are annotated (not rewritten, to preserve their historical
  context).
- `parent_intake_id` is read/written via `query sql` because the prebuilt CLI
  has no command for it (ADR-0005). This is a documented, bounded deviation from
  "use the binary"; it is the same channel `story_hierarchy` already requires
  (no CLI command exists for it either).
- Existing durable rows that relied on the "grilled" semantics (a `spec_slice`
  intake linked to a story) remain valid: they are now "classified" stories, a
  strict superset.

## Follow-Up

- US-033 — `parent_intake_id` migration 009 + `query sql` wiring.
- US-034 — rework `harness-intake-griller` into a clarification tool.
- US-035 — rework `harness-project-kicker`; rename grill phase → sharpen.
- US-036 — dashboard: classified/ready badge + initiative→slices hierarchy.
- US-038 — settings + skill audit (ensure both skills still resolve and run).
