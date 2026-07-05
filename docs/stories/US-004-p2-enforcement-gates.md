# US-004 P2 — enforcement gates (A / A′ / B / B′ / C)

## Status

implemented

## Lane

normal

## Product Contract

pi-harness turns the harness Task Loop from documentation into runtime rails,
using pi's **blockable** `tool_call` event and the injectable
`before_agent_start`. Enforcement is on by default for any repo where
`cliInstalled && dbInitialized`; failure is always a guide (carry the exact
command to run), never a wall. Gates fail OPEN on detection errors (a false
block would trap the agent).

## Decisions (§13.5 / §13.6 → ADR 0009)

- **§13.5 — Hard-block, no `/harness` bypass in P2.** Reads + harness-cli calls
  are never intercepted → agent is never trapped from investigating. Only way
  past Gate A is recording an intake.
- **§13.6 — Narrow scope.** Gate A intercepts `write`/`edit` only; `bash` is
  exempt (classifying mutating bash is fragile). Gate C still nags failed bash.

## Relevant Product Docs

- `pi-harness-design/DESIGN.md` §9.1 (live-state injection), §9.2 (Gate A/A′/B/B′/C), §13.5/§13.6 (now resolved)
- `docs/decisions/0009-p2-gate-scope-and-bypass.md`
- `extensions/harness/{detect,gates,drift,session,index}.ts`
- `docs/HARNESS.md` → Task Loop + Done Definition

## Acceptance Criteria — how each was met

### Gate A — Intake gate (hard-block write/edit)

- `decideGateA()` in `gates.ts` blocks `write`/`edit` when `cli+db present &&
  !intakeRecorded`, returning a reason that carries the exact `intake`
  command. Wired in `index.ts` `tool_call`. Verified by `decideGateA` unit
  cases (write blocked pre-intake, allowed post-intake).

### Gate A′ — Precondition gate (db missing)

- `gatePrecondition()` blocks all mutation tools with a route to
  `init` + `migrate` + re-`query matrix`, never to editing. Precedence encoded
  in `decideGateA` (db-missing write → A′ reason). Unit-covered.

### Gate B — Trace gate (soft nag)

- `before_agent_start` injects a `[harness] Done Definition requires a
  recorded trace...` message every turn until `traceRecorded`. Footer also
  shows `⚠no-trace`. `traceRecorded` cleared on `harness-cli trace` tool_result
  success or count increase.

### Gate B′ — Drift gate (hard-block on close) — folded from US-003

- `detectDrift()` in `drift.ts` cross-checks markdown `## Status` ↔ durable
  `query matrix`, plus orphan/evidence checks (4 drift kinds).
- `gateDriftOnTrace()` in `index.ts` blocks `harness-cli ... trace` when
  `drift.length > 0`, listing the drifted ids. Footer shows `⚠N drifted`.
- Real-repo smoke test returns 0 drift (matches the manual cross-check).

### Gate C — Friction prompt (non-blocking)

- `tool_result` for failed `bash` (`event.isError`) raises the
  `harness-friction` widget with the `backlog add` command.

### Cross-cutting

- All gates guarded by `cliInstalled && dbInitialized` (non-harness repos pass
  everything).
- Live-state injection ships in the same `before_agent_start` handler (durable
  counts line).
- Bypass UX + scope resolved by ADR 0009.

## Validation — proofs

| Layer | Proof |
| --- | --- |
| Unit | `tests/p2.test.ts` — **36 passed, 0 failed**. Covers `isHarnessCliCall` (incl. the `harness-cli-notes.txt` non-match), intake/trace/mutation classifiers, `gatePrecondition`, `gateIntake`, full `decideGateA` precedence, `parseMatrix` (spaces in title), `parseMarkdownStatus`, `isEvidenceMissing`, `storyIdFromFilename`, all 4 drift kinds + clean + retired-exclusion + planned-no-evidence, and session seeding/grace-window/refresh. |
| Integration | Real-repo smoke: `detectDrift(cwd, exec)` against live `harness-cli query matrix` + real `docs/stories/*.md` → **0 drift** (matches the manual node cross-check used to fix US-001/US-002). |
| Typecheck | `tsc --noEmit` exit 0 across `detect/gates/drift/session/index`. |
| Publish | `npm pack --dry-run` = 5 extension files + 3 skill files + README + manifest (10 files). `tests/` correctly excluded by the `files` whitelist. |
| E2E | N/A (runtime gate behaviour needs a live pi session; deferred to manual) |
| Platform | N/A |
| Release | N/A |

## Harness Delta

- Folds retired US-003 (Gate B′ + drift footer).
- New modules: `gates.ts`, `drift.ts`, `session.ts`; `index.ts` rewritten to
  wire `session_start` / `tool_call` / `tool_result` / `before_agent_start`.
- ADR 0009 records the §13.5/§13.6 resolutions; DESIGN.md §13 updated.

## Open follow-ups (not blocking)

- Manual E2E: load the extension in a real pi TUI session in a fixture repo
  and confirm (a) an edit is blocked pre-intake, (b) it clears after
  `harness-cli intake`, (c) `harness-cli trace` is blocked while a drift is
  seeded. (Requires a throwaway fixture repo; safe to do post-merge.)
- If observer/telemetry shows agents bypassing via mutating bash, revisit
  §13.6 (broad scope) with a real classifier.
- When `/harness` (P3) lands, revisit §13.5 if a soft-block override is wanted.
