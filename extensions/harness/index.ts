// index.ts — pi-harness entrypoint.
//
// P1 (§3, §4): detect repository-harness on session_start + render a passive
//   footer/widget composing with pi-powerline-footer's customItems contract.
// P2 (§9.1, §9.2): turn the harness Task Loop into runtime rails:
//   - Gate A   intake gate        (hard-block write/edit until intake recorded)
//   - Gate A′  precondition gate  (block all mutations when db missing)
//   - Gate B   trace gate         (soft nag + footer badge until trace recorded)
//   - Gate B′  drift gate         (hard-block `harness-cli trace` while drift > 0)
//   - Gate C   friction prompt    (non-blocking widget on failed bash)
//   Plus live-state injection via before_agent_start.
//
// Resolved open questions:
//   §13.5  hard-block; reads + harness-cli exempt → no trap. No /harness
//          bypass yet (P3). Only way past Gate A is recording an intake.
//   §13.6  narrow scope: Gate A intercepts write/edit only; bash is exempt
//          (classifying mutating bash is fragile). Gate C still nags bash.
//
// Failure model: every probe is wrapped; detection/gate errors degrade the
// footer and the gates fail OPEN (never block on a detection error — a false
// block would trap the agent). Only a clean "harness repo + no intake" blocks.

import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { watchFile, unwatchFile, type Stats } from "node:fs";
import { join } from "node:path";
import {
  cliBinaryPath,
  detectHarnessCached,
  invalidateCache,
  type ExecFn,
  type HarnessState,
} from "./detect.js";
import { decideGateA, isHarnessIntakeCall, isHarnessTraceCall, readiness } from "./gates.js";
import { detectDrift, summarizeDrift, type DriftRecord } from "./drift.js";
import {
  getSession,
  refreshFromCounts,
  seedSession,
} from "./session.js";
import {
  buildInstallPlan,
  buildShimInsertion,
  DEFAULT_FLAGS,
  initialMode,
  isEnter,
  isEscape,
  nextMode,
  renderInstallLines,
  routeView,
  type FgFn,
  type HarnessView,
  type InstallFlags,
  type InstallStep,
} from "./overlay.js";
import {
  parseMatrixNumeric,
  parseStats,
  parseBacklogOpen,
  parseToolsJson,
  readTimelineTail,
  reduceDashboardNav,
  renderDashboardLines,
  type DashboardData,
  type DashboardNav,
  type DashboardTab,
  type MatrixRow,
  type PacketRef,
  type StatsCounts,
  type BacklogRow,
  type ToolRow,
  type TimelineEvent,
  ZERO_STATS,
} from "./dashboard.js";

const STATUS_KEY = "harness";

// ── US-016 live-tail kill switch ────────────────────────────────────────────
// The background file watcher is DISABLED. fs.watch confirmed froze the
// /harness DASHBOARD in the real pi TUI (dogfooding); a `fs.watchFile` attempt
// could not be cleanly verified (pi sessions may share a process, so a "new
// session" can still run stale module code). Rather than ship either primitive
// unverified, the watcher is off and the overlay reverts to the known-working
// US-015 behavior (manual `r` refresh). Confirmed responsive via a diag log:
// with the watcher off, MODULE_LOAD + ctor + key inputs all fire normally.
//
// The plumbing (readTimelineTail / refreshTimelineTail / startTimelineWatch /
// dispose) is retained, gated behind this flag, for a safe re-enable once the
// root cause — why ANY background file-watch wedges pi's raw-stdin overlay — is
// isolated. See decision 0013 §Revision.
const LIVE_TAIL_ENABLED = false;
const WIDGET_KEY = "harness-hint";
const FRICTION_WIDGET_KEY = "harness-friction";

// ─── exec + state plumbing ─────────────────────────────────────────────────

/** Wrap pi.exec in the ExecFn shape detect/drift expect (no cwd option in pi.exec). */
function makeExec(pi: ExtensionAPI): ExecFn {
  return (cmd, args, opts) =>
    pi.exec(cmd, args, { signal: opts?.signal, timeout: opts?.timeout });
}

/**
 * Per-cwd drift cache, refreshed at session_start and before each Gate B′
 * check. Kept module-local (not in session.ts) because it mirrors external
 * repo state, not per-session flags.
 */
const driftCache = new Map<string, DriftRecord[]>();

/** Parse the newest `created_at` (ms epoch) out of `query intakes` output. */
function parseNewestIntakeAt(stdout: string): number {
  let newest = 0;
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^\s*\d+\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
    if (!m) continue;
    const t = Date.parse(`${m[1]}T${m[2]}`);
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return newest;
}

/** Count data rows of `query intakes` (lines beginning with an id number). */
function countIntakeRows(stdout: string): number {
  let n = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (/^\s*\d+\s+\d{4}-\d{2}-\d{2}/.test(line)) n++;
  }
  return n;
}

