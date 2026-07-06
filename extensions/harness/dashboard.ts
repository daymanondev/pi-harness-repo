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

// ─── stats parser (`query stats`) ──────────────────────────────────────────

export interface StatsCounts {
  intakes: number;
  stories: number;
  decisions: number;
  backlogItems: number;
  traces: number;
}

/** Zero-value counts, used as the default when the stats query fails. */
export const ZERO_STATS: StatsCounts = {
  intakes: 0,
  stories: 0,
  decisions: 0,
  backlogItems: 0,
  traces: 0,
};

/** The five count labels rendered in the stats tab, in display order. */
const STATS_LABELS: { key: keyof StatsCounts; label: string }[] = [
  { key: "intakes", label: "intakes" },
  { key: "stories", label: "stories" },
  { key: "decisions", label: "decisions" },
  { key: "backlogItems", label: "backlog" },
  { key: "traces", label: "traces" },
];

/**
 * Parse `query stats` stdout into counts. Pure + total: scans past the
 * `=== Harness Stats ===` title, the column-header line, and the `---` separator,
 * then reads the first line of 5+ integers. Returns null when the shape is
 * absent (caller treats null as a fetch failure → dim error row).
 */
export function parseStats(stdout: string): StatsCounts | null {
  const lines = stdout.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
  let sawHeader = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.trim().startsWith("=")) continue; // "=== Harness Stats ==="
    if (/^[-\s]+$/.test(line)) continue; // separator "------- -------"
    if (/intakes/.test(line) && /traces/.test(line)) {
      sawHeader = true;
      continue;
    }
    if (!sawHeader) continue;
    const nums = line.trim().split(/\s+/).map(Number);
    if (nums.length >= 5 && nums.every((n) => Number.isInteger(n))) {
      return {
        intakes: nums[0]!,
        stories: nums[1]!,
        decisions: nums[2]!,
        backlogItems: nums[3]!,
        traces: nums[4]!,
      };
    }
  }
  return null;
}

// ─── backlog parser (`query backlog --open`) ───────────────────────────────

export interface BacklogRow {
  id: number;
  title: string;
  status: string;
  risk: string;
}

/**
 * Parse `query backlog --open` stdout into rows. The trailing columns
 * (`predicted_impact`, `actual_outcome`) are free text with spaces, so — like
 * `parseMatrixNumeric` — we anchor on the stable leading id + the two known
 * enum vocabularies (status, risk) instead of column-position math. Lines that
 * do not match (headers, separators, blanks, malformed) are silently skipped.
 */
export function parseBacklogOpen(stdout: string): BacklogRow[] {
  const rows: BacklogRow[] = [];
  // Regex literal (not `new RegExp(template)`) so the \d/\s/\b escapes survive
  // any formatter round-trip. Vocab is inlined here, not interpolated.
  const re = /^(\d+)\s{2,}(.+?)\s{2,}(proposed|accepted|implemented|rejected)\s+(tiny|normal|high-risk)\b/;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line) continue;
    const m = line.match(re);
    if (!m) continue;
    rows.push({
      id: Number(m[1]),
      title: m[2]!.trim(),
      status: m[3]!,
      risk: m[4]!,
    });
  }
  return rows;
}

// ─── tools parser (`query tools --json`) ───────────────────────────────────

export interface ToolRow {
  name: string;
  kind: string;
  responsibility: string;
  status: string;
}

/**
 * Parse `query tools --json` stdout into rows. Unlike the other three queries,
 * `query tools` ships a native `--json` flag, so this is a structured parse —
 * no fixed-column math. Returns null on JSON failure (caller → dim error row).
 * Unknown/missing fields degrade to placeholders, never throw.
 */
export function parseToolsJson(stdout: string): ToolRow[] | null {
  let arr: unknown;
  try {
    arr = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const rows: ToolRow[] = [];
  for (const t of arr) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    rows.push({
      name: String(o.name ?? "?"),
      kind: String(o.kind ?? "-"),
      responsibility: String(o.responsibility ?? "-"),
      status: String(o.status ?? "?"),
    });
  }
  return rows;
}

// ─── dashboard data aggregate (all tabs) ───────────────────────────────────

/**
 * All parsed tab data + a per-tab error map. Renderers are pure functions of
 * this object: a present `errors[tab]` wins over the data and renders a dim
 * error row, so a failing query never throws out of the overlay. `matrix` keeps
 * US-010's empty-on-failure semantics (it has its own empty-state row).
 */
