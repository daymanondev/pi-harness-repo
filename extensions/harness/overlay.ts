// overlay.ts — pure `/harness` router + INSTALL view logic (DESIGN §5, §6, §11 P3).
//
// Pure contract (same as detect.ts / gates.ts / drift.ts): imports NO pi types
// and NO pi runtime. Theming is injected as `fg(color, text)` — exactly the
// shape index.ts already passes to renderFooter — so every function below is
// unit-testable with a stub fg.
//
// Why key-matching + ANSI width live here (instead of importing
// @earendil-works/pi-tui): that package is a transitive dependency nested
// under @earendil-works/pi-coding-agent and does NOT resolve from this
// package's root (tsc reports TS2307). Rather than add a direct dependency,
// overlay.ts stays self-contained. The wizard only needs Esc / Enter / single
// letters, so a tiny matcher suffices; ANSI-aware width is needed to align the
// right border because `fg` injects SGR escape codes.
//
// The split: this module is the unit-tested brain (route → plan → render).
// index.ts owns the impure overlay lifecycle (command registration, the
// Component class, pi.exec of each install step, footer/cache refresh).

import { cliBinaryPath, type HarnessState } from "./detect.js";

// ─── views + modes ─────────────────────────────────────────────────────────

export type HarnessView = "install" | "dashboard";
export type InstallMode = "fresh" | "merge" | "override";
export type FgFn = (color: string, text: string) => string;

export interface InstallFlags {
  mode: InstallMode;
  /** Also add the Claude shim (--claude). */
  claude: boolean;
  /** Pass --dry-run (installer only; skips init/migrate/shim). */
  dryRun: boolean;
  /** Run `harness-cli init` + `migrate` after the installer. */
  initDb: boolean;
}

export const DEFAULT_FLAGS: InstallFlags = {
  mode: "fresh",
  claude: false,
  dryRun: false,
  initDb: true,
};

// ─── §13.1 installer source ────────────────────────────────────────────────
//
// See docs/decisions/0011-installer-source-pinning.md. v1 pins to `main` with
// a cache-busting query (matches the installer's documented curl line and
// DESIGN §6.3). The ref is a single constant so a verified release tag can be
// swapped in one place without touching the command builder.

export const INSTALLER_REF = "main";
const INSTALLER_OWNER = "hoangnb24";
const INSTALLER_REPO = "repository-harness";
const INSTALLER_SCRIPT = "scripts/install-harness.sh";

/** Raw install-harness.sh URL for the pinned ref. */
export function installerUrl(): string {
  return `https://raw.githubusercontent.com/${INSTALLER_OWNER}/${INSTALLER_REPO}/${INSTALLER_REF}/${INSTALLER_SCRIPT}`;
}

// ─── AGENTS.md shim (safety net; the installer normally writes this) ────────

export const HARNESS_BEGIN = "<!-- HARNESS:BEGIN -->";
export const HARNESS_END = "<!-- HARNESS:END -->";

/**
 * Minimal AGENTS.md harness shim. The official installer writes the full block;
 * this is the idempotent fallback so detect.ts `shimPresent` flips true even if
 * a future installer revision changes what it writes.
 */
export const HARNESS_SHIM_BLOCK = `${HARNESS_BEGIN}
## Harness

This repo uses repository-harness. Before work, read \`docs/HARNESS.md\` and run
\`scripts/bin/harness-cli query matrix\` (macOS/Linux) or
\`.\\scripts\\bin\\harness-cli.exe query matrix\` (Windows).
${HARNESS_END}`;

/**
 * Return the text to append to AGENTS.md so the harness shim marker is present,
 * or `null` if it is already there (idempotent). Caller writes the file.
 */
export function buildShimInsertion(existing: string): string | null {
  if (existing.includes(HARNESS_BEGIN)) return null;
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n\n" : "";
  return `${prefix}${HARNESS_SHIM_BLOCK}\n`;
}

// ─── router + protected-path awareness ─────────────────────────────────────

/**
 * Top-level router (DESIGN §5). INSTALL when harness is absent or its database
 * is missing; DASHBOARD otherwise (US-010). `shimPresent` alone does not route
 * to install — the harness still works without the shim, it is a minor gap.
 */
export function routeView(state: HarnessState): HarnessView {
  if (!state.cliInstalled || !state.dbInitialized) return "install";
  return "dashboard";
}

/**
 * §6.2 protected-path awareness. The installer refuses a *fresh* install when
 * AGENTS.md/docs/scripts already exist; the overlay mirrors that by disabling
 * modes the installer would reject, so the user cannot pick an invalid combo.
 *
 * Signal: `shimPresent` (the `<!-- HARNESS:BEGIN -->` marker in AGENTS.md) is a
 * reliable proxy for "something already adopted harness here".
 */