// ─── footer + widgets ──────────────────────────────────────────────────────

/** Render the footer string. P6 (US-018): shows the ONE next-required-action
 *  (or `ready`) sourced from pure `readiness()` — no vanity counts (those live
 *  in the dashboard Stats tab). Exported for unit tests. */
export function renderFooter(
  state: HarnessState,
  drift: DriftRecord[],
  session: { intakeRecorded: boolean; traceRecorded: boolean },
  fg: (c: string, t: string) => string
): string {
  // detection failure → can't trust cli/db status; show a neutral dash.
  if (state.error) return fg("dim", "🪢 —");
  const r = readiness(
    { cliInstalled: state.cliInstalled, dbInitialized: state.dbInitialized },
    { intakeRecorded: session.intakeRecorded, traceRecorded: session.traceRecorded },
    drift.length
  );
  if (r.ready) return fg("accent", "🪢 ready");
  return fg("accent", "🪢 ") + fg("warning", r.nextAction!);
}

/** US-020: format the post-install notify from readiness(). Pure + testable.
 *  After a successful install the cli+db are present, so the firstUnmet step
 *  is `intake` (intake not recorded this session) → the notify hands off to
 *  the next requirement instead of the bare "installed ✓" that left users
 *  wondering why the gate still felt ineffective. */
export function installNotifyText(
  session: { intakeRecorded: boolean; traceRecorded: boolean },
  driftCount: number
): string {
  const r = readiness(
    { cliInstalled: true, dbInitialized: true }, // post-install invariant
    { intakeRecorded: session.intakeRecorded, traceRecorded: session.traceRecorded },
    driftCount
  );
  return r.nextAction
    ? `repository-harness installed — next: ${r.nextAction}`
    : "repository-harness installed — ready";
}

/** Install-hint widget lines, or undefined when fully set up.
 *  US-019: once the DB is ready the widget becomes a persistent next-action
 *  coach sourced from readiness() (it no longer vanishes), so the user always
 *  sees the next step without opening the dashboard. */
export function hintLines(
  state: HarnessState,
  drift: DriftRecord[],
  session: { intakeRecorded: boolean; traceRecorded: boolean }
): string[] | undefined {
  if (!state.cliInstalled) {
    return ["repository-harness not found in this repo.", "Run /harness to install it."];
  }
  if (!state.dbInitialized) {
    return [
      "Harness CLI is installed but the database isn't initialized.",
      "Run /harness to finish setup.",
    ];
  }
  // DB ready → coach. Pure readiness() keeps the widget in lockstep with the
  // footer (US-018) and notify/injection (US-020/021).
  const r = readiness(
    { cliInstalled: true, dbInitialized: true },
    { intakeRecorded: session.intakeRecorded, traceRecorded: session.traceRecorded },
    drift.length
  );
  return r.nextAction ? [`Harness: ${r.nextAction}.`] : undefined;
}

// ─── gate B′ (drift) ───────────────────────────────────────────────────────

/**
 * Gate B′: refuse the done/trace step while markdown↔durable drift exists.
 * Returns a block decision for a `harness-cli ... trace` tool_call.
 *
 * ALWAYS re-runs detectDrift fresh (never trusts driftCache). The gate is the
 * final keep-out before a task closes, so it must reflect the CURRENT repo,
 * not a snapshot from session_start / before_agent_start. (Trusting the cache
 * once caused a false block: the agent fixed a drift mid-turn, then the trace
 * was still blocked by the stale cache. Caught by dogfooding.)
 */
async function gateDriftOnTrace(
  cwd: string,
  exec: ExecFn,
  signal?: AbortSignal
): Promise<{ block: false } | { block: true; reason: string }> {
  const drift = await detectDrift(cwd, exec, { signal });
  driftCache.set(cwd, drift); // keep footer in sync too
  if (drift.length === 0) return { block: false };
  const { count, ids } = summarizeDrift(drift);
  return {
    block: true,
    reason:
      `Repository-harness drift gate (B′): the durable story table and the ` +
      `docs/stories/*.md packets disagree (${count} drift[s]: ${ids}). ` +
      `Sync the packet(s), then close. \`harness-cli audit\` cannot see this — ` +
      `only this gate can. (status_mismatch / orphan_markdown / orphan_durable / missing_evidence) ` +
      `Note: this gate inspects the whole bash script, so if the closing step ` +
      `is bundled with sibling commands they are blocked too — run your other ` +
      `commands first, clear the drift, then re-run the closing step alone.`,
  };
}

// ─── before_agent_start injection ──────────────────────────────────────────

