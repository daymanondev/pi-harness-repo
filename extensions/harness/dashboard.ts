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
import { parseMarkdownStatus, type DriftRecord } from "./drift.js";
import { type FgFn, BOX_WIDTH, box, isEnter, isEscape, padRight, truncateAnsi } from "./overlay.js";

// ─── tabs ──────────────────────────────────────────────────────────────────

export type DashboardTab = "matrix" | "stats" | "backlog" | "tools" | "drift" | "timeline";

/** Tab chrome definition: `key` is the single hotkey that activates the tab. */
export const DASHBOARD_TABS: { tab: DashboardTab; label: string; key: string }[] = [
  { tab: "matrix", label: "matrix", key: "1" },
  { tab: "stats", label: "stats", key: "2" },
  { tab: "backlog", label: "backlog", key: "3" },
  { tab: "tools", label: "tools", key: "4" },
  { tab: "drift", label: "drift", key: "5" },
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
  /** Free-text tail after risk (predicted_impact + actual_outcome concatenated).
   *  The two columns are both free text with no delimiter, so they cannot be
   *  split reliably; kept as one display-only blob. */
  detail: string;
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
  // any formatter round-trip. Vocab is inlined here, not interpolated. The
  // trailing predicted_impact/actual_outcome columns are both free text with no
  // delimiter, so capture the whole tail as one `detail` blob (display-only).
  const re = /^(\d+)\s{2,}(.+?)\s{2,}(proposed|accepted|implemented|rejected)\s+(tiny|normal|high-risk)\b(?:\s+(.*))?$/;
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
      detail: (m[5] ?? "").trim(),
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
  drift: DriftRecord[];
  /** storyId → packet file (filename + raw markdown), for the story detail pane. */
  packets: Record<string, PacketRef>;
  errors: Partial<Record<DashboardTab, string>>;
}

/** A story packet file: filename + raw markdown text (read at overlay open). */
export interface PacketRef {
  filename: string;
  text: string;
}

// ─── drill-down navigation (US-014) ────────────────────────────────────────

/** Tabs whose body is a selectable list (cursor + drill apply). */
export type ListTab = "matrix" | "backlog" | "drift";

/** Which list row is drilled open (kind = which list, index = row). */
export interface DrillTarget {
  kind: ListTab;
  index: number;
}

/** Pure nav state: active tab + cursor (for list tabs) + drilled target. */
export interface DashboardNav {
  tab: DashboardTab;
  cursor: number;
  drill: DrillTarget | null;
}

/** Result of reducing one key: new nav + optional close/refresh action. */
export interface DashboardNavResult {
  nav: DashboardNav;
  action?: "close" | "refresh";
}

/** Hotkey → tab. Shared by the reducer + the component. */
const TAB_KEYS: Record<string, DashboardTab> = {
  "1": "matrix",
  "2": "stats",
  "3": "backlog",
  "4": "tools",
  "5": "drift",
  t: "timeline",
};

const LIST_TABS: ReadonlySet<ListTab> = new Set(["matrix", "backlog", "drift"]);

function isListTab(tab: DashboardTab): tab is ListTab {
  return LIST_TABS.has(tab as ListTab);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Up arrow: CSI `A` or SS3 `A` (normal + application cursor modes). */
function isArrowUp(key: string): boolean {
  return key === "\x1b[A" || key === "\x1bOA";
}
/** Down arrow: CSI `B` or SS3 `B`. */
function isArrowDown(key: string): boolean {
  return key === "\x1b[B" || key === "\x1bOB";
}

/** Width of the leading selection-marker column on list tabs. */
const MARK_W = 2;
/** Selection marker prefix: `▸ ` for the selected row, two spaces otherwise. */
function rowMarker(selected: boolean): string {
  return selected ? "▸ " : "  ";
}

/** Extract the body of a `## <heading>` section (up to the next `## ` or EOF). */
function extractSection(text: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    "##\\s*" + escaped + "\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)",
    "i"
  );
  const m = text.match(re);
  return m ? m[1]!.trim() : "";
}

