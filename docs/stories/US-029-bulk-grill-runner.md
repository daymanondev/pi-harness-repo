# US-029 Bulk-Grill Runner: Grill the Entire Planned Queue in One Pass

## Status

planned

## Lane

normal

## Product Contract

A runner that iterates every **planned-but-ungrilled** story and grills it:
runs `harness-intake-griller` classification on each → records a `spec_slice`
intake linked to the story + fills its packet (acceptance criteria, design
notes, validation). After the run the entire planned queue is grilled (`●`) and
ready for the overnight auto-pilot (US-030). This is the **prep phase** of the
grill-all-then-auto-overnight pipeline.

Headless: the runner computes `isGrilled` inline (SQL) — no dashboard
dependency (US-023 is a separate, polish surface).

> Planned stub — NOT yet grilled. No `spec_slice` intake links this story yet,
> so it appears as `○` (ungrilled) in the grill queue.

## Acceptance Criteria

(to be defined at grill time)

## Validation

- (tbd at grill time)

## Relevant Product Docs

- `skills/harness-intake-griller/SKILL.md`, `docs/stories/US-023-*.md` (isGrilled)
- `docs/FEATURE_INTAKE.md` (spec_slice classification)

## Evidence

(none — planned, not yet grilled)