export function injectionMessage(
  state: HarnessState,
  session: { intakeRecorded: boolean; traceRecorded: boolean },
  drift: DriftRecord[]
): string {
  // Harness not set up → the footer/widget cover setup; the injection has no
  // actionable counts for the agent yet, so stay quiet.
  if (!(state.cliInstalled && state.dbInitialized)) return "";

  // US-021 (OQ-2): the injection is the agent-facing per-turn surface. It leads
  // with the next-required-action from readiness() and keeps only actionable
  // nags (drift, trace). Vanity counts (intakes·stories·traces) belong in the
  // dashboard Stats tab, not here — they were the "junk" the agent skimmed.
  const lines: string[] = [];
  const r = readiness(
    { cliInstalled: true, dbInitialized: true },
    { intakeRecorded: session.intakeRecorded, traceRecorded: session.traceRecorded },
    drift.length
  );
  if (r.nextAction) {
    lines.push(`[harness] next: ${r.nextAction}.`);
  }
  if (drift.length > 0) {
    lines.push(
      `[harness] ! ${drift.length} markdown↔durable drift detected ` +
        `(${summarizeDrift(drift).ids}). audit cannot see this; sync before closing.`
    );
  }
  if (!session.traceRecorded) {
    lines.push(
      `[harness] Done Definition requires a recorded trace before this task ` +
        `is complete. No trace recorded this session. Run ` +
        `\`scripts/bin/harness-cli trace --summary … --intake <id> ` +
        `--read … --changed … --outcome …\`.`
    );
  }
  return lines.join("\n");
}

// ─── P3: /harness overlay (DESIGN §5 / §6 / §11) ───────────────────────────
//
// The single state-aware command the P1 footer/widget already promise ("Run
// /harness to install"). Two modes, routed by detect():
//   INSTALL    harness absent or db missing → confirmation wizard → runner
//   DASHBOARD  harness ready → tabbed overlay (US-010: matrix tab; US-011:
//              stats/backlog/tools; US-012: drift). Replaces the P3 STATUS
//              placeholder.
//
// The overlay is a *synchronous* component; all async work (the installer +
// init + migrate + shim on INSTALL; the `query matrix` fetch + refresh loop on
// DASHBOARD) runs in the handler, not inside the component. Live in-overlay
// async re-render is a later polish — DASHBOARD refresh re-opens via the loop.

type HarnessOverlayResult =
  | { action: "install"; flags: InstallFlags }
  | { action: "refresh" }
  | { action: "cancel" }
  | { action: "close" };

interface HarnessOverlayOpts {
  view: HarnessView;
  state: HarnessState;
  flags: InstallFlags;
  fg: FgFn;
  onDone: (result: HarnessOverlayResult) => void;
  /** DASHBOARD only: active tab. Defaults to "matrix". */
  tab?: DashboardTab;
  /** DASHBOARD only: parsed tab data (matrix + stats + backlog + tools + errors). */
  data?: DashboardData;
  /** The pi-tui TUI instance, captured so the live-tail watcher (US-016) can
   *  call `requestRender()` to re-pull `render()` from an `fs.watch` callback.
   *  Typed structurally (not via the `TUI` import) to mirror how this file
   *  treats the Component shape. Undefined in non-TUI tests / INSTALL view. */
  tui?: { requestRender(force?: boolean): void };
}

/**
 * The overlay Component. Implements the pi-tui Component shape structurally
 * (render / handleInput / invalidate) without importing the type — the factory
 * passed to ctx.ui.custom accepts it positionally.
 *
 * Keys (INSTALL): Enter/i confirm · m mode · c claude · r dry-run · d initDb ·
 * Esc cancel. DASHBOARD: 1-4 tabs · t timeline · r refresh · Esc close. Only
 * single-byte keys, so no kitty/CSI sequence handling is needed.
 */
class HarnessOverlayComponent {
  private view: HarnessView;
  private state: HarnessState;
  private flags: InstallFlags;
  private readonly fg: FgFn;
  private readonly onDone: (result: HarnessOverlayResult) => void;
  private nav: DashboardNav;
  private data: DashboardData;
  /** The pi-tui TUI (for `requestRender()` from the live-tail watcher). */
  private readonly tui?: { requestRender(force?: boolean): void };
  /** fs.watchFile listener (US-016). Held so dispose() can unwatch precisely. */
  private watchListener?: (curr: Stats, prev: Stats) => void;

  constructor(o: HarnessOverlayOpts) {
    this.view = o.view;
    this.state = o.state;
    this.flags = o.flags;
    this.fg = o.fg;
    this.onDone = o.onDone;
    this.nav = { tab: o.tab ?? "matrix", cursor: 0, drill: null };
    this.data = o.data ?? { matrix: [], stats: ZERO_STATS, backlog: [], tools: [], drift: [], timeline: [], packets: {}, errors: {} };
    this.tui = o.tui;
    // US-016: start the live tail as soon as the DASHBOARD opens (the watcher
    // is cheap; it fires for any events.jsonl append regardless of active
    // tab, and requestRender is debounced by the TUI). Skipped when the
    // initial fetch already failed (no file → nothing to tail) or when no TUI
    // is wired (tests).
    if (this.view === "dashboard") this.startTimelineWatch();
  }

