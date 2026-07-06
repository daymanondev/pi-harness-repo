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
} from "@earendil-works/pi-coding-agent";
import {
  cliBinaryPath,
  detectHarnessCached,
  type ExecFn,
  type HarnessState,
} from "./detect.js";
import { decideGateA, isHarnessIntakeCall, isHarnessTraceCall } from "./gates.js";
import { detectDrift, summarizeDrift, type DriftRecord } from "./drift.js";
import {
  getSession,
  refreshFromCounts,
  seedSession,
} from "./session.js";

const STATUS_KEY = "harness";
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

/** Render the footer string. Composes stats with drift + no-trace badges. */
function renderFooter(
  state: HarnessState,
  drift: DriftRecord[],
  traceRecorded: boolean,
  fg: (c: string, t: string) => string
): string {
  if (!state.cliInstalled) return fg("warning", "🪢 no harness");
  if (!state.dbInitialized) return fg("warning", "🪢 cli present, db missing");
  if (state.error) return fg("dim", "🪢 —");

  const s = state.stats;
  const base = s
    ? fg("accent", "🪢 ") +
      fg("dim", `${s.stories} stories · ${s.traces} traces · ${s.backlog_items} backlog`)
    : fg("dim", "🪢");

  const badges: string[] = [];
  if (drift.length > 0) {
    badges.push(fg("warning", ` !${drift.length} drifted`));
  }
  if (!traceRecorded) {
    badges.push(fg("warning", " !no-trace"));
  }
  return base + badges.join("");
}

/** Install-hint widget lines, or undefined when fully set up. */
function hintLines(state: HarnessState): string[] | undefined {
  if (state.cliInstalled && state.dbInitialized) return undefined;
  if (!state.cliInstalled) {
    return ["repository-harness not found in this repo.", "Run /harness to install it."];
  }
  return [
    "Harness CLI is installed but the database isn't initialized.",
    "Run /harness to finish setup.",
  ];
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

function injectionMessage(
  state: HarnessState,
  traceRecorded: boolean,
  drift: DriftRecord[]
): string {
  const lines: string[] = [];
  if (state.cliInstalled && state.dbInitialized) {
    const s = state.stats;
    lines.push(
      `[harness] durable layer: ${s?.intakes ?? "?"} intakes · ` +
        `${s?.stories ?? "?"} stories · ${s?.traces ?? "?"} traces · ` +
        `${s?.decisions ?? "?"} decisions · ${s?.backlog_items ?? "?"} backlog.`
    );
    if (drift.length > 0) {
      lines.push(
        `[harness] ! ${drift.length} markdown↔durable drift detected ` +
          `(${summarizeDrift(drift).ids}). audit cannot see this; sync before closing.`
      );
    }
    if (!traceRecorded) {
      lines.push(
        `[harness] Done Definition requires a recorded trace before this task ` +
          `is complete. No trace recorded this session. Run ` +
          `\`scripts/bin/harness-cli trace --summary … --intake <id> ` +
          `--read … --changed … --outcome …\`.`
      );
    }
  }
  return lines.join("\n");
}

// ─── entrypoint ────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
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
      ctx.ui.setStatus(STATUS_KEY, renderFooter(state, drift, session.traceRecorded, fg));

      const hint = hintLines(state);
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
          renderFooter(state, driftCache.get(ctx.cwd) ?? [], session.traceRecorded, fg)
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
      ctx.ui.setStatus(STATUS_KEY, renderFooter(state, drift, session.traceRecorded, fg));
    }

    const msg = injectionMessage(state, session.traceRecorded, drift);
    if (msg) {
      return {
        message: { customType: "harness", content: msg, display: true },
      };
    }
  });
}
