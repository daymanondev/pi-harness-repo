# US-016 P5 — Live tail (file-watch + async re-render)

## Status

planned — **live tail DEFERRED.** The plumbing (`readTimelineTail`,
`refreshTimelineTail`, the gated watcher, dispose) is implemented + tested, but
the background file-watch is **DISABLED** (`LIVE_TAIL_ENABLED = false`) because
it froze the TUI (see §Freeze). The overlay reverts to US-015 manual-`r`
behavior, which the user confirmed works. Re-enable tracked as backlog #7. The
headline AC ("appending a line surfaces the new row without manual refresh")
is **not met** until the freeze root cause is isolated.

## Lane

normal

## Product Contract

While the TIMELINE tab is open, new `harness-cli` calls append to the view in
real time via `fs.watchFile` (stat-polling) on `.harness-observer/events.jsonl`, without
re-opening the overlay. **OQ-4 RESOLVED** (see decision 0013): the pi-tui
Component contract *does* support an externally-triggered re-render —
`TUI.requestRender()` is public and the `ctx.ui.custom` factory hands the
component the `tui` instance, so an async callback re-derives the tail
then calls `tui.requestRender()`; `compositeOverlays` re-pulls `render(width)`
fresh every pass. (Original draft used `fs.watch`; dogfooding found it freezes
pi's raw-mode stdin on macOS — Node #20148 — so the mechanism is now
`fs.watchFile`. See decision 0013 §Revision.)

Umbrella intake: **#20** (P5 timeline). Slice intake: **#22**. Roadmap:
`docs/initiatives/P5-timeline.md` (M2).
**blocked-by:** US-015 (done — needs the render to tail into).

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

- **OQ-4 probe (the make/break).** Read the pi-tui contract before building:
  - `TUI.requestRender(force?)` is **public** (`pi-tui/dist/tui.d.ts:211`) —
    schedules a debounced `doRender()`.
  - `ctx.ui.custom` passes the `tui` instance to the component factory as its
    first arg (`types.d.ts:116`); `index.ts` had been capturing it as `_tui`
    and ignoring it. Now captured and threaded into `HarnessOverlayOpts.tui`.
  - `compositeOverlays` calls `component.render(width)` **fresh every render
    pass** (`tui.js:808`) — so `requestRender()` re-pulls the latest
    `data.timeline` without re-opening the overlay.
  - `showExtensionCustom.close()` calls `component.dispose?.()` on **every close
    path** (Esc / refresh / install — `interactive-mode.js:1871`), so the
    watcher is reliably torn down in `dispose()`.
  - Verdict: the `fs.watchFile` + `tui.requestRender()` mechanism is safe in
    pi's TUI. (The first draft used `fs.watch`; it froze the overlay on macOS
    — see §Freeze below — and was replaced same-day.)
- **Lifecycle.** The poller starts in the component constructor when the
  DASHBOARD opens. It is skipped when the initial fetch already failed
  (`data.errors.timeline` set → nothing to tail) or when no TUI is wired
  (tests). `dispose()` calls `unwatchFile(listener)`.
- **No dup / no drop.** Every update is a fresh idempotent re-derivation from
  the *current* file contents via the pure `readTimelineTail(text)`
  (`parseEventsJsonl(text).slice(-TIMELINE_MAX)`) — never an incremental append
  onto a stale list. So coalesced / rapid / re-fired watcher events can neither
duplicate nor drop a row. A 50ms debounce collapses a watcher burst into one
  file read + render (the re-derivation is idempotent anyway, so this is purely
  to avoid redundant work).
- **Degrade cleanly.** A mid-poll read failure (file deleted) sets
  `data.errors.timeline`, which renders the existing dim "timeline unavailable"
  row — never throws out of the overlay.
- **Reuse the seam.** `fetchTimeline` (initial) and `refreshTimelineTail` (live)
  both route through `readTimelineTail`, so the first paint and live updates can
  never diverge.