  handleInput(data: string): void {
    if (this.view === "install") {
      if (isEscape(data)) {
        this.onDone({ action: "cancel" });
        return;
      }
      if (isEnter(data) || data === "i") {
        this.onDone({ action: "install", flags: this.flags });
        return;
      }
      if (data === "m") this.flags = { ...this.flags, mode: nextMode(this.flags, this.state) };
      else if (data === "c") this.flags = { ...this.flags, claude: !this.flags.claude };
      else if (data === "r") this.flags = { ...this.flags, dryRun: !this.flags.dryRun };
      else if (data === "d") this.flags = { ...this.flags, initDb: !this.flags.initDb };
      return;
    }
    // DASHBOARD — delegate the full key model to the pure reducer (US-014)
    const lens = {
      matrix: this.data.matrix.length,
      backlog: this.data.backlog.length,
      drift: this.data.drift.length,
      timeline: this.data.timeline.length,
    };
    const res = reduceDashboardNav(this.nav, data, lens);
    this.nav = res.nav;
    if (res.action === "close") this.onDone({ action: "close" });
    else if (res.action === "refresh") this.onDone({ action: "refresh" });
  }

  render(width: number): string[] {
    if (this.view === "install") {
      const plan = buildInstallPlan(this.flags, { cwd: this.state.cwd });
      return renderInstallLines(this.state, this.flags, plan, this.fg, width);
    }
    return renderDashboardLines(this.state, this.nav, this.data, this.fg, width);
  }

  invalidate(): void {
    // no cached render state
  }

  // ── US-016: live tail (.harness-observer/events.jsonl) ───────────────────
  //
  // Two seams, resolved separately:
  //  (1) Re-render from an external trigger (OQ-4, decision 0013): the pi-tui
  //      Component contract DOES support it — `TUI.requestRender()` is public
  //      and `ctx.ui.custom` hands the component the `tui`, so an async callback
  //      re-derives the tail then calls `tui.requestRender()`; `compositeOverlays`
  //      re-pulls `render(width)` fresh every pass. (`invalidate()` is NOT the
  //      lever — it is what the TUI calls ON the component, e.g. on theme change.)
  //  (2) The file-watch MECHANISM: fs.watch (FSEvents/kqueue) FREEZES pi's TUI
  //      on macOS — the kernel event-notification path conflicts with raw-mode
  //      stdin reads (Node issue #20148), wedging ALL keyboard input while a
  //      watch is armed (the exact freeze reported in dogfooding). So we use
  //      fs.watchFile instead: it stat-polls on the libuv threadpool, which is
  //      independent of the event loop / stdin and does NOT freeze the overlay.
  //      The ~1.5s poll interval is the debounce; refreshTimelineTail is an
  //      idempotent re-derivation, so a poll never duplicates or drops a row.
  //      See decision 0013 §Revision.

  /** Absolute path to the observer flow log. */
  private timelinePath(): string {
    return join(this.state.cwd, ".harness-observer", "events.jsonl");
  }

  /** Begin polling events.jsonl for live tail updates. No-op when no TUI is
   *  wired or the initial fetch already failed (file absent → nothing to tail).
   *  Uses `fs.watchFile` (stat polling), NOT `fs.watch`: the latter's
   *  FSEvents/kqueue notification path freezes pi's raw-mode stdin on macOS
   *  (Node #20148). watchFile polls on the threadpool, which is stdin-safe. */
  private startTimelineWatch(): void {
    if (!LIVE_TAIL_ENABLED) return; // see kill-switch note above
    if (!this.tui) return;
    if (this.data.errors.timeline) return; // initial fetch failed → nothing to tail
    const file = this.timelinePath();
    this.watchListener = (curr: Stats, prev: Stats) => {
      // watchFile fires once at start with curr === prev; skip no-ops. Re-derive
      // only when the file actually changed (size or mtime).
      if (curr.size === prev.size && curr.mtimeMs === prev.mtimeMs) return;
      void this.refreshTimelineTail();
    };
    try {
      watchFile(file, { persistent: false, interval: 1500 }, this.watchListener);
    } catch {
      this.watchListener = undefined; // belt-and-suspenders — keep initial render
    }
  }

