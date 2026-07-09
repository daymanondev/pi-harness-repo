// dashboard.ts — pure DASHBOARD view for `/harness` (DESIGN §7, §11 P4).
//
// Pure contract (same as overlay.ts / detect.ts / gates.ts / drift.ts): imports
// NO pi types and NO pi runtime. Theming is injected as `fg(color, text)`; the
// box/width/ANSI helpers are reused from overlay.ts so the right border stays
// aligned when `fg` injects SGR escapes. Every function below is unit-testable
// with a stub `fg` (identity `(c, t) => t`).
//
// US-040 (dashboard focus rework, intake #56): the overlay was decluttered to
// just two top-level tabs — Matrix + Backlog (the two surfaces that carry
// signal in daily use). The earlier stats/tools/drift/timeline/decisions/
// initiatives tabs were removed; drift detection still runs (Gate B′ + the
// footer use drift.ts directly, not a tab). The story detail pane keeps its
// provenance lane + the initiative link (parent_intake_id), so the surviving
// surfaces still show everything actionable.
//
// Data source: `harness-cli query matrix --numeric` — a fixed-column table with
// NO `--json` flag (open Q1, DESIGN §13.3). The parser keys off the stable
// `US-NNN` id + the trailing 4 numeric proof columns, so it tolerates
// variable-width titles (spaces, punctuation) without column-position math.

import type { HarnessState } from "./detect.js";
import { parseMarkdownStatus } from "./drift.js";
import { type FgFn, BOX_WIDTH, box, isEnter, isEscape, padRight, truncateAnsi } from "./overlay.js";

// ─── tabs ──────────────────────────────────────────────────────────────────

export type DashboardTab = "matrix" | "backlog";

/** Tab chrome definition: `key` is the single hotkey that activates the tab. */
export const DASHBOARD_TABS: { tab: DashboardTab; label: string; key: string }[] = [
  { tab: "matrix", label: "matrix", key: "1" },
  { tab: "backlog", label: "backlog", key: "2" },
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
 * Parse `query sql "SELECT DISTINCT story_id FROM intake WHERE story_id IS NOT
 * NULL"` output into the classified-story-id set (US-023, reworked US-036).
 * `classified` = ANY intake links the story (not just `spec_slice`) — the
 * grill is now a clarification tool, not a per-slice intake gate, so the
 * readiness signal is simply "has a linked intake". `query intakes` does NOT
 * surface the `story_id` column, so the durable layer is queried directly.
 * Pure + total: picks up every `US-NNN` token (header/separator never match)
 * and never throws on partial/empty output.
 */
export function parseClassifiedStoryIds(stdout: string): Set<string> {
  const ids = new Set<string>();
  for (const m of stdout.matchAll(/\bUS-\d+\b/g)) ids.add(m[0]!);
  return ids;
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

// ─── provenance (US-025): per-story intake + trace links ───────────────────

/** One intake linked to a story (the durable `intake.story_id` FK). */
export interface StoryProvenanceIntake {
  id: number;
  inputType: string;
}

/** The provenance behind one story: its linked intakes + trace ids (Tier 2
 *  evidence — US-025). Decisions are omitted: the `decision` table has no
 *  `story_id` FK, so there is no durable per-story decision link. */
export interface StoryProvenance {
  intakes: StoryProvenanceIntake[];
  /** Trace ids, latest first. */
  traces: number[];
}

/**
 * Parse the pipe-delimited `query sql "SELECT story_id||'|'||id||'|'||input_type
 * FROM intake WHERE story_id IS NOT NULL …"` output into a storyId → intakes
 * map (US-025). Pure + total: lines that don't match `US-NNN|<digits>|<type>`
 * (header, separator, blank) are skipped; never throws on partial/garbage.
 */
export function parseIntakesByStory(
  stdout: string
): Map<string, StoryProvenanceIntake[]> {
  const out = new Map<string, StoryProvenanceIntake[]>();
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line) continue;
    const m = line.match(/^(US-\d+)\|(\d+)\|([a-z_]+)$/);
    if (!m) continue;
    const [, sid, idStr, inputType] = m;
    if (!sid || !idStr || !inputType) continue;
    const arr = out.get(sid) ?? [];
    arr.push({ id: Number(idStr), inputType });
    out.set(sid, arr);
  }
  return out;
}