/**
 * Pure dashboard key→nav reducer (US-014). The component's `handleInput` is a
 * thin shell over this, so the full key model is unit-testable without pi.
 *
 * - Esc: pop drill if drilled, else close.
 * - `r`: refresh. `1`-`5`/`t`: switch tab (resets cursor + drill).
 * - ↑/`k`, ↓/`j`: move cursor on a list tab (clamped; no-op when drilled, on a
 *   non-list tab, or the list is empty).
 * - Enter: drill into the selected row of a list tab (no-op when drilled, on a
 *   non-list tab, or the list is empty).
 *
 * `lens` is the current row count per list tab (the component supplies live
 * lengths so the reducer can clamp/disable without owning the data).
 */
export function reduceDashboardNav(
  nav: DashboardNav,
  key: string,
  lens: { matrix: number; backlog: number; drift: number }
): DashboardNavResult {
  if (isEscape(key)) {
    return nav.drill ? { nav: { ...nav, drill: null } } : { nav, action: "close" };
  }
  if (key === "r") return { nav, action: "refresh" };
  const t = TAB_KEYS[key];
  if (t) return { nav: { tab: t, cursor: 0, drill: null } };
  // cursor / drill only apply to list tabs, and only when not already drilled
  if (nav.drill || !isListTab(nav.tab)) return { nav };
  const len = lens[nav.tab] ?? 0;
  if (isArrowUp(key) || key === "k") {
    if (len === 0) return { nav };
    return { nav: { ...nav, cursor: clamp(nav.cursor - 1, 0, len - 1) } };
  }
  if (isArrowDown(key) || key === "j") {
    if (len === 0) return { nav };
    return { nav: { ...nav, cursor: clamp(nav.cursor + 1, 0, len - 1) } };
  }
  if (isEnter(key)) {
    if (len === 0) return { nav };
    return { nav: { ...nav, drill: { kind: nav.tab, index: nav.cursor } } };
  }
  return { nav };
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
  nav: DashboardNav,
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
    const on = t.tab === nav.tab;
    const label = `${t.key} ${t.label}`;
    return on ? fg("accent", label) : dim(label);
  });
  content.push(tabSegs.join(dim("   ")));
  content.push("");

  // ── active tab content (or the drilled detail pane) ──
  const innerW = w - 2;
  if (nav.drill) {
    content.push(...renderDetail(nav.drill, data, fg, innerW));
  } else if (nav.tab === "matrix") {
    content.push(...renderMatrixTab(data.matrix, nav.cursor, fg, innerW));
  } else if (nav.tab === "stats") {
    content.push(...renderStatsTab(data, fg, innerW));
  } else if (nav.tab === "backlog") {
    content.push(...renderBacklogTab(data, nav.cursor, fg, innerW));
  } else if (nav.tab === "tools") {
    content.push(...renderToolsTab(data, fg, innerW));
  } else if (nav.tab === "drift") {
    content.push(...renderDriftTab(data, nav.cursor, fg, innerW));
  } else {
    // timeline — still a P5 placeholder (live tail of harness-observer).
    content.push(dim("(timeline tab ships in P5)"));
  }
  content.push("");

  // ── footer hints (context-sensitive: drilled vs list) ──
  content.push(
    dim(
      nav.drill
        ? "[Esc] back to list"
        : "[↑↓/j,k] move · [Enter] open · [1-5] tabs · [r] refresh · [Esc] close"
    )
  );
  return box("repository-harness · dashboard", content, fg, w);
}

/** Render the proof-matrix tab body (column header + rows, with a selection
 *  cursor for drill-down). Inner width = innerW. */
