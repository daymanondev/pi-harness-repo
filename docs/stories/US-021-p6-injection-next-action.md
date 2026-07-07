# US-021 P6 — injection leads with next-action, drops vanity counts

## Status

implemented

## Lane

tiny

## Product Contract

The `before_agent_start` injection message stops leading with vanity counts
(`20 intakes · 17 stories …`); it leads with the next-required-action and keeps
only actionable nags. This is the surface the agent itself reads each turn.

Umbrella intake: **#23**. Roadmap: `docs/initiatives/P6-status-action.md` (M4).
**blocked-by:** US-018 (consumes `readiness()`). Resolves OQ-2.

## Relevant Product Docs

- `docs/initiatives/P6-status-action.md` — M4 + OQ-2 (injection vs footer
  ownership of next-action)
- `extensions/harness/index.ts` — `injectionMessage` (197–227)
- `extensions/harness/gates.ts` — `readiness()` (delivered by US-018)

## Acceptance Criteria

- The injection no longer leads with `intakes · stories · traces …` counts.
- It leads with the next-required-action from `readiness()`.
- OQ-2 resolved: decide whether injection keeps its own next-action line, stays
  quiet, or keeps only the trace nag, now that the footer owns next-action.

## Design Notes

- The counts were the exact "junk" the user objected to; they belong in the
  dashboard, not the per-turn injection.
- Consumes the `readiness()` contract from US-018 (hence blocked-by).

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | `injectionMessage` leads with `readiness().nextAction`; no count lead |
| Integration | 0 |
| E2E | 0 |
| Platform | 0 |
| Release | 0 |

## Harness Delta

None (presentation only).

## Evidence

`injectionMessage(state, session, drift)` exported from index.ts — leads with
`[harness] next: <nextAction>.` from `readiness()`, drops the vanity-counts
`durable layer: N intakes · stories · traces…` line entirely, keeps the
actionable drift + trace nags, and returns `""` (quiet) when not set up or
fully ready. **OQ-2 resolved:** the injection is the agent-facing per-turn
surface, so it owns its own next-action line (the footer owns the human-facing
one); counts belong in the dashboard Stats tab. Call site index.ts:~960 now
passes `session`. p6 tests: 6 incl a regression sweep asserting no
`[harness] durable layer:` lead across all session×drift permutations. tsc
clean; p2 44 p3 33 p4 58 p5 34 p6 34; lens 0.