  /** Re-derive the timeline tail from the current file contents and ask the TUI
   *  to re-render. Pure re-derivation via `readTimelineTail` ⇒ no duplicate or
   *  dropped rows even when the watcher coalesces, re-fires, or the file shrank.
   *  On read failure (file deleted / permissions mid-watch) degrades to a dim
   *  message. Public so the integration test can drive one update deterministically
   *  without depending on `fs.watch` timing. */
  async refreshTimelineTail(): Promise<void> {
    try {
      const text = await readFile(this.timelinePath(), "utf8");
      const errors = { ...this.data.errors };
      delete errors.timeline; // recovered from a prior transient error
      this.data = { ...this.data, timeline: readTimelineTail(text), errors };
    } catch {
      this.degradeTimeline();
      return;
    }
    this.tui?.requestRender();
  }

  /** Mark the timeline tab degraded (watcher/read failure) and re-render. */
  private degradeTimeline(): void {
    this.data = {
      ...this.data,
      errors: { ...this.data.errors, timeline: "watch" },
    };
    this.tui?.requestRender();
  }

  dispose(): void {
    // US-016: stop polling events.jsonl. The TUI calls dispose() on every close
    // path (Esc / refresh / install — verified in pi-coding-agent
    // interactive-mode.js showExtensionCustom.close), so the poller never
    // outlives the overlay. unwatchFile(listener) removes just our listener.
    if (this.watchListener) {
      try {
        unwatchFile(this.timelinePath(), this.watchListener);
      } catch {
        // best-effort — must not throw out of dispose
      }
      this.watchListener = undefined;
    }
  }
}

/**
 * Execute the confirmed install plan step by step. Each step emits a progress
 * notify; the first non-zero exit (or thrown exec) stops the run. The "shim"
 * step is a file write, not a shell command. Returns ok=false + the failing
 * step label on failure.
 */
async function runInstallPlan(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  plan: InstallStep[]
): Promise<{ ok: boolean; failedLabel?: string }> {
  for (const step of plan) {
    if (ctx.signal?.aborted) return { ok: false, failedLabel: "aborted" };

    if (step.kind === "shim") {
      try {
        const agentsPath = join(ctx.cwd, "AGENTS.md");
        const existing = await readFile(agentsPath, "utf8").catch(() => "");
        const insertion = buildShimInsertion(existing);
        if (insertion) {
          await writeFile(agentsPath, existing + insertion, "utf8");
          ctx.ui.notify(`✓ ${step.label}`, "info");
        }
      } catch (e) {
        ctx.ui.notify(`✗ ${step.label}: ${(e as Error).message}`, "error");
        return { ok: false, failedLabel: step.label };
      }
      continue;
    }

    ctx.ui.notify(`▶ ${step.label}…`, "info");
    try {
      const res = await pi.exec(step.command, step.args, {
        cwd: ctx.cwd,
        signal: ctx.signal,
        timeout: step.kind === "installer" ? 180_000 : 60_000,
      });
      if (res.code !== 0) {
        const detail = (res.stderr || res.stdout || "").trim().slice(0, 500);
        ctx.ui.notify(`✗ ${step.label} (exit ${res.code}). ${detail}`, "error");
        return { ok: false, failedLabel: step.label };
      }
    } catch (e) {
      ctx.ui.notify(`✗ ${step.label}: ${(e as Error).message}`, "error");
      return { ok: false, failedLabel: step.label };
    }
  }
  return { ok: true };
}

/** Fetch + parse `query matrix --numeric` for the DASHBOARD view. Best-effort:
 *  any failure (missing CLI, non-zero exit, thrown exec) yields [] so the tab
 *  degrades to a dim empty-state row, never throws out of the overlay. */
async function fetchMatrix(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): Promise<MatrixRow[]> {
  try {
    const bin = cliBinaryPath(ctx.cwd);
    const res = await pi.exec(bin, ["query", "matrix", "--numeric"], {
      cwd: ctx.cwd,
      signal: ctx.signal,
      timeout: 5_000,
    });
    return res.code === 0 ? parseMatrixNumeric(res.stdout) : [];
  } catch {
    return [];
  }
}

/** Fetch + parse `query stats`. Returns null on any failure (caller records an
 *  error so the stats tab degrades to a dim error row, never throws). */
async function fetchStatsCounts(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): Promise<StatsCounts | null> {
  try {
    const bin = cliBinaryPath(ctx.cwd);
    const res = await pi.exec(bin, ["query", "stats"], {
      cwd: ctx.cwd,
      signal: ctx.signal,
      timeout: 5_000,
    });
    if (res.code !== 0) return null;
    return parseStats(res.stdout);
  } catch {
    return null;
  }
}

/** Fetch + parse `query backlog --open`. Returns null on failure (distinct from
 *  a valid empty `[]` → "no open backlog items"). */
async function fetchBacklogRows(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): Promise<BacklogRow[] | null> {
  try {
    const bin = cliBinaryPath(ctx.cwd);
    const res = await pi.exec(bin, ["query", "backlog", "--open"], {
      cwd: ctx.cwd,
      signal: ctx.signal,
      timeout: 5_000,
    });
    if (res.code !== 0) return null;
    return parseBacklogOpen(res.stdout);
  } catch {
    return null;
  }
}

