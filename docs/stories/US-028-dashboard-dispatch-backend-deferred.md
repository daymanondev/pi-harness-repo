# US-028 Dashboard Dispatch Backend: cmux/tmux Pane Spawn (DEFERRED per ADR-0014)

## Status

planned (deferred)

## Lane

high-risk (classified at intake #40). The cmux pane-spawn build trips the
**External-provider-behavior hard gate** (cmux/tmux/zellij/wezterm) per
`docs/FEATURE_INTAKE.md` → high-risk unless scope is narrowed. The story stays
deferred, so no build is in flight.

> **Durable-lane caveat:** the story row's `risk_lane` is stuck at `normal`
> because `story update` exposes no `--lane` flag and `story add` fails on a
> duplicate id (backlog #14). The corrected high-risk classification lives in
> **intake #40** (`risk_lane=high-risk`, `flags=[external-systems,
> cross-platform]`) and in this packet. A future un-defer must treat US-028 as
> high-risk regardless of the stale matrix row.

## Product Contract

**Deferred — not built.** The would-be contract: `s` on a dashboard row
dispatches the item to a NEW mux pane (cmux/tmux/zellij/wezterm) running its
own `pi`, so the operator can fire multiple items in parallel, side-by-side.
This is the only dispatch path that crosses the **launch-surface line**
(ADR-0014): it spawns a process + terminal pane in the user's environment,
relaxing the US-014 read-only / in-session invariant.

ADR-0014 (Decision #3) explicitly **does not permit** pane-spawn from the
dashboard; unblocking requires extending ADR-0014 with a launch-surface
decision. That decision is not made here. This is the project's second "do not
escalate the surface" decision (sibling: ADR-0013 retired real-TUI dogfood for
US-016).

### The only non-cmux alternative (OUT OF SCOPE — recorded for the next agent)

Architecture C — in-process session spawn via `ctx.newSession` / `ctx.fork`
(`ExtensionCommandContext` exposes both): create a new node in pi's own session
tree seeded with the dispatch prompt; no mux, no shell exec, no new terminal
pane. This would deliver parallel dispatch without crossing the launch-surface
line, BUT ADR-0014 did not consider it — the record only weighed
`sendUserMessage` vs mux-pane-spawn. It needs a narrow **ADR-0014
interpretation clause**: is a new pi session "in-session" (permitted) or an
"out-of-session worker" (walled)? Plus a feasibility spike: whether
`withSession(ctx)` + `sendMessage({ triggerTurn: true })` (or a session-bound
`sendUserMessage`) actually seeds an autonomous turn. If the operator later
wants parallel dispatch without cmux, reframe US-028 (or a successor) to C and
open that ADR clause first — do not silently spawn sessions.

### Dropped from the stub

The stub's "async in-session subagent fallback" is **mis-specified**: the
`ExtensionAPI` has no `spawnSubagent` (verified at intake #40 — only
`sendUserMessage`, `sendMessage`, `exec` exist). A subagent can only be
spawned by the *agent* (its `subagent` tool), via a `sendUserMessage` prompt —
which is US-027 with a different prompt, not a new dashboard capability.
Removed from the contract.

## Acceptance Criteria

Deferred — this slice ships no code. The grill's acceptance is:

- US-028 stays `planned` (deferred); no extension code is written.
- The packet records the deferral rationale, the non-cmux alternative (C), and
  the stub mis-spec, so the next agent can un-defer safely.
- Intake #40 records the high-risk classification (the story row's `risk_lane`
  cannot be updated via the CLI — backlog #14).
- ADR-0014 is NOT extended (no launch-surface decision made); its follow-up
  clause stands unchanged.

If un-deferred later, AC become: (1) extend ADR-0014 with the launch-surface
decision (or the session-spawn clause for C); (2) high-risk story folder
(`docs/templates/high-risk-story/`: overview/design/execplan/validation);
(3) mux-detection helper (cmux→tmux→zellij→wezterm, graceful no-mux path) for
A, or the `ctx.newSession` wiring + `triggerTurn` spike for C; (4)
`HarnessOverlayResult` gains a `spawnPane` (A) / `spawnSession` (C) variant;
(5) unit + integration proof, no e2e/platform unless a mux provider demands it.

## Validation

None (deferred — no build). `verify_command` stays empty. If un-deferred:
`npx tsx tests/p4.test.ts && npx tsc --noEmit` + new dispatch-spawn tests.

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-028 --unit 1 --integration 1 --e2e 0 --platform 0`.

| Layer | Expected proof | Status |
| --- | --- | --- |
| Unit | `dispatchPromptFor` mode + reducer spawn signal (pure) | deferred |
| Integration | Approach B: `s` → `ctx.newSession` / `pi.exec` → spawned worker | deferred |
| E2E | | |
| Platform | mux availability per platform (architecture A only) | deferred |
| Release | | |

## Relevant Product Docs

- `docs/decisions/0014-dashboard-dispatch-policy.md` — the wall (Decision #3:
  pane-spawn NOT permitted without a launch-surface decision; follow-up clause
  names US-028).
- `docs/stories/US-027-*.md` — in-session `sendUserMessage` dispatch
  (implemented predecessor); US-028 is the deferred "leave the session" half.
- `docs/stories/US-023-*.md` (advisory pattern), `docs/stories/US-014-*.md`
  (read-only Command-Query invariant US-028 would relax).
- `extensions/harness/dashboard.ts` — `dispatchPromptFor`, `DispatchTarget`,
  `reduceDashboardNav` `s` branch; `extensions/harness/index.ts` —
  `HarnessOverlayResult` `dispatch` variant, command handler
  `pi.sendUserMessage`.
- pi SDK `ExtensionAPI` / `ExtensionCommandContext` — `sendUserMessage`,
  `exec`, `newSession` / `fork` (verified at intake #40).

## Harness Delta

- **Backlog #13** — `harness-intake-griller` lacks a concrete behavior-sketch
  step before classification forks (discovered grilling this story). Proposed,
  normal. Fix = patch `skills/harness-intake-griller/SKILL.md`.
- **Backlog #14** — `story update` cannot change `risk_lane` (no `--lane` flag;
  `story add` fails on duplicate). The corrected high-risk classification
  therefore lives in intake #40, not the story row. Proposed, tiny. Fix = add
  `--lane` to `story update`.
- **ADR-0014 interpretation gap** (recorded, not actioned): the record only
  weighed `sendUserMessage` vs mux-pane-spawn; it has no clause for in-process
  session-spawn (`ctx.newSession`). A future slice wanting non-cmux parallel
  dispatch must open this clause first.

## Evidence

- Intake #40 (spec_slice, high-risk, this slice): verified ADR-0014 Decision #3
  walls pane-spawn; verified `ExtensionAPI` has no `spawnSubagent` (only
  `sendUserMessage` / `sendMessage` / `exec`); verified
  `ExtensionCommandContext` exposes `newSession` / `fork` (architecture C).
  Concluded: keep deferred; fill packet; record high-risk classification in the
  intake (story row `risk_lane` immutable via CLI — backlog #14).
- No code changed (extension sources untouched; only this packet + durable
  rows: intake #40, backlog #13 + #14).
- Sibling: ADR-0013 (retired US-016 real-TUI dogfood) — same "do not escalate
  the surface" theme.
