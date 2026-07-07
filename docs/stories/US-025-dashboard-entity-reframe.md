# US-025 Dashboard Entity Reframe: Story/Backlog Work Surface; Intake/Trace/Decision as Provenance (Part B)

## Status

planned

## Lane

normal

## Product Contract

Tier the dashboard so story + backlog are the primary actionable work surfaces,
while intake / trace / decision appear as **provenance & evidence** inside story
detail (a story shows its linked intake + traces; an ADR shows the stories it
constrained) — not as top-level peers. Addresses "only story and backlog feel
meaningful" (Part B): the other entities were mis-tiered, not useless.

> Planned stub — NOT yet grilled. No `spec_slice` intake links this story yet,
> so it appears as `○` (ungrilled) in the grill queue. Grill via
> `harness-intake-griller` before implementing.

## Acceptance Criteria

(to be defined at grill time)

## Validation

- `npx tsx tests/p4.test.ts && npx tsc --noEmit` (expected).

## Relevant Product Docs

- `extensions/harness/dashboard.ts` (tab structure), `docs/stories/US-023-*.md`
- `docs/HARNESS.md` (entity model), `docs/FEATURE_INTAKE.md`

## Evidence

(none — planned, not yet grilled)
