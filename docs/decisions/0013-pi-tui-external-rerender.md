# 0013 pi-tui: `requestRender()` is the re-render lever — but background file-watch freezes the overlay (UNRESOLVED)

Date: 2026-07-07

## Status

**Superseded by retirement (2026-07-07).** US-016's live tail was **dropped**
(intake #28, story US-016 → retired, backlog #7 → rejected) — see §Retirement.
The original OQ-4 conclusion — `TUI.requestRender()` is the external re-render
lever, not `invalidate()` — stands as a source-level finding, and the freeze
investigation produced one durable correction: **the freeze is NOT the watch
primitive.** A PTY-allocated probe proved `fs.watch` and `fs.watchFile` both
stay healthy against pi's exact raw-stdin attachment, falsifying the Node #20148
hypothesis below; the cause is pi-internal (the render loop). The historical
§Revision / §Freeze text is retained for the record.

## Retirement (2026-07-07)

The live tail was retired rather than fixed. Rationale: the remaining root-cause
work needs a real-TUI dogfood (the freeze is pi-internal — render path — and
headless tests can't reproduce it), and the feature isn't needed now. Code
removed from `extensions/harness/index.ts` (watcher, `refreshTimelineTail`,
`degradeTimeline`, `dispose`, kill-switch, `tui` opt + the `watchFile`/
`unwatchFile`/`Stats` imports); the US-015 TIMELINE tab + `readTimelineTail`
stay. Investigation artifact: a PTY probe ran A/B/C across none / `fs.watch` /
`fs.watchFile` under a real PTY replicating pi's `setRawMode+resume+on('data')`
stdin — all three stayed healthy (stdin events continued after the handle was
created), falsifying the Node #20148 primitive-conflict hypothesis and
localising the freeze to `requestRender()` from an async callback. Any future
re-enable must dogfood that path in the real TUI first.

## Revision history (2026-07-07)

1. **v1 — `fs.watch`:** shipped as the US-016 mechanism. **Froze the TUI.**
   Dogfooding `/harness` opened the DASHBOARD but no keyboard input
   registered (input-starved; no error logged). Repro: the watcher fired 0× on
   a stable file, so the freeze was the handle *existing*, not firing.
2. **v2 — `fs.watchFile`:** switched to stat-polling (threadpool, no
   FSEvents/kqueue). The user's "new session" retest still froze — but **this
   was inconclusive**: pi sessions can share one process, so the retest likely
   ran stale v1 module code rather than the v2 fix. fs.watchFile was never
   cleanly verified in the real TUI.
3. **v3 — watcher DISABLED (current shipped state):** `LIVE_TAIL_ENABLED = false`.
   The overlay reverts to the known-working US-015 behavior (manual `r`
   refresh). **Confirmed responsive** via a temporary diag log: with the
   watcher off, `MODULE_LOAD liveTail=false` + `ctor` + many key `input`s all
   fired normally. The freeze is gone; the live tail is deferred.

## Context

US-016 ships the live tail: while the TIMELINE tab is open, new `harness-cli`
calls append to the view in real time, **without re-opening the overlay**. The
slice hinged on one unknown (OQ-4): does the pi-tui Component contract
re-render when an *externally-triggered* callback fires, or only on key input?

The pi-tui `Component.invalidate()` docstring ("called when theme changes") is
misleading: `invalidate()` is what the TUI calls **on** the component, not how a
component requests a redraw. Source-level, the lever is the public
`TUI.requestRender()`.

## Decision (source-level, OQ-4)

`TUI.requestRender(force?)` is the re-render lever. Evidence (cited for
re-verification):

- `TUI.requestRender(force?)` is **public** (`pi-tui/dist/tui.d.ts:211`); it
  schedules a debounced `doRender()` (`tui.js:525` → `scheduleRender` `533`).
- `ctx.ui.custom` passes `tui` to the component factory as its first arg
  (`pi-coding-agent/.../extensions/types.d.ts:116`).
- `compositeOverlays` calls `component.render(width)` fresh every pass
  (`tui.js:808`).
- `showExtensionCustom.close()` calls `component.dispose?.()` on every close
  path (Esc/refresh/install — `interactive-mode.js:1871`).

**Caveat:** this is a source read, NOT a verified runtime behavior. The
file-watch freeze (below) prevented ever exercising `requestRender` from an
async callback in the real TUI. It must be re-verified when the watcher is
re-enabled.

## The unresolved freeze (why the watcher is off)

Both candidate primitives froze (or appeared to freeze) the DASHBOARD:

- `fs.watch` — confirmed freeze. macOS FSEvents/kqueue event-notification
  conflicts with raw-mode stdin reads (Node
  [#20148](https://github.com/nodejs/node/issues/20148)) is the leading
  hypothesis, but it was never cleanly confirmed against `fs.watchFile`.
- `fs.watchFile` — inconclusive (possible stale-code retest; see v2 above).

The **root cause — why ANY background file-watch wedges pi's raw-stdin overlay
— is OPEN.** It may be the foreign libuv handle, `requestRender` re-entrancy
from an async callback, or a pi session/process model interaction. Until it is
isolated, no background watcher ships. The plumbing
(`readTimelineTail` / `refreshTimelineTail` / `startTimelineWatch` / `dispose`)
is retained, gated behind `LIVE_TAIL_ENABLED`, for a safe re-enable.

## Alternatives Considered

1. **`fs.watch`** — froze the TUI (v1). Rejected.
2. **`fs.watchFile`** — inconclusive (v2); not safely verifiable given the
   session/process reload confusion. Held, not shipped.
3. **Disable the watcher (manual `r` refresh)** — **chosen (v3).** Restores the
   US-015 behavior the user confirmed working. Zero freeze risk.
4. **`tui.invalidate()` instead of `requestRender()`** — wrong lever (see above).

## Consequences

Positive:

- The DASHBOARD works again (no freeze); US-015 manual-refresh behavior restored.
- `readTimelineTail` + `refreshTimelineTail` plumbing landed and is unit/integration tested.
- The OQ-4 source-level finding is recorded so it isn't re-derived.

Tradeoffs:

- **The live tail (the point of US-016) is NOT shipped.** The timeline tab
  updates only on manual `r` refresh.
- The freeze root cause is unknown; re-enabling requires real-TUI investigation
  (the headless p5 wiring tests pass despite the freeze — they have no real
  stdin, so they cannot catch host-input-loop interactions).

## Follow-Up

- **Backlog:** isolate the freeze root cause and re-enable the live tail behind
  a verified-safe mechanism. Re-verify `requestRender()` from an async callback
  in the real TUI at that time.
- Do NOT re-enable `LIVE_TAIL_ENABLED` without a green real-TUI dogfood.
- US-017 (observer onboarding) is unaffected.
