# US-022 — defer injection trace/intake nag to near done-claim (Option C)

## Status

implemented

## Lane

normal

## Product Contract

The `before_agent_start` injection stops emitting the **trace** and **intake**
nags on every turn. Those nags move to fire only when the agent is about to
**claim task completion** (a pre-`goal_complete` / done-claim moment), so a
pure chat turn stays quiet even when the session genuinely owes a trace.

The **setup** nag (cli/db missing) and the **drift** nag stay at
`before_agent_start` — those are ambient and not turn-type-dependent (you need
to know about drift the moment it appears, regardless of what the turn is
doing).

Closes the residual **OQ-2 timing** concern that US-021 left open: US-021
killed the vanity counts and made the injection silent when fully ready, but
on a session that *owes* a trace it still nags every chat turn because
`before_agent_start` cannot distinguish chat from editing.

Intake: **#27**. Follow-up to **US-021** (P6 M4). **blocked-by:** none (logic
change to injection trigger timing, consumes no US-018 contract beyond what
US-021 already uses).

## Relevant Product Docs

- `docs/initiatives/P6-status-action.md` — OQ-2 (injection ownership) + the
  trigger-timing residual noted in the new Status line
- `extensions/harness/index.ts` — `injectionMessage` (240–) + the
  `before_agent_start` handler that calls it (~1003); `tool_call`/`tool_result`
  handlers (~918–)
- `extensions/harness/gates.ts` — `readiness()` (delivered by US-018)
- `extensions/harness/session.ts` — `refreshFromCounts` (intake/trace detection
  by durable-count delta)

## Acceptance Criteria

- A pure-chat turn (no edit/done-claim) on a session that owes a trace emits
  **no** trace nag and **no** intake nag from `injectionMessage`.
- The trace nag fires at the done-claim moment (exact mechanism pinned by the
  OQ below), carrying the same command text as today.
- Setup + drift nags remain at `before_agent_start` (unchanged).
- Fully-ready session still renders `injectionMessage === ""` (US-021 invariant
  preserved — no regression).
- **OQ-C1 (must resolve in slice):** does pi expose an interceptable hook
  before `goal_complete` / done-claim? If yes → emit the trace nag there
  (preferred, surgical). If no → fall back to a heuristic: suppress the trace
  nag at `before_agent_start` until an edit/trace-eligible `tool_call` has
  occurred this turn (re-evaluate in `tool_result`), so chat-only turns stay
  quiet.

  **RESOLVED (yes — surgical path taken).** There is no pre-`goal_complete`
  *hook*, but `goal_complete` is itself a tool, and pi fires `tool_call` for
  every tool with **no name filtering**: `agent-session.js` sets
  `agent.beforeToolCall` → `runner.emitToolCall`, which runs all handlers
  unconditionally and aborts on `{block:true}`. So the trace nag fires by
  blocking `goal_complete` in the existing `tool_call` handler until a trace
  is recorded this session (`gateTraceOnDone`). The fallback heuristic was not
  needed.
- **OQ-C2:** intake is already enforced by Gate A at the edit moment; confirm
  the injection's intake nag is redundant once Gate A exists (it likely is →
  drop it entirely from injection, don't just defer it).

  **RESOLVED (yes — dropped entirely).** `decideGateA` step 5 blocks
  write/edit when `!session.intakeRecorded`, and the footer (US-018) still
  surfaces the intake next-action from `readiness()`. The per-turn intake nag
  was therefore redundant and noisy on chat turns → removed from
  `injectionMessage` (not deferred).

## Design Notes

- The core realisation from US-021 dogfooding: `before_agent_start` runs
  *before* the turn's content is known, so it is structurally the wrong place
  for a "you owe a trace" nag whose relevance depends on whether the turn does
  trace-eligible work.
- Two requirements already have a gate trigger at the right moment:
  - **intake** → Gate A blocks the edit → no injection nag needed (OQ-C2).
  - **drift** → Gate B′ blocks the `trace` call → but drift is also worth an
    ambient heads-up the moment it appears, so keep it at injection.
- Only **trace** lacks a gate trigger (done is agent-decided) → it is the one
  nag that genuinely needs a *moment-aware* reminder, which is what this story
  adds.
- This is intentionally **outside** P6 umbrella #23: P6's exit criteria (all
  four surfaces derive text from `readiness()`) are met; this changes *when*
  the nag fires, not *what* it derives from.
- `decideGateA` / Gate B′ logic stays untouched (presentation/trigger change
  only); existing `p2` gate tests must stay green.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | chat-turn state → no trace/intake nag; done-claim state → trace nag fires; setup/drift nags unchanged; ready → `""` |
| Integration | Approach B wiring: a synthetic chat-only turn on a trace-owing session yields `injectionMessage` without the trace nag |
| E2E | 0 |
| Platform | 0 |
| Release | 0 |

## Harness Delta

None to the durable schema. Adds a turn-type-aware trigger path for the trace
nag (mechanism decided by OQ-C1). If `harness-cli story add` is found to be the
intended packet scaffolder (it currently writes only the durable row, leaving
`orphan_durable` drift until the packet is hand-authored), that is a separate
harness-improvement intake — note in `--friction` on this story's first trace.

## Evidence

- `extensions/harness/gates.ts` — new pure `gateTraceOnDone(session)` +
  `REASON_TRACE` (carries the same `harness-cli trace …` command text).
  `decideGateA` / Gate B′ byte-identical (untouched).
- `extensions/harness/index.ts` —
  - `injectionMessage` now carries **only ambient** signals: setup (early
    `return ""`) + drift. The intake next-action and the trace-nag block were
    removed; the next-action line now shows only when `firstUnmet === "drift"`.
  - `tool_call` handler: new `goal_complete` intercept calls `gateTraceOnDone`
    and returns its block when no trace is recorded this session (guarded by
    `cliInstalled && dbInitialized` so non-harness repos are never trapped).
- Tests: `tests/p2.test.ts` +2 (`gateTraceOnDone` pass/block); `tests/p6.test.ts`
  injection suite rewritten for US-022 — chat-turn (trace-owing, no drift) → `""`,
  intake-unmet → `""`, intake-unmet+drift → drift nag only; drift/ready unchanged.
- `npx tsc --noEmit` clean. p2 46 · p3 33 · p4 58 · p5 31 · p6 36 — 0 failures,
  0 regressions. lens_diagnostics mode=all: 0 errors.
- OQ-C1 resolved by reading pi runtime (`dist/core/agent-session.js`
  `_installAgentToolHooks` → `beforeToolCall` → `runner.emitToolCall`, no name
  filter; `dist/core/extensions/runner.js` `emitToolCall` runs all handlers).
