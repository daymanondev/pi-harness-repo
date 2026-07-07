# US-026 Dashboard /harness next + Grill-Queue Badge (Part D Automation)

## Status

planned

## Lane

normal

## Product Contract

One keystroke (e.g. `n`) jumps to the single next action — the highest-priority
ungrilled-or-unimplemented story — and a badge counts planned-but-ungrilled
stories (the grill queue, derived from the US-023 intake-linkage signal). Kills
the "always type 'check AGENTS.md and find something to do'" pain.

> Planned stub — NOT yet grilled. No `spec_slice` intake links this story yet,
> so it appears as `○` (ungrilled) in the grill queue. Grill via
> `harness-intake-griller` before implementing.

## Acceptance Criteria

(to be defined at grill time)

## Validation

- `npx tsx tests/p4.test.ts && npx tsc --noEmit` (expected).

## Relevant Product Docs

- `extensions/harness/index.ts` (footer next-action, US-018),
  `docs/stories/US-023-*.md` (grilled signal)

## Evidence

(none — planned, not yet grilled)