export function enabledModes(state: HarnessState): Record<InstallMode, boolean> {
  const blocked = state.shimPresent;
  return { fresh: !blocked, merge: blocked, override: blocked };
}

/** Pick a valid initial mode for the detected state (fresh preferred). */
export function initialMode(state: HarnessState): InstallMode {
  const en = enabledModes(state);
  if (en.fresh) return "fresh";
  if (en.merge) return "merge";
  return "override";
}

/** Cycle to the next enabled install mode (skips disabled modes). */
export function nextMode(flags: InstallFlags, state: HarnessState): InstallMode {
  const en = enabledModes(state);
  const order: InstallMode[] = ["fresh", "merge", "override"];
  const start = order.indexOf(flags.mode);
  for (let i = 1; i <= order.length; i++) {
    const candidate = order[(start + i) % order.length]!;
    if (en[candidate]) return candidate;
  }
  return flags.mode; // none enabled (shouldn't happen) — stay put
}

// ─── installer command + install plan ──────────────────────────────────────

export interface InstallStep {
  label: string;
  /** "shim" is a file write handled by the executor, not a shell command. */
  kind: "installer" | "init" | "migrate" | "shim";
  command: string;
  args: string[];
}

export interface PlanOptions {
  /** Target repo (passed as exec cwd by the runner). */
  cwd: string;
}

/**
 * The `curl … | bash` installer invocation for the given flags. Flags are
 * controlled enum values, so interpolating them into the script is safe.
 */
export function buildInstallerCommand(flags: InstallFlags): {
  command: string;
  args: string[];
} {
  const flagArgs: string[] = [];
  if (flags.mode === "merge") flagArgs.push("--merge", "--yes");
  else if (flags.mode === "override") flagArgs.push("--override", "--yes");
  else flagArgs.push("--yes");
  if (flags.claude) flagArgs.push("--claude");
  if (flags.dryRun) flagArgs.push("--dry-run");
  // `?$(date +%s)` cache-busts the raw.githubusercontent fetch (DESIGN §6.3).
  const script = `curl -fsSL "${installerUrl()}?$(date +%s)" | bash -s -- ${flagArgs.join(" ")}`;
  return { command: "bash", args: ["-c", script] };
}

/**
 * The ordered step sequence the runner executes after the user confirms.
 * Pure + data-only: index.ts walks this list, exec'ing each step (or writing
 * the shim for kind "shim"), stopping at the first failure.
 *
 * Dry-run = installer only (no init/migrate/shim), matching the installer's own
 * --dry-run semantics.
 */
export function buildInstallPlan(flags: InstallFlags, opts: PlanOptions): InstallStep[] {
  const cliBin = cliBinaryPath(opts.cwd);
  const steps: InstallStep[] = [];

  const installer = buildInstallerCommand(flags);
  steps.push({
    label: flags.dryRun
      ? "Run installer (dry-run — no changes)"
      : `Run repository-harness installer (${flags.mode})`,
    kind: "installer",
    command: installer.command,
    args: installer.args,
  });

  if (flags.dryRun) return steps;

  if (flags.initDb) {
    steps.push({ label: "Initialise database (harness-cli init)", kind: "init", command: cliBin, args: ["init"] });
    steps.push({ label: "Apply migrations (harness-cli migrate)", kind: "migrate", command: cliBin, args: ["migrate"] });
  }
  // Idempotent safety net: guarantees the AGENTS.md shim marker exists even if
  // the installer's AGENTS.md output changes. Executor writes only if absent.
  steps.push({ label: "Ensure AGENTS.md harness shim", kind: "shim", command: "__shim__", args: [] });
  return steps;
}

// ─── tiny terminal helpers (no @earendil-works/pi-tui dependency) ───────────

/** Strip SGR (`\x1b[…m`) escapes and return the visible length. */
const SGR_RE = /\x1b\[[0-9;]*m/g;
export function ansiVisibleWidth(s: string): number {
  // Good enough for the wizard's ASCII content (labels, paths, counts). Does not
  // account for wide CJK glyphs — acceptable for v1; documented for P4 polish.
  return s.replace(SGR_RE, "").length;
}

/** Truncate an ANSI-styled string to `maxVis` visible columns, preserving
 *  embedded SGR color codes (which have zero visible width). Keeps the box
 *  right-border aligned even when a path or hint line overflows. */
export function truncateAnsi(s: string, maxVis: number): string {
  let out = "";
  let vis = 0;
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "\x1b") {
      const m = s.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (vis >= maxVis) break;
    out += ch;
    vis++;
    i++;
  }
  return out;
}

