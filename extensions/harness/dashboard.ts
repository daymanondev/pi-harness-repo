// dashboard.ts — pure DASHBOARD view for `/harness` (DESIGN §7, §11 P4).
//
// Pure contract (same as overlay.ts / detect.ts / gates.ts / drift.ts): imports
// NO pi types and NO pi runtime. Theming is injected as `fg(color, text)`; the
// box/width/ANSI helpers are reused from overlay.ts so the right border stays
// aligned when `fg` injects SGR escapes. Every function below is unit-testable
// with a stub `fg` (identity `(c, t) => t`).
//
// US-010 (tracer bullet): ships the shell + tab chrome + the proof-matrix tab
// only. Tabs 2/3/4 (stats/backlog/tools → US-011) and `t` timeline (P5) render
// as dim placeholders so the chrome is honest about what exists today.
//
// Data source: `harness-cli query matrix --numeric` — a fixed-column table with
// NO `--json` flag (open Q1, DESIGN §13.3). The parser keys off the stable
// `US-NNN` id + the trailing 4 numeric proof columns, so it tolerates
// variable-width titles (spaces, punctuation) without column-position math.
// If parsing ever proves fragile, push `--json` upstream (roadmap open Q1).

import type { HarnessState } from "./detect.js";
import { type FgFn, BOX_WIDTH, box, padRight, truncateAnsi } from "./overlay.js";

// ─── tabs ──────────────────────────────────────────────────────────────────

export type DashboardTab = "matrix" | "stats" | "backlog" | "tools" | "timeline";

/** Tab chrome definition: `key` is the single hotkey that activates the tab. */
export const DASHBOARD_TABS: { tab: DashboardTab; label: string; key: string }[] = [
  { tab: "matrix", label: "matrix", key: "1" },
  { tab: "stats", label: "stats", key: "2" },
  { tab: "backlog", label: "backlog", key: "3" },
  { tab: "tools", label: "tools", key: "4" },
  { tab: "timeline", label: "timeline", key: "t" },
];

// ─── matrix parser (`query matrix --numeric`) ──────────────────────────────

export interface MatrixRow {
  id: string;
  title: string;
  status: string;
  unit: number;
  integ: number;
  e2e: number;
  plat: number;
}

/**
 * Parse `query matrix --numeric` stdout into rows. Pure + total: any line that
 * does not match the `US-NNN … <status> <0|1> <0|1> <0|1> <0|1>` shape (headers,
 * separators, blank lines, malformed rows) is silently skipped, so a partial or
 * future-changed table never throws.
 */
export function parseMatrixNumeric(stdout: string): MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line) continue;
    // id  …title…  <status>  u i e p [evidence]
    // Title is non-greedy up to the 2+ space gap before the status word; the
    // trailing four 0/1 proof columns anchor the match against title noise.
    const m = line.match(
      /^(US-\d+)\s+(.+?)\s{2,}([a-z][a-z-]*)\s+([01])\s+([01])\s+([01])\s+([01])/
    );
    if (!m) continue;
    rows.push({
      id: m[1]!,
      title: m[2]!.trim(),
      status: m[3]!,
      unit: Number(m[4]),
      integ: Number(m[5]),
      e2e: Number(m[6]),
      plat: Number(m[7]),
    });
  }
  return rows;
}

// ─── status → color ────────────────────────────────────────────────────────

function statusColor(status: string): string {
  if (status === "implemented") return "success";
  if (status === "planned") return "accent";
  if (status === "retired") return "dim";
  return "dim"; // unknown future status — never throws
}

// ─── render ────────────────────────────────────────────────────────────────

/**
 * Render the DASHBOARD view. Pure: pass identity `fg` in tests to assert
 * plain-text substrings. `matrix` rows are only drawn on the matrix tab; the
 * other tabs render a dim "ships in …" placeholder so the chrome is honest.
 */
export function renderDashboardLines(
  state: HarnessState,
  tab: DashboardTab,
  matrix: MatrixRow[],
  fg: FgFn,
  width = BOX_WIDTH
): string[] {
  const w = Math.max(60, Math.min(width, BOX_WIDTH));
  const content: string[] = [];
  const dim = (t: string) => fg("dim", t);

  // ── header: detected state (same line the P3 STATUS view used) ──
  content.push(
    `${fg("accent", "cli")} ${state.cliVersion ?? "?"} · ` +
      `${state.dbInitialized ? fg("success", "db ok") : fg("warning", "db missing")} · ` +
      `${state.observerInstalled ? fg("success", "observer ON") : dim("observer off")}`
  );

  // ── tab strip ──
  const tabSegs = DASHBOARD_TABS.map((t) => {
    const on = t.tab === tab;
    const label = `${t.key} ${t.label}`;
    return on ? fg("accent", label) : dim(label);
  });
  content.push(tabSegs.join(dim("   ")));
  content.push("");

  // ── active tab content ──
  if (tab === "matrix") {
    content.push(...renderMatrixTab(matrix, fg, w - 2));
  } else {
    const ship: Record<Exclude<DashboardTab, "matrix">, string> = {
      stats: "US-011",
      backlog: "US-011",
      tools: "US-011",
      timeline: "P5",
    };
    content.push(dim(`(${tab} tab ships in ${ship[tab]})`));
  }
  content.push("");

  // ── footer hints ──
  content.push(dim("[1-4] tabs · [t] timeline · [r] refresh · [Esc] close"));
  return box("repository-harness · dashboard", content, fg, w);
}

/** Render the proof-matrix tab body (column header + rows). Inner width = innerW. */
function renderMatrixTab(matrix: MatrixRow[], fg: FgFn, innerW: number): string[] {
  const dim = (t: string) => fg("dim", t);
  const out: string[] = [];

  const idW = 7;
  const statusW = 12;
  const proofW = 7; // "✓ ✓ ✓ ✓" / "u i e p" — 4 marks joined by single spaces
  const gap = 2;
  const titleW = Math.max(10, innerW - (idW + statusW + proofW + 3 * gap));

  // column header
  const head =
    padRight(dim("id"), idW) +
    gapSpaces(gap) +
    padRight(dim("title"), titleW) +
    gapSpaces(gap) +
    padRight(dim("status"), statusW) +
    gapSpaces(gap) +
    dim("u i e p");
  out.push(head);

  if (matrix.length === 0) {
    out.push(dim("(no stories — query matrix returned nothing)"));
    return out;
  }

  for (const r of matrix) {
    const id = padRight(r.id, idW);
    const title = padRight(truncateAnsi(r.title, titleW), titleW);
    const status = padRight(fg(statusColor(r.status), r.status), statusW);
    const proof =
      proofMark(r.unit, fg) + " " + proofMark(r.integ, fg) + " " + proofMark(r.e2e, fg) + " " + proofMark(r.plat, fg);
    out.push(id + gapSpaces(gap) + title + gapSpaces(gap) + status + gapSpaces(gap) + proof);
  }
  return out;
}

/** A single proof mark: ✓ (success) for 1, · (dim) for 0. */
function proofMark(n: number, fg: FgFn): string {
  return n >= 1 ? fg("success", "✓") : fg("dim", "·");
}

function gapSpaces(n: number): string {
  return " ".repeat(n);
}
