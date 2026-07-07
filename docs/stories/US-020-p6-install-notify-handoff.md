# US-020 P6 — install-notify hands off to the next requirement

## Status

planned

## Lane

tiny

## Product Contract

On successful install, the notify hands off to the **next** requirement
("DB ready — next: record an intake before editing") instead of the bare
"installed — footer is live ✓". This closes the exact post-init transition that
caused the original "the gate seems ineffective" confusion.

Umbrella intake: **#23**. Roadmap: `docs/initiatives/P6-status-action.md` (M3).
**blocked-by:** US-018 (consumes `readiness()`).

## Relevant Product Docs

- `docs/initiatives/P6-status-action.md` — M3
- `extensions/harness/index.ts` — `handleHarnessCommand` install-success notify
  (~631) + `runInstallPlan` (339–381)
- `extensions/harness/gates.ts` — `readiness()` (delivered by US-018)

## Acceptance Criteria

- After a successful install, the notify text names the next required action
  (record an intake), sourced from `readiness()` — not a bare "installed ✓".
- Failure path unchanged (per-step error notify preserved).

## Design Notes

- This is the single highest-leverage touch for the reported confusion: the
  moment the requirement *shifts* from "init DB" to "record an intake", the
  surface must say so.
- Consumes the `readiness()` contract from US-018 (hence blocked-by).

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | notify text branches on `readiness().firstUnmet` |
| Integration | 0 |
| E2E | 0 |
| Platform | 0 |
| Release | 0 |

## Harness Delta

None (presentation only).

## Evidence

(pending implementation)
