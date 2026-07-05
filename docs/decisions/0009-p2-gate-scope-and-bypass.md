# 0009 P2 Enforcement Gate Scope + Bypass UX

Date: 2026-07-05

## Status

Accepted

## Context

P2 (`US-004`) wires repository-harness's Task Loop into runtime rails via pi's
blockable `tool_call` event. `pi-harness-design/DESIGN.md` §13 left two
questions open until P2 shipped:

- **§13.5 — Bypass UX.** Hard-block (agent cannot proceed until `intake`
  lands) or soft-block (block with a `/harness` override the user can dismiss)?
- **§13.6 — Enforcement scope.** Gate `write`/`edit` only, or also `bash`
  commands that mutate the repo (`git commit`, `npm install`)?

The field evidence motivating P2 (an agent read every doc, ran `query matrix`,
initialized the db, then wrote code with **zero** intake) was specifically a
**code-writing** failure, not a bash-mutation failure.

## Decision

**§13.5 — Hard-block, with no `/harness` bypass in P2.** Reads (`read`,
`grep`, `glob`, `ls`, ...) and all `harness-cli` calls are never intercepted,
so the agent is never trapped away from investigating. The only way past Gate
A is to record an intake — which is exactly the behaviour the gate exists to
enforce. The `/harness` override is a P3 concern (the overlay does not exist
yet); if a soft-block is needed, it can be added when `/harness` lands without
changing the decision shape.

**§13.6 — Narrow scope.** Gate A intercepts `write` and `edit` only. `bash` is
exempt from Gate A. Rationale:

1. The actual failure mode (writing code without intake) is caught by
   `write`/`edit`.
2. Classifying "mutating bash" reliably is fragile — `echo > file`,
   `sed -i`, `git commit`, `npm install`, `pip install`, heredocs, pipes — so a
   bash classifier would either over-block (trapping the agent on legitimate
   builds) or under-block (missing creative mutation). Either is worse than
   not gating bash.
3. Gate C still nags on failed `bash`, so friction in bash is still captured.

Gate B′ (drift) and Gate A′ (precondition) are hard-blocks by construction and
unaffected by this decision.

## Alternatives Considered

1. **Broad scope (gate `bash` too).** Rejected: fragile classification + over-
   blocking risk (see above). Remains a future option if field evidence shows
   agents bypassing via bash.
2. **Soft-block with `/harness` override.** Rejected for P2: `/harness` is P3.
   Adding the override later is additive and does not revisit this decision.
3. **Grace-period soft-block** (block, then auto-clear after N turns).
   Rejected: defeats the purpose; the agent learns to wait.

## Consequences

Positive:

- Gates fail OPEN on detection errors (a false block would trap the agent);
  only a clean "harness repo + no intake" blocks. This is the safe default.
- Read-only investigation is always free, so the agent is never prevented from
  diagnosing before acting.
- The narrow scope is cheap to reason about and to test (the `isHarnessCliCall`
  - `isMutationToolCall` classifiers are pure functions with unit coverage).

Tradeoffs:

- An agent *could* mutate the repo via `bash` (`echo > file`,
  `printf | tee`) without tripping Gate A. This is an adversarial/edge case,
  not the documented failure mode, and Gate C still surfaces any resulting
  friction. Acceptable for v1.
- Cross-session handoffs need an intake **grace window** (6h) so an intake
  recorded late in one session still clears the gate at the start of the next
  same-day session. Implemented in `extensions/harness/session.ts`
  (`INTAKE_GRACE_MS`). Traces have no grace window (traces are per-task).

## Follow-Up

- If telemetry/observer shows agents bypassing via mutating bash, revisit
  §13.6 (broad scope) with a real classifier.
- When `/harness` (P3) lands, revisit §13.5 if a soft-block override is wanted.
