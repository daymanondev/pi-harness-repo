# Initiative: P5 — TIMELINE tab (productizing `harness-observer`)

- **Umbrella intake:** #20 (new_initiative, lane normal)
- **Design ref:** `pi-harness-design/DESIGN.md` §8 (TIMELINE), §11 (phases)
- **Builds on:** the P4 DASHBOARD shell + the `timeline` tab placeholder
  (`extensions/harness/dashboard.ts`, key `t`) and `detect.ts`'s existing
  `observerInstalled` signal.
- **Touches:** backlog #5 (dashboard gains its first *action* surface — the
  `o` enable-observer key — but does **not** close it; acting on matrix/backlog/
  drift content remains open).

> This is a **roadmap** — a map of milestones, not a to-do list. It names the
> product areas and hard constraints; the tracer-bullet slices (US-015+) and
> their acceptance criteria live in the per-story packets, produced just-in-time
> by the griller. See ADR-0010 (extended by ADR-0012) for the workflow model.

## Goal

Turn `harness-observer` from a personal spike into an **in-dashboard feature**:
a TIMELINE tab that shows the *flow* of harness-cli calls the agent makes — what
ran, whether it changed durable state, and by how much — and updates live as the
agent works. The headline column is the `db_before → db_after` diff
(`intake: 2 → 3`): the exact "which command changed which table" insight the
observer exists to capture. When the observer is absent, the dashboard offers a
one-key onboarding path. Throughout, the observer stays a **companion** — never
an inbound harness tool — exactly as its semantics require.

## Milestones

1. **Timeline render** — the headline (tracer-bullet). Reads
   `.harness-observer/events.jsonl` (real schema verified: every line carries
   `ts, cmd[], exit, duration_ms, cwd, stdout, stderr, db_before, db_after`),
   renders the last N events as flow rows with the `db_before → db_after` diff
   as the lead column, color by `exit`, and an Enter drill-down to a detail pane
   (full `stdout`/`stderr`). Replaces the placeholder at `dashboard.ts:422`.
   Refresh is manual (`r`) at this milestone — proves the parsing + the diff
   value before the watcher complexity.

2. **Live tail** — the payoff (§8.3). The timeline appends new events in real
   time as the agent makes harness-cli calls, via `fs.watch` on `events.jsonl`
   - async re-render. This is what turns "learn how the agent uses harness"
   into a visible loop. **🛑 BLOCKED (US-016 deferred):** the live tail's
   plumbing landed (`readTimelineTail` + a gated watcher), but the background
   file-watch **froze the DASHBOARD** in the real TUI (`fs.watch` confirmed;
   `fs.watchFile` inconclusive). The watcher is DISABLED (`LIVE_TAIL_ENABLED =
   false`); the overlay reverts to US-015 manual-`r` behavior. Re-enable is
   backlog #7 — isolate why any background file-watch wedges pi's raw-stdin
   overlay. The pure `readTimelineTail` re-derives the
   tail idempotently on every watcher fire (no dup/drop).

3. **Observer onboarding** — the adopt path (§8.1). When `observerInstalled`
   is false, the dashboard shows a one-line prompt + an `o` key that runs the
   observer's `install.sh` (renames `harness-cli → harness-cli.real`) through
   `pi.exec`. Does **not** call `harness-cli tool register`. Isolated to its
   own slice because it is the only state-mutating, external-system-touching
   part of P5.

## Hard constraints

- **Read-only against `events.jsonl` and `harness.db`.** The timeline never
  mutates harness state. The only mutation in P5 is the observer install (M3),
  which renames a binary — never touches `harness.db` — and is walled off in its
  own slice.
- **Observer stays a companion.** Never call `harness-cli tool register`; that
  distorts the registry semantics the observer deliberately avoids (DESIGN
  §8.1). The `o` action runs `install.sh` only.
- **Pure renderers, impure lifecycle.** Timeline row / diff / detail rendering
  is pure; only `index.ts` reads files, spawns the watcher, and runs the
  installer. Mirrors the P3/P4 split (ADR-0011).
- **Reuse the existing seams.** The `timeline` tab, `DASHBOARD_TABS`,
  `reduceDashboardNav`, `DashboardData`, and `detect.ts`'s `observerInstalled`
  already exist. Extend them; do not fork the dashboard architecture.
- **Degrade cleanly.** Observer absent / `events.jsonl` missing / unparseable
  line / watcher error → a dim message in-tab, never a throw out of the overlay.

## Open questions (resolve before the relevant slice ships)

1. **N for "last N events"** (DESIGN §8.2 says 50) — confirm 50, or tune to the
   overlay height. Resolve at M1.
2. **Empty-diff rendering** — reads / `--version` carry `db_before = {}`. Omit
   the diff column for those rows (cmd + exit + duration only). Minor; resolve
   at M1.
3. **`install.sh` source pinning** (DESIGN §8.1, analogous to §13.1 →
   ADR-0011) — the repo dropped the `harness-observer/` clone in US-002. Where
   does `install.sh` live for a real user, and is it pinned to a release tag or
   `main`? Likely needs an ADR mirroring ADR-0011. Resolve at M3.
4. **Async re-render mechanism** (make/break for M2) — does `ctx.ui.custom`
   re-render when the Component's `invalidate()` is fired from a `fs.watch`
   callback (external trigger), or only on key input? The current overlay
   re-opens via a `do { … } while (refresh)` loop (`index.ts`). Probe the
   `@earendil-works/pi-tui` Component contract before building the watcher; if
   unsupported, document the fallback. Resolve at M2.

   **🟡 PARTIAL (US-016 / decision 0013):** the *source-level* probe came back
   positive — `TUI.requestRender()` is public and `ctx.ui.custom` hands the
   component the `tui` instance, so an async callback *should* be able to
   re-render. **But this was never verified end-to-end in the real TUI**, because
   the file-watch primitive that would drive it froze the overlay first. The
   OQ-4 re-render seam is plausible-but-unverified; the blocker is the
   file-watch freeze (backlog #7), not the re-render contract.

## Out of scope (confirmed during grill)

- **§8.4 pi-side enrichment** — hooking `pi.on("tool_call")` to tag events with
  the pi turn index. DESIGN says "not in v1; later phase." Deferred.
- **Windows installer** (DESIGN §13.2). macOS/Linux only for P5.
- **Acting on matrix/backlog/drift content** (backlog #5 proper) — the dashboard
  remains view-only except for the `o` enable-observer key.