/**
 * Parse the pipe-delimited `query sql "SELECT story_id||'|'||id FROM trace WHERE
 * story_id IS NOT NULL ORDER BY id DESC"` output into a storyId → trace-id[] map
 * (latest first, US-025). Pure + total; skips non-matching lines.
 */
export function parseTracesByStory(stdout: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line) continue;
    const m = line.match(/^(US-\d+)\|(\d+)$/);
    if (!m) continue;
    const [, sid, idStr] = m;
    if (!sid || !idStr) continue;
    const arr = out.get(sid) ?? [];
    arr.push(Number(idStr));
    out.set(sid, arr);
  }
  return out;
}

/** Merge the two per-story maps into the storyId → StoryProvenance map the detail
 *  pane renders (US-025). Pure: the natural unit-test seam for the lane. */
export function buildProvenance(
  intakes: Map<string, StoryProvenanceIntake[]>,
  traces: Map<string, number[]>
): Map<string, StoryProvenance> {
  const keys = new Set<string>([...intakes.keys(), ...traces.keys()]);
  const out = new Map<string, StoryProvenance>();
  for (const k of keys) {
    out.set(k, { intakes: intakes.get(k) ?? [], traces: traces.get(k) ?? [] });
  }
  return out;
}

// ─── initiatives (US-036): initiative → slices hierarchy ───────────────────

/** One slice story belonging to an initiative, parsed from the durable layer.
 *  Lighter than MatrixRow (no proof columns) — proof detail comes from the
 *  matrix join when drilling. */
export interface InitiativeSlice {
  id: string;
  title: string;
  status: string;
}

/** One initiative (a `new_initiative` intake) and its linked slice stories.
 *  Kept after the US-040 declutter: the story detail pane + the matrix initiative
 *  badge (US-041) consume it via `parent_intake_id`, even though there is no
 *  dedicated initiatives tab anymore. */
export interface InitiativeGroup {
  intakeId: number;
  summary: string;
  slices: InitiativeSlice[];
}

/**
 * Parse the two `query sql` projections that back the initiative link (US-036)
 * into a group list, newest initiative first. `intakesStdout` is
 * `<id>|<summary>` rows from `new_initiative` intakes; `slicesStdout` is
 * `<parent_intake_id>|<story_id>|<title>|<status>` rows from stories with a
 * `parent_intake_id` (migration 009). Pure + total: non-matching lines
 * (header, separator, blank) are skipped; a slice whose parent is not a
 * `new_initiative` intake is dropped; never throws on partial/garbage.
 */
export function parseInitiatives(
  intakesStdout: string,
  slicesStdout: string
): InitiativeGroup[] {
  const groups = new Map<number, InitiativeGroup>();
  for (const raw of intakesStdout.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line) continue;
    const m = line.match(/^(\d+)\|(.*)$/);
    if (!m) continue;
    const id = Number(m[1]);
    groups.set(id, { intakeId: id, summary: m[2]!.trim(), slices: [] });
  }
  for (const raw of slicesStdout.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line) continue;
    const m = line.match(/^(\d+)\|(US-\d+)\|([^|]*)\|([a-z_-]*)$/);
    if (!m) continue;
    const parent = Number(m[1]);
    const g = groups.get(parent);
    if (!g) continue;
    g.slices.push({ id: m[2]!, title: m[3]!.trim(), status: m[4]!.trim() });
  }
  return [...groups.values()].sort((a, b) => b.intakeId - a.intakeId);
}

// ─── dashboard data aggregate ──────────────────────────────────────────────

/**
 * All parsed tab data + a per-tab error map. Renderers are pure functions of
 * this object: a present `errors[tab]` wins over the data and renders a dim
 * error row, so a failing query never throws out of the overlay. `matrix` keeps
 * US-010's empty-on-failure semantics (it has its own empty-state row).
 */
