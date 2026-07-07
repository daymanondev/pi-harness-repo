# US-027 Dashboard Backlog Triage Keys: Close / Promote-to-Grill / Reframe (Part B/D)

## Status

planned

## Lane

normal

## Product Contract

On the backlog tab, advisory keys offer close (`c`), promote-to-story/grill
(`p`), and reframe (`e`) as commands/prompts the operator runs — turning the
backlog from a read-only list into a triage surface. Advisory only (reuses the
US-023 nextActionFor pattern).

> Planned stub — NOT yet grilled. No `spec_slice` intake links this story yet,
> so it appears as `○` (ungrilled) in the grill queue. Grill via
> `harness-intake-griller` before implementing.

## Acceptance Criteria

(to be defined at grill time)

## Validation

- `npx tsx tests/p4.test.ts && npx tsc --noEmit` (expected).

## Relevant Product Docs

- `extensions/harness/dashboard.ts` (backlog tab), `docs/stories/US-023-*.md`
- `scripts/bin/harness-cli backlog --help`

## Evidence

(none — planned, not yet grilled)
