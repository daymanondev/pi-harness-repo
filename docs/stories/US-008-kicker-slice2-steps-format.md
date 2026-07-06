# US-008 kicker slice 2 — steps + completion criteria + KICK-FORMAT.md

## Status

implemented

## Lane

normal

## Product Contract

Second slice of `harness-project-kicker` (umbrella intake #9). Fill the SKILL.md
step bodies with ordered steps + checkable completion criteria (the key one:
"slice list exists AND no coding has started" — defends against premature
completion). Push decomposition heuristics into a companion `KICK-FORMAT.md`
(progressive disclosure), mirroring how the griller uses INTAKE-FORMAT.md.

## Evidence

- Filled the 5 step bodies in `skills/harness-project-kicker/SKILL.md` with
  ordered actions, each ending on a checkable completion criterion:
  1. Size the input — classify one-behavior (→ redirect to griller) vs
     initiative (→ continue); never both.
  2. Record the umbrella intake — exactly one `new_initiative` intake, id
     captured; no per-slice intake from the kicker.
  3. Write the roadmap (not a spec) — milestones only, no tasks/acceptance
     criteria; governed by the roadmap rule.
  4. Decompose into slices — tracer-bullet vertical cuts, one-line contracts +
     blocked-by; quiz the user on granularity/dependencies/merge-split.
  5. Sequence and hand off — create planned story rows under the umbrella
     intake, hand only the first slice to the griller, **write no code**.
- Created `skills/harness-project-kicker/KICK-FORMAT.md` (progressive
  disclosure): slice definition, horizontal-slab anti-patterns, the 3-part size
  test (demoable / within lane budget / one contract), the one-line contract
  shape, dependency handling, and the 3-question quiz. SKILL.md loads it only at
  step 4.
- The premature-completion defence lives in step 5's criterion: "no code has
  been written by the kicker".
- Markdown lint clean on both files.