/** Truncate to `len` visible columns, then pad with trailing spaces to `len`. */
export function padRight(s: string, len: number): string {
  const trunc = truncateAnsi(s, len);
  const vis = ansiVisibleWidth(trunc);
  return vis >= len ? trunc : trunc + " ".repeat(len - vis);
}

/** Esc (bare). Kitty/CSI sequences are multi-byte and start with ESC too, but
 *  the wizard uses no arrow keys, so a bare ESC is unambiguous as "cancel". */
export function isEscape(data: string): boolean {
  return data === "\u001b";
}

/** Enter / Return. */
export function isEnter(data: string): boolean {
  return data === "\r" || data === "\n";
}

// ─── render (pure; theming injected) ───────────────────────────────────────

export const BOX_WIDTH = 76;

/** Render a rounded box of fixed width around `content` lines. */
export function box(title: string, content: string[], fg: FgFn, width = BOX_WIDTH): string[] {
  const innerW = width - 2;
  const top = fg("border", `╭${"─".repeat(innerW)}╮`);
  const bottom = fg("border", `╰${"─".repeat(innerW)}╯`);
  const side = fg("border", "│");
  const row = (text: string) => `${side}${padRight(text, innerW)}${side}`;
  const out: string[] = [top, row(` ${fg("accent", title)}`)];
  for (const line of content) out.push(row(line));
  out.push(bottom);
  return out;
}

const yesNo = (b: boolean) => (b ? "present" : "absent");
const okNo = (b: boolean) => (b ? "ok" : "missing");

/**
 * Render the INSTALL confirmation view. Pure: pass an identity `fg`
 * (`(c, t) => t`) in tests to assert plain-text substrings.
 */
export function renderInstallLines(
  state: HarnessState,
  flags: InstallFlags,
  plan: InstallStep[],
  fg: FgFn,
  width = BOX_WIDTH
): string[] {
  const w = Math.max(60, Math.min(width, BOX_WIDTH));
  const content: string[] = [];
  const dim = (t: string) => fg("dim", t);
  const warn = (t: string) => fg("warning", t);

  content.push(`${dim("Target:")} ${state.cwd}`);
  content.push("");

  content.push(dim("Detected state"));
  content.push(`  harness CLI : ${state.cliInstalled ? fg("success", yesNo(true)) : warn(yesNo(false))}`);
  content.push(`  harness.db  : ${state.dbInitialized ? fg("success", okNo(true)) : warn(okNo(false))}`);
  content.push(`  AGENTS shim : ${state.shimPresent ? fg("success", yesNo(true)) : warn(yesNo(false))}`);
  if (state.cliInstalled && state.dbInitialized) {
    content.push(`  ${warn("→ harness is already set up; nothing to install")}`);
  }
  content.push("");

  content.push(dim("Planned steps"));
  if (plan.length === 0) {
    content.push(`  ${dim("(none)")}`);
  } else {
    plan.forEach((s, i) => {
      content.push(`  ${dim(String(i + 1) + ".")} ${s.label}`);
    });
  }
  content.push("");

  const en = enabledModes(state);
  const modes: { key: InstallMode; label: string }[] = [
    { key: "fresh", label: "Fresh" },
    { key: "merge", label: "Merge" },
    { key: "override", label: "Override" },
  ];
  content.push(dim("Mode"));
  for (const m of modes) {
    const on = flags.mode === m.key;
    const marker = on ? fg("accent", "(•)") : dim("( )");
    const label = on ? fg("accent", m.label) : en[m.key] ? m.label : dim(m.label + " (n/a)");
    content.push(`  ${marker} ${label}`);
  }
  content.push("");

  const toggle = (on: boolean, label: string, hint: string) => {
    const box2 = on ? fg("success", "[x]") : dim("[ ]");
    return `  ${box2} ${on ? label : dim(label)} ${dim(hint)}`;
  };
  content.push(dim("Options"));
  content.push(toggle(flags.claude, "Also add Claude shim", "(--claude)"));
  content.push(toggle(flags.dryRun, "Dry run first", "(installer only)"));
  content.push(toggle(flags.initDb, "Then init + migrate database", "(harness-cli init | migrate)"));
  content.push("");

  content.push(
    dim("[Enter]/i install · [m] mode · [c]laude · dry-[r]un · init[d]b · [Esc] cancel")
  );
  return box("repository-harness · install", content, fg, w);
}