export interface DashboardData {
  matrix: MatrixRow[];
  backlog: BacklogRow[];
  /** storyId → packet file (filename + raw markdown), for the story detail pane. */
  packets: Record<string, PacketRef>;
  /** Story ids linked by ANY intake = the classified set (US-023, reworked
   *  US-036). Drives the Matrix classified-badge + the detail-pane `next:` line. */
  classifiedStoryIds: ReadonlySet<string>;
  /** storyId → linked intakes + trace ids (Tier 2 provenance, US-025). Drives
   *  the detail-pane Provenance lane. Empty map when no story has links yet. */
  provenance: Map<string, StoryProvenance>;
  /** Initiative → slices groups (US-036). Drives the story-detail initiative link
   *  + the matrix initiative badge (US-041). Empty when no `new_initiative`
   *  intake has linked slices yet. */
  initiatives: InitiativeGroup[];
  errors: Partial<Record<DashboardTab, string>>;
}

/** A story packet file: filename + raw markdown text (read at overlay open). */
export interface PacketRef {
  filename: string;
  text: string;
}

// ─── control-surface routing (US-023) ──────────────────────────────────────

/**
 * The next action to take on a story, derived purely from its classified
 * status. `classified` = ANY intake links the story (the durable readiness
 * signal, US-023 reworked US-036). The grill is now an on-demand clarification
 * tool — it is NOT gated by this badge; an unclassified story simply needs an
 * intake recorded (use the griller only if the story is genuinely unclear).
 * This pure router is the single source of truth for the Matrix classified-
 * badge + the detail-pane `next:` line, and is reused by the agent task-loop so
 * both entry points (dashboard + "do US-NNN") route identically. Advisory only
 * — no durable writes originate here (US-014 Command-Query invariant).
 */
export interface NextAction {
  classified: boolean;
  next: "classify" | "implement";
  prompt: string;
}

/**
 * Pure router: classified → implement (hand off to a worker against the
 * packet's acceptance criteria); unclassified → classify (record an intake;
 * run harness-intake-griller only if the story is unclear). Advisory prompt
 * text only; the operator runs it in their own pane/session.
 */
export function nextActionFor(
  story: { id: string },
  classifiedStoryIds: ReadonlySet<string>
): NextAction {
  const classified = classifiedStoryIds.has(story.id);
  if (classified) {
    return {
      classified: true,
      next: "implement",
      prompt: `implement ${story.id} — worker against docs/stories/${story.id}-*.md (acceptance criteria)`,
    };
  }
  return {
    classified: false,
    next: "classify",
    prompt: `classify ${story.id} — record an intake (use harness-intake-griller only if the story is unclear)`,
  };
}

// ─── dashboard dispatch (US-027) ───────────────────────────────────────────

/**
 * The list item the operator chose to dispatch to the agent, and the kind of
 * tab it came from. `id` is the backlog item number (e.g. "5") or the story id
 * ("US-NNN"); `title` is the row title (display only, not interpolated into
 * the prompt — the agent re-reads the item by id).
 */
export interface DispatchTarget {
  kind: "backlog" | "matrix";
  id: string;
  title: string;
}

/**
 * Pure: build the user message that hands a dashboard list item to the agent
 * in-session (US-027). Mirrors the operator's manual idiom ("please check
 * @AGENTS.md, follow the harness flow and start with backlog #N") so the
 * resulting turn is indistinguishable from one the operator typed.
 *
 * - Backlog → a triage prompt: the agent reviews + verifies the item, then
 *   decides close / promote-to-story / reframe WITH the operator. The
 *   decision is a discussion, not a keystroke — closing still goes through the
 *   agent (the dashboard never mutates durable state).
 * - Matrix/story → reuses `nextActionFor`: unclassified → classify; classified
 *   → implement (against the packet).
 *
 * The US-023 advisory text in the detail pane is unchanged; this is the
 * *action* layer on top. See ADR-0014 (in-session sendUserMessage permitted;
 * pane-spawn still deferred, US-028).
 */
export function dispatchPromptFor(
  target: DispatchTarget,
  classifiedStoryIds: ReadonlySet<string>
): string {
  const base = "please check @AGENTS.md, follow the harness flow and";
  if (target.kind === "backlog") {
    return (
      `${base} start with backlog #${target.id}. ` +
      `Review and verify whether it is still relevant, then triage with me: ` +
      `close (if done or no longer valid), promote to a story, or reframe.`
    );
  }
  const action = nextActionFor({ id: target.id }, classifiedStoryIds);
  if (action.next === "classify") {
    return (
      `${base} classify ${target.id} — record an intake for ${target.id} ` +
      `(use harness-intake-griller only if the story is unclear).`
    );
  }
  return `${base} implement ${target.id} against docs/stories/${target.id}-*.md (acceptance criteria).`;
}