function renderMatrixTab(matrix: MatrixRow[], cursor: number, fg: FgFn, innerW: number): string[] {
  const dim = (t: string) => fg("dim", t);
  const out: string[] = [];
  const innerW2 = innerW - MARK_W;

  const idW = 7;
  const statusW = 12;
  const proofW = 7; // "✓ ✓ ✓ ✓" / "u i e p" — 4 marks joined by single spaces
  const gap = 2;
  const titleW = Math.max(10, innerW2 - (idW + statusW + proofW + 3 * gap));

  // column header (indented to align with the marker column)
  const head =
    padRight(dim("id"), idW) +
    gapSpaces(gap) +
    padRight(dim("title"), titleW) +
    gapSpaces(gap) +
    padRight(dim("status"), statusW) +
    gapSpaces(gap) +
    dim("u i e p");
  out.push(rowMarker(false) + head);

  if (matrix.length === 0) {
    out.push(rowMarker(false) + dim("(no stories — query matrix returned nothing)"));
    return out;
  }

  matrix.forEach((r, i) => {
    const id = padRight(r.id, idW);
    const title = padRight(truncateAnsi(r.title, titleW), titleW);
    const status = padRight(fg(statusColor(r.status), r.status), statusW);
    const proof =
      proofMark(r.unit, fg) + " " + proofMark(r.integ, fg) + " " + proofMark(r.e2e, fg) + " " + proofMark(r.plat, fg);
    out.push(rowMarker(i === cursor) + id + gapSpaces(gap) + title + gapSpaces(gap) + status + gapSpaces(gap) + proof);
  });
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

/** Render the backlog tab body (column header + open rows, with a selection
 *  cursor for drill-down). innerW = inner width. */
function renderBacklogTab(data: DashboardData, cursor: number, fg: FgFn, innerW: number): string[] {
  const dim = (t: string) => fg("dim", t);
  if (data.errors.backlog) {
    return [dim("(backlog unavailable — query backlog failed)")];
  }
  const out: string[] = [];
  const innerW2 = innerW - MARK_W;
  const idW = 5;
  const statusW = 12;
  const riskW = 10;
  const gap = 2;
  const titleW = Math.max(10, innerW2 - (idW + statusW + riskW + 3 * gap));
  out.push(
    rowMarker(false) +
      padRight(dim("id"), idW) +
      gapSpaces(gap) +
      padRight(dim("title"), titleW) +
      gapSpaces(gap) +
      padRight(dim("status"), statusW) +
      gapSpaces(gap) +
      padRight(dim("risk"), riskW)
  );
  if (data.backlog.length === 0) {
    out.push(rowMarker(false) + dim("(no open backlog items)"));
    return out;
  }
  data.backlog.forEach((r, i) => {
    out.push(
      rowMarker(i === cursor) +
        padRight(String(r.id), idW) +
        gapSpaces(gap) +
        padRight(truncateAnsi(r.title, titleW), titleW) +
        gapSpaces(gap) +
        padRight(fg(backlogStatusColor(r.status), r.status), statusW) +
        gapSpaces(gap) +
        padRight(r.risk, riskW)
    );
  });
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

/** Render the Drift tab body (US-012 + US-014 cursor): markdown ↔ durable
 *  mismatches with fix hints, or a clean "no drift" line. Inner width = innerW. */
function renderDriftTab(
  data: DashboardData,
  cursor: number,
  fg: FgFn,
  innerW: number
): string[] {
  const dim = (t: string) => fg("dim", t);
  if (data.errors.drift) {
    return [dim("(drift unavailable — detectDrift failed)")];
  }
  if (data.drift.length === 0) {
    return [fg("success", "✓ no drift — markdown ↔ durable agree")];
  }
  const out: string[] = [];
  const idW = 8;
  const kindW = 18;
  const gap = 2;
  // reserve MARK_W cols for the leading selection marker
  const valW = Math.max(16, innerW - (idW + kindW + 2 * gap + MARK_W));
  out.push(
    rowMarker(false) +
      padRight(dim("story"), idW) +
      gapSpaces(gap) +
      padRight(dim("kind"), kindW) +
      gapSpaces(gap) +
      dim("durable | markdown")
  );
  data.drift.forEach((r, i) => {
    out.push(
      rowMarker(i === cursor) +
        padRight(truncateAnsi(r.storyId, idW), idW) +
        gapSpaces(gap) +
        padRight(r.kind, kindW) +
        gapSpaces(gap) +
        truncateAnsi(`${r.durable} | ${r.markdown}`, valW)
    );
    if (r.fixHint) {
      out.push("    " + dim("→ " + truncateAnsi(r.fixHint, innerW - 4)));
    }
  });
  return out;
}

// ─── detail panes (US-014 drill-down) ──────────────────────────────────────

/** First N non-empty lines of a section body, each truncated to `width`. */
function sectionLines(body: string, n: number, width: number, fg: FgFn): string[] {
  const dim = (t: string) => fg("dim", t);
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, n)
    .map((l) => dim("  " + truncateAnsi(l, width)));
}

/** Render the drilled STORY detail: packet-derived status/lane + Acceptance +
 *  Evidence excerpts + the packet path. Pure. */
function renderStoryDetail(
  row: MatrixRow,
  packet: PacketRef | undefined,
  fg: FgFn,
  innerW: number
): string[] {
  const dim = (t: string) => fg("dim", t);
  const out: string[] = [];
  out.push(`${fg("accent", row.id)}  ${truncateAnsi(row.title, innerW - row.id.length - 2)}`);
  // status: the packet is authoritative (falls back to the matrix-row status)
  const mdStatus = packet ? parseMarkdownStatus(packet.text) : "";
  const status = mdStatus || row.status;
  const laneRaw = packet ? extractSection(packet.text, "Lane").split(/\r?\n/)[0] ?? "" : "";
  const lane = laneRaw.trim();
  out.push(`${dim("Status:")} ${fg(statusColor(status), status)}   ${dim("Lane:")} ${lane || dim("—")}`);
  if (!packet) {
    out.push(dim(`(no packet file — orphan durable; add docs/stories/${row.id}-*.md)`));
    return out;
  }
  out.push(dim("Packet: " + truncateAnsi(packet.filename, innerW - 8)));
  const ac = extractSection(packet.text, "Acceptance Criteria");
  if (ac) {
    out.push(dim("Acceptance:"));
    out.push(...sectionLines(ac, 3, innerW - 2, fg));
  }
  const ev = extractSection(packet.text, "Evidence");
  out.push(dim("Evidence:"));
  out.push(...(ev ? sectionLines(ev, 2, innerW - 2, fg) : [dim("  (empty — not yet recorded)")]));
  return out;
}

/** Render the drilled BACKLOG detail: full fields + the detail tail. Pure. */
function renderBacklogDetail(row: BacklogRow, fg: FgFn, innerW: number): string[] {
  const dim = (t: string) => fg("dim", t);
  const out: string[] = [];
  out.push(`${fg("accent", "#" + row.id)}  ${truncateAnsi(row.title, innerW - String(row.id).length - 3)}`);
  out.push(`${dim("Status:")} ${fg(backlogStatusColor(row.status), row.status)}   ${dim("Risk:")} ${row.risk}`);
  if (row.detail) {
    out.push(dim("Detail:"));
    for (const l of row.detail.split(/\r?\n/).slice(0, 4)) {
      out.push(dim("  " + truncateAnsi(l, innerW - 2)));
    }
  } else {
    out.push(dim("Detail: (none recorded)"));
  }
  return out;
}

/** Render the drilled DRIFT detail: mismatch sides + the fix hint. Pure. */
function renderDriftDetail(rec: DriftRecord, fg: FgFn, innerW: number): string[] {
  const dim = (t: string) => fg("dim", t);
  const out: string[] = [];
  out.push(`${fg("warning", rec.storyId)}  ${fg("accent", rec.kind)}`);
  out.push(`${dim("Durable:")} ${rec.durable}   ${dim("Markdown:")} ${rec.markdown}`);
  if (rec.detail) out.push(dim(truncateAnsi(rec.detail, innerW)));
  if (rec.fixHint) out.push(fg("accent", "→ " + truncateAnsi(rec.fixHint, innerW - 2)));
  return out;
}

/** Dispatch a drilled target to its detail renderer (bounds-checked). */
function renderDetail(
  drill: DrillTarget,
  data: DashboardData,
  fg: FgFn,
  innerW: number
): string[] {
  if (drill.kind === "matrix") {
    const row = data.matrix[drill.index];
    if (!row) return [fg("dim", "(row no longer exists — press r to refresh)")];
    return renderStoryDetail(row, data.packets[row.id], fg, innerW);
  }
  if (drill.kind === "backlog") {
    const row = data.backlog[drill.index];
    if (!row) return [fg("dim", "(row no longer exists — press r to refresh)")];
    return renderBacklogDetail(row, fg, innerW);
  }
  const rec = data.drift[drill.index];
  if (!rec) return [fg("dim", "(row no longer exists — press r to refresh)")];
  return renderDriftDetail(rec, fg, innerW);
}

/** A single proof mark: ✓ (success) for 1, · (dim) for 0. */
function proofMark(n: number, fg: FgFn): string {
  return n >= 1 ? fg("success", "✓") : fg("dim", "·");
}

function gapSpaces(n: number): string {
  return " ".repeat(n);
}
