# US-028 Dashboard Dispatch Backend: cmux/tmux Pane Spawn + Fallback (DEFERRED — Needs ADR-0014)

## Status

planned

## Lane

normal

## Product Contract

IF the dashboard is later allowed to spawn panes directly: a mux module
(cmux/tmux/zellij/wezterm, `pi-interactive-subagents` pattern) with graceful
fallback to an async in-session subagent when no mux is present. This is the
only slice that would relax the US-014 read-only invariant → requires
**ADR-0014 (launch-surface)** before implementation.

> DEFERRED. In v1 the operator opens panes themselves, so this slice is not
> needed. Revisit only if dashboard-driven spawn is wanted.

## Acceptance Criteria

(to be defined at grill time, pending ADR-0014)

## Validation

- `npx tsx tests/p4.test.ts && npx tsc --noEmit` (expected).

## Relevant Product Docs

- `pi-interactive-subagents` repo (`pi-extension/subagents/cmux.ts`)
- `docs/stories/US-014-*.md` (read-only invariant this would relax),
  `docs/decisions/` (where ADR-0014 would land)

## Evidence

(none — deferred)
