# 0010 Workflow model — initiative + vertical slices, DESIGN as roadmap

> Partially superseded by [ADR-0015](./0015-realign-grill-to-clarification.md) (2026-07-08): the per-slice `spec_slice` grill gate and the "grilled" badge. Substance retained — one umbrella `new_initiative` intake, DESIGN-as-roadmap, decompose-before-coding, just-in-time classification, no "intake everything upfront".

Date: 2026-07-06

## Status

Accepted

## Context

pi-harness was built from a single `pi-harness-design/DESIGN.md` document that
doubled as the **work tracker**: its delivery-phase table (§11, P1–P7) was
treated as a one-to-one story list, so each phase became exactly one US. Three
symptoms followed:

1. **Oversized stories.** US-004 (P2) bundled five independent gates + drift
   detection + session state + tests into one story. The `docs/FEATURE_INTAKE.md`
   Normal lane requires "the **smallest vertical slice**"; a whole phase is not
   a slice. The follow-up "Harden P2" story (US-005) was a classic cleanup tail
   caused by an oversized predecessor.
2. **Context-budget blowups.** `docs/CONTEXT_RULES.md` budgets the Normal lane
   at ~5K tokens of harness context. Phase-sized stories blew that repeatedly,
   forcing emergency compacts mid-work.
3. **A reinvented handoff ritual.** Because phase-sized stories could only be
   updated when fully done, "resume after compact" became a ceremony: record an
   intake + create a story right before compacting. But `CONTEXT_RULES.md`
   already defines the resume mechanism — "spans multiple iterations → keep a
   story/progress file current" — so the ceremony was a symptom, not a need.

A further classification error: each phase was intaken as `spec_slice`, but
pi-harness as a whole is a `new_initiative` ("a larger product area that needs
multiple stories"). `FEATURE_INTAKE.md` also warns: "Do not create or extend a
monolithic spec by default after intake."

## Decision

Adopt the harness-native workflow model for this and future initiatives:

1. **One umbrella intake.** A new project is classified as `new_initiative`
   (one intake) — not a sequence of per-phase `spec_slice` intakes. The
   umbrella covers the whole product area; individual slices are intaken as
   `spec_slice` only as each is started.
2. **DESIGN is a roadmap, not a tracker.** `pi-harness-design/DESIGN.md` is
   reference (architecture, API research, ADRs). The §11 phase table is a
   roadmap of milestones. The **living work surface** is initiative notes +
   stories + decisions — never the phase table and never a growing monolithic
   spec.
3. **Decompose before coding.** Each phase is split into 2–5 small
   vertical-slice stories **before** implementation begins. A slice is one
   independently-shippable behavior that fits the lane's token budget.
4. **The current story IS the resume state.** Keep the active story/progress
   file current as work proceeds; this satisfies the CONTEXT_RULES multi-
   iteration retrieval trigger. Compact whenever needed — there is no separate
   "pre-compact handoff" step.

## Alternatives Considered

- **Intake everything upfront, then execute.** Rejected: this is the monolithic
  spec anti-pattern that `FEATURE_INTAKE.md` explicitly prohibits, and it
  prevents just-in-time correction as each slice lands.
- **Keep phase = US.** Rejected: produces oversized stories, budget blowups,
  and cleanup tails (the US-004 → US-005 pattern).
- **Per-phase `spec_slice` intake only.** Rejected: loses the umbrella
  initiative classification and the single "why" that ties the slices together.

## Consequences

Positive:

- Each slice fits the ~5K-token Normal budget; compacts become ad-hoc rather
  than emergency.
- The griller skill applies per-slice (its designed granularity).
- The pre-compact handoff ritual disappears — the current story file is the
  resume anchor by construction.

Tradeoffs:

- More intake/story rows in the durable layer (one umbrella + several slices
  per phase). This is the intended granularity, not noise.
- Requires discipline to decompose before coding; a future `harness-project-
  kicker` skill (US-007..US-009) will codify this so the decomposition is not
  skipped under session pressure.

## Follow-Up

- `harness-project-kicker` skill: takes a raw requirement → records the
  `new_initiative` intake → writes a roadmap (not a spec) → decomposes into
  small slices → hands the first slice to the griller. Built as US-007..US-009.
- Re-baseline remaining phases (P3 onward) as decomposed slice lists, not
  single US each. US-006 (P3) stays as the umbrella story for P3 and will be
  decomposed when P3 starts.