// ─── matrix status-filter (US-026) ─────────────────────────────────────────

/** Matrix status-filter stops (US-026). `f` cycles through these in order. */
export const MATRIX_FILTER_CYCLE = ["all", "planned", "unclassified", "done"] as const;
export type MatrixFilter = (typeof MATRIX_FILTER_CYCLE)[number];

/**
 * Pure matrix-row filter (US-026). Narrows the full matrix to the rows visible
 * under a given filter stop:
 * - `all`           — every row (identity).
 * - `planned`       — `status = planned` (work not yet started).
 * - `unclassified`  — the classify queue: `status = planned` AND no intake
 *   linked (the US-023/US-036 intake-linkage signal). The primary stop.
 * - `done`          — `status = implemented`.
 * `retired` is deliberately not a stop (low signal; stays visible under `all`).
 * Pure + total: never throws; `undefined`/unknown filter → `all` (identity).
 */
export function filterMatrixRows(
  rows: readonly MatrixRow[],
  classifiedStoryIds: ReadonlySet<string>,
  filter: MatrixFilter | undefined
): MatrixRow[] {
  const f = filter ?? "all";
  if (f === "all") return [...rows];
  if (f === "planned") return rows.filter((r) => r.status === "planned");
  if (f === "done") return rows.filter((r) => r.status === "implemented");
  return rows.filter((r) => r.status === "planned" && !classifiedStoryIds.has(r.id));
}

// ─── drill-down navigation (US-014) ────────────────────────────────────────

/** Tabs whose body is a selectable list (cursor + drill apply). */
export type ListTab = "matrix" | "backlog";

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
  /** US-026: matrix status-filter stop (matrix tab only; resets to "all" on
   *  tab switch). Optional so existing `DashboardNav` literals stay valid. */
  matrixFilter?: MatrixFilter;
}

/** Result of reducing one key: new nav + optional action. `dispatch` (US-027)
 *  signals that the operator pressed `s` on a dispatchable list row; the
 *  component builds the prompt from the selected row + calls onDone (the
 *  reducer has no row data, so it only signals). */
export interface DashboardNavResult {
  nav: DashboardNav;
  action?: "close" | "refresh" | "dispatch";
}

/** Hotkey → tab. Shared by the reducer + the component. */
const TAB_KEYS: Record<string, DashboardTab> = {
  "1": "matrix",
  "2": "backlog",
};