## Validation

Filled at slice start (intake #22). Unit proves the pure re-derivation; the
integration test drives the watcher entry point (`refreshTimelineTail`)
deterministically (the poller's `refreshTimelineTail` is driven directly,
substituting the real poll, to avoid timing flakiness — the handler under test
is identical).

| Layer | Expected proof |
| --- | --- |
| Unit | `readTimelineTail` (empty/garbage, under-cap, over-cap drops oldest, append re-derives idempotently — no dup/drop, cap boundary) — 5 tests |
| Integration | Approach B wiring: live tail appends a row in-place without re-opening the overlay (`customCalls` unchanged + `requestRender` called); mid-watch file disappearance degrades; `dispose` is idempotent — 3 tests |
| E2E | |
| Platform | |
| Release | |

## Harness Delta

Decision 0013 recorded + **revised same-day** (§Revision): OQ-4 re-render
lever is `requestRender()` (unchanged); file-watch mechanism switched
`fs.watch` → `fs.watchFile` after dogfooding found `fs.watch` freezes pi's
raw-mode stdin on macOS (Node #20148).

## Freeze (post-ship regression — watcher DISABLED, live tail deferred)

First ship used `fs.watch`. Dogfooding `/harness` froze the DASHBOARD: it
opened but no keyboard input registered (watcher fired 0× on a stable file →
the freeze was the handle *existing*, not firing; no error logged →
input-starved). Leading hypothesis: on macOS `fs.watch` (FSEvents/kqueue)
conflicts with raw-mode stdin reads (Node [#20148](https://github.com/nodejs/node/issues/20148)).

A `fs.watchFile` (threadpool stat-poll) attempt was **inconclusive**: pi
sessions can share one process, so the "new session" retest likely ran stale
`fs.watch` module code rather than the fix — fs.watchFile was never cleanly
verified in the real TUI.

**Final shipped state: watcher DISABLED** (`LIVE_TAIL_ENABLED = false`). The
overlay reverts to known-working US-015 behavior. **Confirmed responsive** via
a temporary diag log: with the watcher off, `MODULE_LOAD liveTail=false` +
`ctor` + many key `input`s fired normally. The freeze is gone.

The root cause — why ANY background file-watch wedges pi's raw-stdin overlay —
is **OPEN** (backlog #7). The live tail is deferred until it is isolated and
the re-enable passes a real-TUI dogfood. Lesson in decision 0013: OQ-4 probed
the *re-render contract* (source-level) but could not, headlessly, probe
whether the *file-watch primitive* is safe inside pi's raw-stdin TUI — and the
headless p5 wiring tests pass despite the freeze (they have no real stdin).

## Evidence

- `npx tsc --noEmit` → exit 0 (clean).
- `npx tsx tests/p5.test.ts` → **34 passed, 0 failed** (+8 over US-015:
  5 `readTimelineTail` unit + 3 live-tail wiring).
- Regression: `tests/p2.test.ts` 44/44, `tests/p3.test.ts` 33/33,
  `tests/p4.test.ts` 58/58 — no regressions.
- `lens_diagnostics` (mode=all, severity=error): **0 errors** across the
  touched files.
- Mechanism re-verified after the freeze fix: `fs.watchFile` detects an append
  on the real 1.5MB `events.jsonl` (`true`); `fs.watch` confirmed to fire 0× /
  error 0× on the stable file (so the freeze was the handle, not firing).
- Implementation: `dashboard.ts` exports `readTimelineTail`; `index.ts`
  captures `tui` from the `ctx.ui.custom` factory, polls `fs.watchFile` (interval
  ~1.5s, stdin-safe — NOT `fs.watch`) on `.harness-observer/events.jsonl` in the
  component constructor, re-derives via `refreshTimelineTail` →
  `tui.requestRender()`, degrades on read error, and `unwatchFile`s in `dispose()`.
