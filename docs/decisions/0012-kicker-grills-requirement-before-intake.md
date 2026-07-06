# 0012 Kicker grills the requirement before the umbrella intake

Date: 2026-07-06

## Status

Accepted. Partially supersedes [0010](./0010-initiative-slices-workflow-model.md)
in one respect only: 0010 described the workflow model as *decompose then
hand off slice 1*. This decision inserts a **requirement-grilling phase before
the umbrella intake** and turns the hand-off into a **driven per-slice loop**.
0010's core rules — one umbrella intake, DESIGN is a roadmap not a tracker,
decompose before coding, no "intake everything upfront" — stand unchanged.

## Context

`harness-project-kicker` (built as US-007..US-009 under intake #9) was meant to
codify ADR-0010 so decomposition is not skipped under session pressure. It
achieved that, but a field review (intake #16 / US-013) exposed two residual
gaps that 0010 did not address:

1. **No requirement-grilling phase.** The kicker's first step asks one binary
   question ("one behaviour or an initiative?") and immediately records the
   umbrella `new_initiative` intake from a summary **the agent writes itself**.
   The whole interviewing value of `harness-intake-griller` (one question at a
   time, recommend-then-confirm, stress-test each risk flag with a concrete
   scenario) is absent at the phase where it matters most — kickoff, when the
   requirement is largest and fuzziest. The roadmap and slices are then the
   agent's unverified guess. The original monolithic `pi-harness-design/DESIGN.md`
   was the symptom: a fuzzy requirement was decomposed without first being
   understood.
2. **The hand-off abandons slice 2..N.** The kicker records planned stories for
   every slice but hands **only the first** to the griller and explicitly stops
   ("the kicker does not start the second slice"). Per 0010 each slice is
   intaken just-in-time, but the kicker never sets up or drives that loop, so
   slices 2..N become planned orphans with no intake, no packet, and no driver.
   Live evidence: `harness-cli audit` reports US-011 and US-012 as orphaned
   stories (planned, no traces).

A further framing error: the kicker's **leading word is "slice"** ("is this one
slice or many?"). At kickoff the first job is not to slice — it is to
**understand the requirement**. Slicing comes after understanding.

## Decision

Extend the kicker's workflow model in two ways. Both are mandatory behaviour
for the skill:

1. **Grill the requirement before the umbrella intake.** The kicker's first
   step is a relentless requirement-level interview (one question at a time,
   recommend-then-confirm, grounded in live durable state), resolving:
   - one behaviour or an initiative, and (if an initiative) roughly how many
     features / independent product areas;
   - the core value / tracer-bullet — the thinnest end-to-end path that proves
     the idea;
   - in-scope vs out-of-scope;
   - what is fuzzy or ambiguous in the requirement;
   - which of the 10 risk flags touch the requirement **anywhere** (early lane
     signal, not a per-slice classification).

   Only after the requirement is sharpened does the kicker record the umbrella
   `new_initiative` intake — and that intake's summary is **sourced from the
   grill output**, not the agent's first guess. A companion
   `GRILL-FORMAT.md` holds the interview reference (progressive disclosure,
   parallel to `harness-intake-griller/INTAKE-FORMAT.md`).

2. **Drive the per-slice intake loop; do not abandon slice 2..N.** The final
   step no longer hands slice 1 to the griller and stops. It sets up and
   describes the driven loop explicitly:

   ```text
   slice N  -> harness-intake-griller (intake spec_slice + packet)
            -> execute
            -> trace
            -> slice N+1
   ```

   The kicker may intake the **first 1–2 tracer-bullet slices** at kickoff to
   validate the decomposition; the rest stay **just-in-time** (each intaken by
   the griller when it starts). This is **not** "intake every feature upfront" —
   that remains the monolithic-spec anti-pattern 0010 rejects. The grill
   *understands*; the per-slice griller *records*, on demand.

3. **Leading word is "requirement", not "slice".** The first question the
   kicker asks is about understanding the requirement, not about slicing it.
   Slicing is a later step, applied to a sharpened requirement.

## Alternatives Considered

1. **Intake every feature upfront at kickoff.** Rejected: this is the
   monolithic-spec anti-pattern 0010 explicitly prohibits, and it prevents
   just-in-time correction as each slice lands. Grilling is about
   *understanding*, which is compatible with just-in-time *recording*.
2. **Update 0010 in place.** Rejected: 0010 records the historical context
   that produced the `DESIGN.md` monolith (the phase-as-US pattern, the
   US-004→US-005 cleanup tail). A partial-supersede preserves that context
   while recording the model extension.
3. **Leave the kicker as-is; rely on the griller per-slice.** Rejected: the
   griller runs at slice granularity, so it can never recover a misshapen
   umbrella or a wrong decomposition it inherits. Understanding must happen
   before the umbrella is recorded, not after.

## Consequences

Positive:

- The umbrella intake summary is verified, not guessed.
- Roadmap and slices decompose a sharpened requirement, reducing oversized
  slices and context-budget blowups (the original 0010 symptoms).
- No slice is abandoned at kickoff; the per-slice loop is driven, closing the
  orphaned-story pattern (`audit`'s US-011/US-012 class).
- The kicker now mirrors the griller's interviewing discipline, raised to
  requirement scope — consistent collaboration style across intake tiers.

Tradeoffs:

- Kickoff takes longer: a real interview replaces a one-line triage. This is
  the intended cost — a fuzzy requirement is exactly where time spent
  understanding pays back across every downstream slice.
- One more companion doc (`GRILL-FORMAT.md`) to maintain alongside
  `KICK-FORMAT.md`.
- The grill must stay disciplined about scope: it understands, it does not
  record every feature. Drift toward "intake everything upfront" would
  re-introduce the monolithic-spec anti-pattern.

## Follow-Up

- US-013 implements this decision: rewrites `skills/harness-project-kicker/SKILL.md`
  (grill phase, verified umbrella, driven loop, corrected leading word, fuzzy
  worked example), adds `GRILL-FORMAT.md`, and records this decision.
- The real validation is the next genuine project kickoff (inherited caveat
  from US-009 / 0010): a skill's behaviour cannot be fully proven by an
  automated run, only by a real fuzzy requirement passing through it.