/** Fetch + parse `query tools --json` (native JSON). Returns null on failure. */
async function fetchToolRows(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): Promise<ToolRow[] | null> {
  try {
    const bin = cliBinaryPath(ctx.cwd);
    const res = await pi.exec(bin, ["query", "tools", "--json"], {
      cwd: ctx.cwd,
      signal: ctx.signal,
      timeout: 5_000,
    });
    if (res.code !== 0) return null;
    return parseToolsJson(res.stdout);
  } catch {
    return null;
  }
}

/** Fetch drift records for the Drift tab (US-012). `detectDrift` reads
 *  docs/stories/*.md + runs `query matrix` itself; on exec failure it degrades
 *  to a synthetic "(query matrix failed)" record, which we map to null so the
 *  tab renders a dim error row (consistent with the other query tabs). */
async function fetchDrift(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): Promise<DriftRecord[] | null> {
  try {
    const recs = await detectDrift(ctx.cwd, makeExec(pi), { signal: ctx.signal });
    const failed =
      recs.length === 1 && recs[0]?.storyId === "(query matrix failed)";
    return failed ? null : recs;
  } catch {
    return null;
  }
}

/** Fetch story packet files (`docs/stories/US-NNN-*.md`) for the story detail
 *  pane (US-014). Reads filename + raw text per story; any failure (missing
 *  dir, read error) yields {} so the story detail degrades to "no packet". */
async function fetchPackets(
  _pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): Promise<Record<string, PacketRef>> {
  try {
    const dir = join(ctx.cwd, "docs", "stories");
    const entries = await readdir(dir);
    const out: Record<string, PacketRef> = {};
    for (const name of entries) {
      const m = name.match(/^(US-\d+)/);
      if (!m) continue;
      const id = m[1]!;
      const text = await readFile(join(dir, name), "utf8");
      out[id] = { filename: name, text };
    }
    return out;
  } catch {
    return {};
  }
}

/** Read + parse `.harness-observer/events.jsonl` for the TIMELINE tab (US-015).
 *  Unlike the query tabs this is a direct file read (the observer is a
 *  companion, not an inbound harness tool). Returns null on any failure
 *  (file absent / unreadable) so the tab degrades to a dim message, never
 *  throws. Re-derives the tail via `readTimelineTail` — the same seam the
 *  live-tail watcher uses (US-016) — so the initial fetch and live updates
 *  can never diverge. */
async function fetchTimeline(
  _pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): Promise<TimelineEvent[] | null> {
  try {
    const file = join(ctx.cwd, ".harness-observer", "events.jsonl");
    const text = await readFile(file, "utf8");
    return readTimelineTail(text);
  } catch {
    return null;
  }
}

/** Fetch all DASHBOARD tab data in parallel and build the DashboardData the
 *  renderer consumes. A null result on a tab records an error so that tab
 *  renders a dim error row; `matrix` keeps US-010's empty-on-failure shape. */
async function fetchDashboardData(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): Promise<DashboardData> {
  const [matrix, stats, backlog, tools, drift, packets, timeline] = await Promise.all([
    fetchMatrix(pi, ctx),
    fetchStatsCounts(pi, ctx),
    fetchBacklogRows(pi, ctx),
    fetchToolRows(pi, ctx),
    fetchDrift(pi, ctx),
    fetchPackets(pi, ctx),
    fetchTimeline(pi, ctx),
  ]);
  const errors: Partial<Record<DashboardTab, string>> = {};
  if (stats === null) errors.stats = "stats";
  if (backlog === null) errors.backlog = "backlog";
  if (tools === null) errors.tools = "tools";
  if (drift === null) errors.drift = "drift";
  if (timeline === null) errors.timeline = "timeline";
  return {
    matrix,
    stats: stats ?? ZERO_STATS,
    backlog: backlog ?? [],
    tools: tools ?? [],
    drift: drift ?? [],
    timeline: timeline ?? [],
    packets,
    errors,
  };
}