const LIST_TABS: ReadonlySet<ListTab> = new Set(["matrix", "backlog"]);

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
 * - `r`: refresh. `1`/`2`: switch tab (resets cursor + drill).
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
  lens: { matrix: number; backlog: number }
): DashboardNavResult {
  if (isEscape(key)) {
    return nav.drill ? { nav: { ...nav, drill: null } } : { nav, action: "close" };
  }
  if (key === "r") return { nav, action: "refresh" };
  const t = TAB_KEYS[key];
  if (t) return { nav: { tab: t, cursor: 0, drill: null, matrixFilter: "all" } };
  // US-027: `s` dispatches the selected row to the agent in-session
  // (pi.sendUserMessage). Fires on matrix + backlog — the dispatchable list
  // tabs — in both list and drilled states (the cursor holds the row either
  // way). The reducer only signals `dispatch`; the component owns the
  // selected-row → prompt build (it has the data, the reducer does not).
  if (key === "s" && (nav.tab === "matrix" || nav.tab === "backlog")) {
    const len = lens[nav.tab] ?? 0;
    return len > 0 ? { nav, action: "dispatch" } : { nav };
  }
  // cursor / drill only apply to list tabs, and only when not already drilled
  if (nav.drill || !isListTab(nav.tab)) return { nav };
  // US-026: `f` cycles the matrix status-filter (matrix-only; no-op on other
  // list tabs). Resets cursor to 0 — the list content changes, so position is
  // meaningless (mirrors the tab-switch cursor reset).
  if (key === "f" && nav.tab === "matrix") {
    const cur = nav.matrixFilter ?? "all";
    const next = MATRIX_FILTER_CYCLE[(MATRIX_FILTER_CYCLE.indexOf(cur) + 1) % MATRIX_FILTER_CYCLE.length]!;
    return { nav: { ...nav, matrixFilter: next, cursor: 0 } };
  }
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
 * failing query degrades cleanly.
 */
export function renderDashboardLines(
  state: HarnessState,
  nav: DashboardNav,
  data: DashboardData,
  fg: FgFn,
  width = BOX_WIDTH
): string[] {
  // Fill the available overlay width (pi resolves OverlayOptions.width="76%" to
  // a column count and passes it here). The old Math.min(width, BOX_WIDTH) cap
  // rendered a 76-col box inside a wider overlay → a black void on the right on
  // wide terminals (intake #19). No upper cap now; only the 60-col floor.
  const w = Math.max(60, width);
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
  // US-026: the matrix status-filter narrows the displayed list. The filtered
  // list is the single source of truth for BOTH the list render AND drill
  // resolution — the drill index points into the filtered list, so renderDetail
  // must resolve against it too. (matrixFilter resets to "all" on tab switch,
  // so for non-matrix tabs this is the identity.)
  const matrixFilter = nav.matrixFilter ?? "all";
  const filteredMatrix = filterMatrixRows(data.matrix, data.classifiedStoryIds, matrixFilter);
  if (nav.drill) {
    const drillData = nav.drill.kind === "matrix" ? { ...data, matrix: filteredMatrix } : data;
    content.push(...renderDetail(nav.drill, drillData, fg, innerW));
  } else if (nav.tab === "matrix") {
    content.push(...renderMatrixTab(filteredMatrix, data.classifiedStoryIds, matrixFilter, nav.cursor, fg, innerW));
  } else {
    content.push(...renderBacklogTab(data, nav.cursor, fg, innerW));
  }
  content.push("");

  // ── footer hints (context-sensitive: drilled vs list; [s] on dispatchable tabs) ──
  // `[1,2] tabs` is omitted — the tab strip above already labels each tab with
  // its hotkey.
  const dispatchable = nav.tab === "matrix" || nav.tab === "backlog";
  content.push(
    dim(
      nav.drill
        ? dispatchable
          ? "[Esc] back · [s] start"
          : "[Esc] back to list"
        : "[↑↓/j,k] move · [Enter] open · [r] refresh" +
          (dispatchable ? " · [s] start" : "") +
          " · [Esc] close"
    )
  );
  return box("repository-harness · dashboard", content, fg, w);
}

/** Render the proof-matrix tab body (column header + rows, with a selection
 *  cursor for drill-down). US-023/US-036: each row carries a leading classified-
 *  badge (● classified / ○ unclassified) derived from `nextActionFor`. Inner
 *  width = innerW. */
function renderMatrixTab(
  matrix: MatrixRow[],
  classifiedStoryIds: ReadonlySet<string>,
  filter: MatrixFilter,
  cursor: number,
  fg: FgFn,
  innerW: number
): string[] {
  const dim = (t: string) => fg("dim", t);
  const out: string[] = [];
  const innerW2 = innerW - MARK_W;

  // US-026: active-filter label + `f` discovery, always shown on the matrix
  // list (the footer can't host `[f]` without overflowing at narrow widths).
  out.push(
    rowMarker(false) +
      dim("filter:") + " " +
      (filter === "all" ? dim(filter) : fg("accent", filter)) +
      dim("   [f] cycle")
  );

  const BADGE_W = 2; // classified-badge glyph (●/○) + trailing space
  const idW = 7;
  const statusW = 12;
  const proofW = 7; // "✓ ✓ ✓ ✓" / "u i e p" — 4 marks joined by single spaces
  const gap = 2;
  const titleW = Math.max(10, innerW2 - (BADGE_W + idW + statusW + proofW + 3 * gap));

  // column header (indented to align with the marker column)
  const head =
    padRight(dim("c"), BADGE_W - 1) + " " +
    padRight(dim("id"), idW) +
    gapSpaces(gap) +
    padRight(dim("title"), titleW) +
    gapSpaces(gap) +
    padRight(dim("status"), statusW) +
    gapSpaces(gap) +
    dim("u i e p");
  out.push(rowMarker(false) + head);

  if (matrix.length === 0) {
    let emptyMsg = "(no stories — query matrix returned nothing)";
    if (filter === "unclassified") emptyMsg = "(no unclassified stories — classify queue empty)";
    else if (filter === "planned") emptyMsg = "(no planned stories)";
    else if (filter === "done") emptyMsg = "(no implemented stories)";
    out.push(rowMarker(false) + dim(emptyMsg));
    return out;
  }

  matrix.forEach((r, i) => {
    const action = nextActionFor(r, classifiedStoryIds);
    const badge = (action.classified ? fg("success", "●") : fg("dim", "○")) + " ";
    const id = padRight(r.id, idW);
    const title = padRight(truncateAnsi(r.title, titleW), titleW);
    const status = padRight(fg(statusColor(r.status), r.status), statusW);
    const proof =
      proofMark(r.unit, fg) + " " + proofMark(r.integ, fg) + " " + proofMark(r.e2e, fg) + " " + proofMark(r.plat, fg);
    out.push(rowMarker(i === cursor) + badge + id + gapSpaces(gap) + title + gapSpaces(gap) + status + gapSpaces(gap) + proof);
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

/** Render the drilled STORY detail: packet-derived status/lane + classified/next
 *  routing (US-023, reworked US-036) + the initiative link + Acceptance +
 *  Evidence excerpts + the packet path. Pure. */
function renderStoryDetail(
  row: MatrixRow,
  packet: PacketRef | undefined,
  classifiedStoryIds: ReadonlySet<string>,
  provenance: StoryProvenance | undefined,
  fg: FgFn,
  innerW: number,
  parentIntakeId: number | undefined = undefined
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
  if (parentIntakeId !== undefined) {
    out.push(`${dim("initiative:")} ${fg("accent", "#" + parentIntakeId)}`);
  }
  // US-023/US-036: classified-status (intake-linkage) + next-action routing.
  // Advisory only; the operator runs the prompt in his own pane. Shown for
  // every story (classified-ness is independent of packet presence).
  const action = nextActionFor(row, classifiedStoryIds);
  out.push(
    `${dim("classified:")} ${action.classified ? fg("success", "yes") : dim("no")}   ` +
      `${dim("next:")} ${action.next === "implement" ? fg("accent", "implement") : fg("warning", "classify")}`
  );
  out.push(dim("→ " + truncateAnsi(action.prompt, innerW - 2)));
  out.push(dim(`[s] start — ${action.next === "classify" ? "classify" : "implement"} ${row.id} now`));
  // US-025: Provenance lane — Tier 2 evidence for THIS story (read-only). Shown
  // for every story (independent of packet presence): intake linkage + traces.
  out.push(dim("Provenance:"));
  const ints = provenance?.intakes ?? [];
  out.push(
    "  " + dim("intake:") + " " +
      (ints.length
        ? truncateAnsi(ints.map((i) => `#${i.id} ${i.inputType}`).join(", "), Math.max(10, innerW - 11))
        : dim("— (no linked intake; classify first)"))
  );
  const trs = provenance?.traces ?? [];
  const shown = trs.slice(0, 5);
  const more = trs.length - shown.length;
  out.push(
    "  " + dim("traces:") + " " +
      (trs.length ? shown.join(", ") + (more > 0 ? dim(` (+${more} more)`) : "") : dim("—"))
  );
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
  out.push(dim(`[s] start — hand #${row.id} to the agent to triage (close / promote / reframe)`));
  return out;
}

/** Find the initiative intake id a story belongs to (undefined if none). */
function findParentIntake(groups: readonly InitiativeGroup[], storyId: string): number | undefined {
  for (const g of groups) if (g.slices.some((s) => s.id === storyId)) return g.intakeId;
  return undefined;
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
    return renderStoryDetail(row, data.packets[row.id], data.classifiedStoryIds, data.provenance.get(row.id), fg, innerW, findParentIntake(data.initiatives, row.id));
  }
  // backlog
  const row = data.backlog[drill.index];
  if (!row) return [fg("dim", "(row no longer exists — press r to refresh)")];
  return renderBacklogDetail(row, fg, innerW);
}

/** A single proof mark: ✓ (success) for 1, · (dim) for 0. */
function proofMark(n: number, fg: FgFn): string {
  return n >= 1 ? fg("success", "✓") : fg("dim", "·");
}

function gapSpaces(n: number): string {
  return " ".repeat(n);
}
