# US-016 P5 — Live tail (fs.watch + async re-render)

## Status

planned

## Lane

normal

## Product Contract

While the TIMELINE tab is open, new `harness-cli` calls append to the view in
real time via `fs.watch` on `.harness-observer/events.jsonl`, without
re-opening the overlay. If the pi-tui Component contract cannot re-render on an
externally-triggered `invalidate()` (OQ-4), fall back to a documented mechanism
(poll / refresh-on-return) and record the limitation — never ship an unstable
watcher.

Umbrella intake: **#20** (P5 timeline). Roadmap: `docs/initiatives/P5-timeline.md` (M2).
**blocked-by:** US-015 (needs the render to tail into).

## Relevant Product Docs

- `pi-harness-design/DESIGN.md` §8.3 (Live tail)
- `docs/initiatives/P5-timeline.md` — M2 + OQ-4
- `@earendil-works/pi-tui` Component contract (the `invalidate()`/re-render
  seam to probe — the make/break for this slice)

## Acceptance Criteria

- Appending a line to `events.jsonl` (while the tab is open) surfaces the new
  row without a manual `r` refresh and without re-opening the overlay.
- Coalesced/rapid watcher events re-validate file size and re-read the tail
  (DESIGN §8.3) — no duplicate or dropped rows.
- Watcher errors (file deleted, permissions) degrade to a dim message, never
  crash the overlay; the watcher is disposed on overlay close.
- If OQ-4 blocks external re-render, the fallback is implemented + documented,
  and the limitation recorded (decision or friction).

## Design Notes

- **Make/break = OQ-4.** Probe the pi-tui Component contract before building:
  does the overlay re-render when `invalidate()` fires from a `fs.watch`
  callback, or only on key input? The current overlay re-opens via a
  `do { … } while (refresh)` loop (`index.ts`).
- **Lifecycle.** Start the watcher when the TIMELINE tab becomes active (or on
  overlay open); stop on Esc/close/dispose.

## Validation

To be filled by `harness-intake-griller` when this slice starts. Expected
(provisional): unit (tail-read + dedup logic, pure) + integration (watcher
fired against a temp fixture file). OQ-4 may force a spike before proof.

| Layer | Expected proof |
| --- | --- |
| Unit | tail-read + dedup over a fixture |
| Integration | watcher callback → re-render against a temp file |
| E2E | |
| Platform | |
| Release | |

## Harness Delta

None expected. May surface a decision if OQ-4 forces a fallback.

## Evidence

(pending implementation)
