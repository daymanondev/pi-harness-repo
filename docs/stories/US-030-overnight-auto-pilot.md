# US-030 Overnight Auto-Pilot: Unattended Implement-All-Grilled Runner

## Status

planned

## Lane

normal

## Product Contract

An **unattended orchestrator** ("treo qua đêm") that loops over every grilled
(`●`) story and, for each: spawns a **worker sub-agent** (in-session async) to
implement the story from its packet → runs `story verify` → records a trace →
proceeds to the next. Runs the whole queue sequentially, unattended, through
the night.

- Routes via `isGrilled` computed inline (SQL) — **no dashboard dependency**.
- **Headless**: uses pi async subagents + `wait`, NOT mux panes (US-028 is for
  the interactive "watch each task in its own pane" mode; auto is different).
- Depends on **US-029** (stories pre-grilled) — the pilot implements, it does
  not grill.

> Planned stub — NOT yet grilled. No `spec_slice` intake links this story yet.

## Acceptance Criteria

(to be defined at grill time)

## Validation

- (tbd at grill time)

## Relevant Product Docs

- pi-subagents skill (async runs + `wait`), `docs/stories/US-023-*.md` (isGrilled)
- `docs/stories/US-029-*.md` (bulk-grill prep), `docs/TRACE_SPEC.md` (per-story trace)

## Evidence

(none — planned, not yet grilled)