export interface DashboardData {
  matrix: MatrixRow[];
  stats: StatsCounts;
  backlog: BacklogRow[];
  tools: ToolRow[];
  errors: Partial<Record<DashboardTab, string>>;
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
 * plain-text substrings. The active tab's content is drawn from `data`; a
 * present `data.errors[tab]` renders a dim error row instead of the data, so a
 * failing query degrades cleanly. The timeline tab is still a P5 placeholder.
 */
export function renderDashboardLines(
  state: HarnessState,
  tab: DashboardTab,
  data: DashboardData,
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
  const innerW = w - 2;
  if (tab === "matrix") {
    content.push(...renderMatrixTab(data.matrix, fg, innerW));
  } else if (tab === "stats") {
    content.push(...renderStatsTab(data, fg, innerW));
  } else if (tab === "backlog") {
    content.push(...renderBacklogTab(data, fg, innerW));
  } else if (tab === "tools") {
    content.push(...renderToolsTab(data, fg, innerW));
  } else {
    // timeline — still a P5 placeholder (live tail of harness-observer).
    content.push(dim("(timeline tab ships in P5)"));
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

/** backlog status → color (vocab: proposed/accepted/implemented/rejected). */
function backlogStatusColor(status: string): string {
  if (status === "implemented") return "success";
  if (status === "accepted") return "accent";
  if (status === "proposed") return "warning";
  return "dim"; // rejected / unknown — never throws
}

/** Render the stats tab body: one labeled count per row. innerW = inner width. */
function renderStatsTab(data: DashboardData, fg: FgFn, _innerW: number): string[] {
  const dim = (t: string) => fg("dim", t);
  if (data.errors.stats) {
    return [dim("(stats unavailable — query stats failed)")];
  }
  const out: string[] = [];
  const labelW = 12;
  for (const { key, label } of STATS_LABELS) {
    out.push(padRight(dim(label), labelW) + fg("accent", String(data.stats[key])));
  }
  return out;
}

/** Render the backlog tab body (column header + open rows). innerW = inner width. */
function renderBacklogTab(data: DashboardData, fg: FgFn, innerW: number): string[] {
  const dim = (t: string) => fg("dim", t);
  if (data.errors.backlog) {
    return [dim("(backlog unavailable — query backlog failed)")];
  }
  const out: string[] = [];
  const idW = 5;
  const statusW = 12;
  const riskW = 10;
  const gap = 2;
  const titleW = Math.max(10, innerW - (idW + statusW + riskW + 3 * gap));
  out.push(
    padRight(dim("id"), idW) +
      gapSpaces(gap) +
      padRight(dim("title"), titleW) +
      gapSpaces(gap) +
      padRight(dim("status"), statusW) +
      gapSpaces(gap) +
      padRight(dim("risk"), riskW)
  );
  if (data.backlog.length === 0) {
    out.push(dim("(no open backlog items)"));
    return out;
  }
  for (const r of data.backlog) {
    out.push(
      padRight(String(r.id), idW) +
        gapSpaces(gap) +
        padRight(truncateAnsi(r.title, titleW), titleW) +
        gapSpaces(gap) +
        padRight(fg(backlogStatusColor(r.status), r.status), statusW) +
        gapSpaces(gap) +
        padRight(r.risk, riskW)
    );
  }
  return out;
}

/** Render the tools tab body (column header + equipped/missing rows). innerW = inner width. */
function renderToolsTab(data: DashboardData, fg: FgFn, innerW: number): string[] {
  const dim = (t: string) => fg("dim", t);
  if (data.errors.tools) {
    return [dim("(tools unavailable — query tools failed)")];
  }
  const out: string[] = [];
  const kindW = 9;
  const statusW = 2; // ✓ (present) / · (missing)
  const nameW = 22;
  const gap = 2;
  const respW = Math.max(10, innerW - (nameW + kindW + statusW + 3 * gap));
  out.push(
    padRight(dim("name"), nameW) +
      gapSpaces(gap) +
      padRight(dim("kind"), kindW) +
      gapSpaces(gap) +
      padRight(dim("responsibility"), respW) +
      gapSpaces(gap) +
      dim("✓")
  );
  if (data.tools.length === 0) {
    out.push(dim("(no tools registered)"));
    return out;
  }
  for (const t of data.tools) {
    out.push(
      padRight(truncateAnsi(t.name, nameW), nameW) +
        gapSpaces(gap) +
        padRight(t.kind, kindW) +
        gapSpaces(gap) +
        padRight(truncateAnsi(t.responsibility, respW), respW) +
        gapSpaces(gap) +
        (t.status === "present" ? fg("success", "✓") : fg("dim", "·"))
    );
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
