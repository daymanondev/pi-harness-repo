# US-005 P2 hardening — argv-based gate matching + wiring integration test

## Status

implemented

## Lane

normal

## Product Contract

Harden the P2 gates after dogfood exposed two rough edges: (1) the gate matched
`harness-cli`/subcommands by substring-grepping the WHOLE bash script, so
`echo "harness-cli trace"` or `grep trace harness-cli.md` were false-positively
treated as real invocations; (2) there was no deterministic test of the index.ts
event wiring, so the stale drift-cache bug and the over-block only surfaced
under manual restart. This story fixes both.

## Relevant Product Docs

- `pi-harness-design/DESIGN.md` §9.2 (Gate B′), §13.6 (scope)
- `extensions/harness/gates.ts`, `extensions/harness/index.ts`
- Backlog #3 (over-block), #4 (no automated wiring test)

## Decisions

- **Argv parsing over substring grep.** `parseCommandLeads(script)` splits on
  shell sequencing operators (`&&`, `||`, `;`, `|`, newline), strips leading
  env-var assignments, and returns the leading token of each segment.
  `isHarnessCliCall`/`isHarnessIntakeCall`/`isHarnessTraceCall` now check
  whether a segment whose LEAD resolves to `harness-cli` also carries the
  subcommand. `echo "harness-cli trace"` (lead `echo`) no longer matches;
  `git commit && harness-cli trace` still matches (the trace IS run).
- **Bundling is still blocked by design.** pi can only block a whole `tool_call`,
  not individual segments, so a compound script containing the closing step is
  still refused. The Gate B′ reason now tells the agent to run sibling commands
  first, clear the drift, then re-run the closing step alone.
- **Approach B test = mock ExtensionAPI + on-disk fixture.** The test loads the
  real `index.ts` default export, feeds a mock `pi` that captures `on()`
  handlers and serves canned `query` outputs, and replays synthetic
  `session_start` / `tool_call` / `tool_result` events against a temp fixture
  repo. Deterministic, free, no LLM.

## Acceptance Criteria — how each was met

- `parseCommandLeads` + `segmentLead` exported from gates.ts; unit-covered.
- `isHarnessCliCall`/`isHarnessIntakeCall`/`isHarnessTraceCall` rewritten on top
  of argv parsing; 7 new unit cases cover echo/grep false-positives, env-prefix,
  compound scripts, and the notes-file non-match.
- Gate B′ reason message guides separating sibling commands.
- Wiring test (`tests/p2.test.ts` "full gate lifecycle") replays the whole flow
  through real handlers: write blocked pre-intake → clears after intake
  `tool_result` → trace blocked while drift seeded → passes once drift fixed on
  disk (this is the regression guard for the stale-cache fix).

## Evidence

| Layer | Proof |
| --- | --- |
| Unit | `tests/p2.test.ts` — **44 passed, 0 failed** (36 prior + 7 argv-parsing + 1 wiring lifecycle). |
| Integration | Wiring test drives the real `index.ts` against an on-disk fixture repo end-to-end (Approach B). |
| Typecheck | `tsc --noEmit` exit 0. |
| Real-repo drift | smoke `detectDrift(cwd)` → 0. |
| E2E | N/A (manual TUI already done in P2 dogfood) |
| Platform | N/A |
| Release | N/A |

## Harness Delta

- Closes Backlog #3 (over-block) and #4 (no wiring test).
- gates.ts: new `parseCommandLeads` / `segmentLead` exports; classifiers rewritten.
- index.ts: Gate B′ reason message updated.
- tests/p2.test.ts: +8 cases (7 argv + 1 wiring lifecycle).

## Open follow-ups

- The wiring test currently covers the happy lifecycle; could add failure-mode
  cases (Gate A′ db-missing block, Gate C friction widget). Non-blocking.
