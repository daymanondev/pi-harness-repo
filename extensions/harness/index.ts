// index.ts — pi-harness entrypoint (P1: detection + passive footer/widget).
//
// Implements DESIGN.md §3 (detection) and §4 (footer + widget). Later phases
// add the `/harness` overlay (§5), dashboard (§7), timeline (§8), and the
// enforcement gates (§9.2).
//
// What this file owns in P1:
//   - on session_start, detect harness state for ctx.cwd
//   - render a passive footer via ctx.ui.setStatus("harness", ...)
//     (composes with pi-powerline-footer's customItems contract)
//   - render a "harness-hint" widget below the editor when the harness is
//     absent or its db is missing
//
// Guard: ctx.hasUI (works in TUI + RPC; no-op in print/json). Failure of any
// probe is captured in state.error and the footer degrades — this handler
// never throws.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  detectHarnessCached,
  cliBinaryPath,
  type ExecFn,
  type HarnessState,
} from "./detect.js";

const STATUS_KEY = "harness";
const WIDGET_KEY = "harness-hint";

/**
 * Wrap pi.exec in the minimal ExecFn shape detect.ts expects, bound to the
 * session cwd via absolute binary path resolution (pi.exec has no cwd option).
 */
function makeExec(pi: ExtensionAPI): ExecFn {
  return (cmd, args, opts) =>
    pi.exec(cmd, args, { signal: opts?.signal, timeout: opts?.timeout });
}

/** Render the footer string for a detected state. */
function renderFooter(state: HarnessState, fg: (c: string, t: string) => string): string {
  if (state.cliInstalled && state.dbInitialized && state.stats) {
    const s = state.stats;
    return (
      fg("accent", "🪢 ") +
      fg("dim", `${s.stories} stories · ${s.traces} traces · ${s.backlog_items} backlog`)
    );
  }
  if (state.error) {
    return fg("dim", "🪢 —");
  }
  if (!state.cliInstalled) {
    return fg("warning", "🪢 no harness");
  }
  // cli present but db missing (or stats unavailable)
  return fg("warning", "🪢 cli present, db missing");
}

/** Widget lines for the install/finish-setup hint. Empty when fully installed. */
function hintLines(state: HarnessState): string[] | undefined {
  if (state.cliInstalled && state.dbInitialized) return undefined;
  if (!state.cliInstalled) {
    return [
      "repository-harness not found in this repo.",
      "Run /harness to install it.",
    ];
  }
  return [
    "Harness CLI is installed but the database isn't initialized.",
    "Run /harness to finish setup.",
  ];
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return; // no-op in print/json modes
    const { theme } = ctx.ui;
    const fg = (c: string, t: string) => theme.fg(c as never, t);

    let state: HarnessState;
    try {
      state = await detectHarnessCached(ctx.cwd, makeExec(pi), { signal: ctx.signal });
    } catch (e) {
      // Detection must never break the session. Render a muted footer and stop.
      ctx.ui.setStatus(STATUS_KEY, fg("dim", "🪢 —"));
      return;
    }

    ctx.ui.setStatus(STATUS_KEY, renderFooter(state, fg));

    const hint = hintLines(state);
    if (hint) {
      ctx.ui.setWidget(WIDGET_KEY, hint, { placement: "belowEditor" });
    } else {
      // Clear any stale hint from a prior session in the same process.
      ctx.ui.setWidget(WIDGET_KEY, undefined);
    }

    // Reference the resolved binary path so it stays in the module's public
    // surface for the /harness install view (P3) without a second export.
    void cliBinaryPath(ctx.cwd);
  });
}
