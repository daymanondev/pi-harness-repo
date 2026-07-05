# US-001 P1 — detect() + session_start footer/widget

## Status

implemented

## Lane

normal

## Product Contract

pi-harness must, on every session start, detect whether `repository-harness`
is installed and initialized in `ctx.cwd`, and surface that state passively in
the pi footer (composing with `pi-powerline-footer`) plus an install-hint
widget when the harness is absent or its db is missing. Detection must never
crash the session — failure is always a clean degrade.

## Relevant Product Docs

- `pi-harness-design/DESIGN.md` §3 (Detection model), §4 (Passive footer + widget), §13 (open questions)
- `docs/HARNESS.md` (Durable Layer, detection contract)
- `docs/CONTEXT_RULES.md` (Appendix C detection signals)

## Acceptance Criteria

- `detectHarness(cwd, exec)` returns a `HarnessState` with `cliInstalled`,
  `cliVersion`, `dbInitialized`, `shimPresent`, `claudeShimPresent`,
  `observerInstalled`, optional `stats`, and optional `error`.
- `detectHarness` is pure: it takes an injected `exec` function and imports no
  pi types, so it is unit-testable without the pi runtime.
- `session_start` handler renders three footer states via `ctx.ui.setStatus`:
  installed+stats, cli-missing, db-missing. It also sets a `harness-hint`
  widget (`placement: "belowEditor"`) in the two missing states.
- Footer is guarded by `ctx.hasUI` (works in TUI + RPC), per pi docs.
- Binary path is resolved absolutely against `ctx.cwd`; platform-aware
  (`harness-cli.exe` on Windows).
- Any probe failure sets `state.error` and the footer shows a muted degrade —
  never throws out of `session_start`.
- `query stats` table is parsed into `{intakes, stories, decisions,
  backlog_items, traces}`; a parse failure leaves `stats` undefined (not a
  crash).

## Design Notes

- **Correction vs DESIGN.md §5/§6:** `pi.exec` has no `cwd` option (docs show
  `{ signal, timeout }`). We resolve `scripts/bin/harness-cli` to an absolute
  path and rely on the inherited session cwd (repo root) so the CLI finds
  `harness.db`.
- **Guard:** use `ctx.hasUI`, not `ctx.mode === "tui"`, so the footer also
  renders in RPC mode.
- **Stats parsing:** `query stats` emits a header row, a dash row, then one
  numeric row of 5 columns in fixed order
  `intakes stories decisions backlog_items traces`. We locate the first
  all-numeric row after the header.
- **Cache:** module-level cache keyed by `cwd`, invalidated by `mtime` of
  `harness.db` and `scripts/bin/harness-cli` plus a 5s TTL, so repeated
  detection during a session is cheap.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-001 --unit 1 --integration 1 --e2e 0 --platform 0`.

| Layer | Expected proof |
| --- | --- |
| Unit | `detectHarness` parses a fixture `query stats` table and probes fs signals correctly |
| Integration | loading the extension in pi sets the footer in installed / cli-missing / db-missing states |
| E2E | N/A (P1 has no user-facing command) |
| Platform | runs on macOS/Linux; Windows uses `.exe` suffix |
| Release | N/A |

## Harness Delta

- Records friction: `AGENTS.md` references
  `.codex/skills/harness-intake-griller/SKILL.md`, which does not exist.
- Confirms `repository-harness` durable layer bootstrapped (`init` + `migrate`)
  and Intake #1 recorded for this story.

## Evidence

- `npx tsc --noEmit` → exit 0.
- `tsx` smoke test of `detectHarness` against the live repo → all assertions pass (cli `0.1.11`, db OK, shim present, observer present, `stats.intakes` matches recorded intake).
- `index.ts` default-export factory loads clean (arity 1).
- `npm pack --dry-run` confirms a clean publish surface.
- Durable: trace #2 (standard tier, meets normal-lane requirement).
- Live pi-session integration not exercised in this environment (flagged in trace notes).
