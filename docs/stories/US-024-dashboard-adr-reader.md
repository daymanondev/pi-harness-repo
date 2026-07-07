# US-024 Dashboard ADR Reader: Render decisions/*.md Body + Verify Age (Part C)

## Status

planned

## Lane

normal

## Product Contract

A decisions view in the dashboard reads `docs/decisions/NNNN-*.md`, renders the
title/status/context/decision sections, shows `last_verified_at` age, and offers
re-verify as advisory text. Solves the "cannot view ADR" gap (Part C):
`query decisions` returns only metadata; the ADR body lives in the markdown
files, so the dashboard reads them directly (no Rust change needed).

> Planned stub — NOT yet grilled. No `spec_slice` intake links this story yet,
> so it appears as `○` (ungrilled) in the grill queue. Grill via
> `harness-intake-griller` before implementing.

## Acceptance Criteria

(to be defined at grill time)

## Validation

- `npx tsx tests/p4.test.ts && npx tsc --noEmit` (expected).

## Relevant Product Docs

- `docs/decisions/*.md` (ADR bodies), `query decisions` (metadata index)
- `extensions/harness/dashboard.ts`, `docs/stories/US-023-*.md` (advisory pattern)

## Evidence

(none — planned, not yet grilled)