/** The /harness command handler: route → overlay → (on confirm) run + refresh. */
async function handleHarnessCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): Promise<void> {
  const exec = makeExec(pi);
  let state: HarnessState;
  try {
    state = await detectHarnessCached(ctx.cwd, exec, { signal: ctx.signal });
  } catch {
    state = {
      cwd: ctx.cwd,
      cliInstalled: false,
      cliVersion: null,
      dbInitialized: false,
      shimPresent: false,
      claudeShimPresent: false,
      observerInstalled: false,
    };
  }

  const view = routeView(state);

  // Non-TUI / no dialog UI: no overlay. Surface a one-line status and stop.
  if (ctx.mode !== "tui" || !ctx.hasUI) {
    ctx.ui.notify(
      view === "install"
        ? "repository-harness not installed. Run /harness in interactive mode to install."
        : `repository-harness ready (cli ${state.cliVersion ?? "?"}). Open /harness in interactive mode for details.`,
      "info"
    );
    return;
  }

  const { theme } = ctx.ui;
  const fg: FgFn = (c, t) => theme.fg(c as never, t);
  const flags: InstallFlags = { ...DEFAULT_FLAGS, mode: initialMode(state) };

  // DASHBOARD: fetch all tab data, open the overlay, and loop on refresh
  // (re-fetch + re-open). INSTALL: single overlay, then runInstallPlan.
  if (view === "dashboard") {
    let result: HarnessOverlayResult;
    do {
      const data = await fetchDashboardData(pi, ctx);
      result = await ctx.ui.custom<HarnessOverlayResult>(
        (tui, _theme, _kb, done) =>
          new HarnessOverlayComponent({ view, state, flags, fg, onDone: done, data, tui }),
        { overlay: true, overlayOptions: { width: "76%", margin: 2 } }
      );
    } while (result.action === "refresh");
    return;
  }

  const result = await ctx.ui.custom<HarnessOverlayResult>(
    (_tui, _theme, _kb, done) =>
      new HarnessOverlayComponent({ view, state, flags, fg, onDone: done }),
    { overlay: true, overlayOptions: { width: "76%", margin: 2 } }
  );

  if (result?.action === "install") {
    const plan = buildInstallPlan(result.flags, { cwd: ctx.cwd });
    const outcome = await runInstallPlan(pi, ctx, plan);
    if (outcome.ok) {
      invalidateCache(ctx.cwd);
      // re-detect so the footer flips to the live state
      try {
        const fresh = await detectHarnessCached(ctx.cwd, exec, { signal: ctx.signal });
        const session = getSession(ctx.cwd);
        ctx.ui.setStatus(
          STATUS_KEY,
          renderFooter(fresh, driftCache.get(ctx.cwd) ?? [], session, fg)
        );
      } catch {
        // footer refresh is best-effort
      }
      const session = getSession(ctx.cwd);
      try {
        const fresh = await detectHarnessCached(ctx.cwd, exec, { signal: ctx.signal });
        ctx.ui.setStatus(
          STATUS_KEY,
          renderFooter(fresh, driftCache.get(ctx.cwd) ?? [], session, fg)
        );
      } catch {
        // footer refresh is best-effort
      }
      ctx.ui.notify(
        installNotifyText(session, (driftCache.get(ctx.cwd) ?? []).length),
        "info"
      );
    }
  }
}

// ─── entrypoint ────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // P3: the /harness command the footer promises (install wizard or status).
  pi.registerCommand("harness", {
    description: "Open repository-harness (install wizard or status)",
    handler: (_args, ctx) => handleHarnessCommand(pi, ctx),
  });
  // session_start: detect, seed baselines, render footer + widgets.
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) {
      // still seed session state in non-UI modes so the gates work in -p mode
    }
    const exec = makeExec(pi);
    let state: HarnessState;
    try {
      state = await detectHarnessCached(ctx.cwd, exec, { signal: ctx.signal });
    } catch {
      state = {
        cwd: ctx.cwd,
        cliInstalled: false,
        cliVersion: null,
        dbInitialized: false,
        shimPresent: false,
        claudeShimPresent: false,
        observerInstalled: false,
      };
    }

    // seed session baselines + intake grace flag from durable layer
    if (state.cliInstalled && state.dbInitialized) {
      const bin = cliBinaryPath(ctx.cwd);
      try {
        const intakesRes = await exec(bin, ["query", "intakes"], {
          signal: ctx.signal,
          timeout: 5000,
        });
        const newestAt =
          intakesRes.code === 0 ? parseNewestIntakeAt(intakesRes.stdout) : 0;
        const intakeCount =
          intakesRes.code === 0 ? countIntakeRows(intakesRes.stdout) : 0;
        const traceCount = state.stats?.traces ?? 0;
        seedSession(ctx.cwd, intakeCount, traceCount, newestAt);
      } catch {
        seedSession(ctx.cwd, state.stats?.intakes ?? 0, state.stats?.traces ?? 0, 0);
      }
    } else {
      seedSession(ctx.cwd, 0, 0, 0);
    }

    // drift snapshot for the footer
    let drift: DriftRecord[] = [];
    if (state.cliInstalled && state.dbInitialized) {
      try {
        drift = await detectDrift(ctx.cwd, exec, { signal: ctx.signal });
        driftCache.set(ctx.cwd, drift);
      } catch {
        drift = [];
      }
    }

    if (ctx.hasUI) {
      const { theme } = ctx.ui;
      const fg = (c: string, t: string) => theme.fg(c as never, t);
      const session = getSession(ctx.cwd);
      ctx.ui.setStatus(STATUS_KEY, renderFooter(state, drift, session, fg));

      const hint = hintLines(state, drift, session);
      ctx.ui.setWidget(WIDGET_KEY, hint, { placement: "belowEditor" });

      ctx.ui.setWidget(FRICTION_WIDGET_KEY, undefined);
    }

    void cliBinaryPath(ctx.cwd); // keep public-surface reference for P3
  });

  // tool_call: Gate A / A′ (write/edit/bash) + Gate B′ (drift on trace).
  pi.on("tool_call", async (event, ctx) => {
    const state: HarnessState = await detectHarnessCached(ctx.cwd, makeExec(pi), {
      signal: ctx.signal,
    }).catch(() => ({
      cwd: ctx.cwd,
      cliInstalled: false,
      cliVersion: null,
      dbInitialized: false,
      shimPresent: false,
      claudeShimPresent: false,
      observerInstalled: false,
    }));

    // Gate B′ — drift blocks the done/trace step (bash only)
    if (
      event.toolName === "bash" &&
      isHarnessTraceCall((event.input as { command?: string }).command)
    ) {
      const d = await gateDriftOnTrace(ctx.cwd, makeExec(pi), ctx.signal).catch(
        () => ({ block: false } as const)
      );
      if (d.block) return d;
    }

    // Gate A / A′
    const decision = decideGateA(
      event.toolName,
      { command: (event.input as { command?: string }).command, path: (event.input as { path?: string }).path },
      { cliInstalled: state.cliInstalled, dbInitialized: state.dbInitialized },
      getSession(ctx.cwd)
    );
    if (decision.block) return decision;

    // (type-narrow sanity; keeps isToolCallEventType in the import graph and
    // documents which built-ins we reason about.)
    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      // pass-through; decision already made above
    }
  });

  // tool_result: clear intake/trace gates on success; Gate C on bash failure.
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    const input = event.input as { command?: string };
    const session = getSession(ctx.cwd);

    if (!event.isError) {
      if (isHarnessIntakeCall(input.command)) {
        session.intakeRecorded = true;
      }
      if (isHarnessTraceCall(input.command)) {
        session.traceRecorded = true;
      }
    } else if (ctx.hasUI) {
      // Gate C — friction prompt on failed bash (non-blocking widget)
      ctx.ui.setWidget(FRICTION_WIDGET_KEY, [
        "Hit friction? Record it so the loop improves:",
        "  scripts/bin/harness-cli backlog add --title \"…\" --pain \"…\" [--risk tiny|normal|high-risk]",
      ], { placement: "belowEditor" });
    }

    // refresh footer so the badge flips as soon as the gate clears
    if (ctx.hasUI) {
      try {
        const state = await detectHarnessCached(ctx.cwd, makeExec(pi), {
          signal: ctx.signal,
        });
        const { theme } = ctx.ui;
        const fg = (c: string, t: string) => theme.fg(c as never, t);
        ctx.ui.setStatus(
          STATUS_KEY,
          renderFooter(state, driftCache.get(ctx.cwd) ?? [], session, fg)
        );
      } catch {
        // footer refresh is best-effort
      }
    }
  });

  // before_agent_start: refresh counts, re-render footer, inject nag + state.
  pi.on("before_agent_start", async (_event, ctx) => {
    const exec = makeExec(pi);
    let state: HarnessState;
    try {
      state = await detectHarnessCached(ctx.cwd, exec, { signal: ctx.signal });
    } catch {
      return;
    }
    if (!state.cliInstalled || !state.dbInitialized) return;

    // refresh durable counts (catches human/external intake + trace)
    try {
      const bin = cliBinaryPath(ctx.cwd);
      const intakesRes = await exec(bin, ["query", "intakes"], {
        signal: ctx.signal,
        timeout: 5000,
      });
      if (intakesRes.code === 0) {
        refreshFromCounts(ctx.cwd, countIntakeRows(intakesRes.stdout), state.stats?.traces ?? 0);
      }
    } catch {
      // best-effort refresh
    }

    const session = getSession(ctx.cwd);

    // refresh drift snapshot (cheap; reused by footer + injection)
    let drift = driftCache.get(ctx.cwd) ?? [];
    try {
      drift = await detectDrift(ctx.cwd, exec, { signal: ctx.signal });
      driftCache.set(ctx.cwd, drift);
    } catch {
      // keep stale drift; footer degrades
    }

    if (ctx.hasUI) {
      const { theme } = ctx.ui;
      const fg = (c: string, t: string) => theme.fg(c as never, t);
      ctx.ui.setStatus(STATUS_KEY, renderFooter(state, drift, session, fg));
    }

    const msg = injectionMessage(state, session, drift);
    if (msg) {
      return {
        message: { customType: "harness", content: msg, display: true },
      };
    }
  });
}
