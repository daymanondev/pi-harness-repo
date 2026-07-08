// dashboard.ts — pure DASHBOARD view for `/harness` (DESIGN §7, §11 P4).
//
// Pure contract (same as overlay.ts / detect.ts / gates.ts / drift.ts): imports
// NO pi types and NO pi runtime. Theming is injected as `fg(color, text)`; the
// box/width/ANSI helpers are reused from overlay.ts so the right border stays
// aligned when `fg` injects SGR escapes. Every function below is unit-testable
// with a stub `fg` (identity `(c, t) => t`).
//
// US-010 (tracer bullet): ships the shell + tab chrome + the proof-matrix tab.
// Tabs 2/3/4 (stats/backlog/tools → US-011) and `t` timeline (US-015) are all
// implemented; the chrome lists every tab honestly.
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

export type DashboardTab = "matrix" | "stats" | "backlog" | "tools" | "drift" | "timeline" | "decisions";

/** Tab chrome definition: `key` is the single hotkey that activates the tab. */
export const DASHBOARD_TABS: { tab: DashboardTab; label: string; key: string }[] = [
  { tab: "matrix", label: "matrix", key: "1" },
  { tab: "stats", label: "stats", key: "2" },
  { tab: "backlog", label: "backlog", key: "3" },
  { tab: "tools", label: "tools", key: "4" },
  { tab: "drift", label: "drift", key: "5" },
  { tab: "timeline", label: "timeline", key: "t" },
  { tab: "decisions", label: "decisions", key: "6" },
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
 * Parse `query sql "SELECT DISTINCT story_id FROM intake WHERE input_type=
 * 'spec_slice' AND story_id IS NOT NULL"` output into the grilled-story-id set
 * (US-023). `query intakes` does NOT surface the `story_id` column, so the
 * durable layer is queried directly for the precise intake-linkage signal.
 * Pure + total: picks up every `US-NNN` token (header/separator never match)
 * and never throws on partial/empty output.
 */
export function parseGrilledStoryIds(stdout: string): Set<string> {
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

// ─── timeline parser (`.harness-observer/events.jsonl`) ────────────────────

/** One harness-observer flow event. The observer wraps harness-cli and writes
 *  one JSONL line per call; `db_before`/`db_after` are per-table count maps the
 *  timeline renders as the `table: before → after` delta (DESIGN §8.2). */
export interface TimelineEvent {
  ts: string;
  cmd: string[];
  exit: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  dbBefore: Record<string, number>;
  dbAfter: Record<string, number>;
}

/** Maximum events rendered in the timeline (DESIGN §8.2: "last 50 calls").
 *  fetchTimeline caps to this; the renderer shows all of `data.timeline`. */
export const TIMELINE_MAX = 50;

/** Coerce an unknown `db_before`/`db_after` value into a {table: count} map,
 *  dropping non-numeric entries. Never throws. */
function toCounts(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
  }
  return out;
}

/** Parse `.harness-observer/events.jsonl` text into events. Pure + total: blank
 *  lines and unparseable / non-object lines are silently skipped, so a partial
 *  or hand-edited log never throws. Missing fields degrade to zero / empty. */
export function parseEventsJsonl(text: string): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!o || typeof o !== "object") continue;
    const e = o as Record<string, unknown>;
    out.push({
      ts: String(e.ts ?? ""),
      cmd: Array.isArray(e.cmd) ? e.cmd.map(String) : [],
      exit: Number(e.exit ?? 0),
      durationMs: Number(e.duration_ms ?? 0),
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
      dbBefore: toCounts(e.db_before),
      dbAfter: toCounts(e.db_after),
    });
  }
  return out;
}

/** Re-derive the rendered timeline tail from raw events.jsonl text (US-015).
 *  Pure + total: parse + cap to the last TIMELINE_MAX. `fetchTimeline` routes
 *  through this single seam, so a re-fetch (manual `r` refresh) is always a
 *  fresh idempotent re-derivation from the *current* file contents. Returning
 *  `[]` on empty/garbage is correct: the renderer then shows the "no events"
 *  dim row. (US-016's live-tail watcher was retired — see decision 0013.) */
export function readTimelineTail(text: string): TimelineEvent[] {
  return parseEventsJsonl(text).slice(-TIMELINE_MAX);
}

/** The changed-table delta for an event: only tables where before ≠ after
 *  (reads / `--version` yield [] since both maps are empty or equal). This is
 *  the `intake: 2 → 3` headline the timeline exists to surface. */
export function timelineDiff(ev: TimelineEvent): { table: string; before: number; after: number }[] {
  const tables = new Set<string>([...Object.keys(ev.dbBefore), ...Object.keys(ev.dbAfter)]);
  const out: { table: string; before: number; after: number }[] = [];
  for (const table of tables) {
    const before = ev.dbBefore[table] ?? 0;
    const after = ev.dbAfter[table] ?? 0;
    if (before !== after) out.push({ table, before, after });
  }
  return out;
}

// ─── decisions parser (`query sql` + docs/decisions/*.md) (US-024) ────────

/** Durable metadata for one ADR, parsed from the pipe-delimited `query sql`
 *  projection of the `decision` table. The dashboard reads ADR *bodies* from
 *  markdown (the durable layer is metadata-only by design — ADR-0004), so this
 *  carries only the status + verify-age signal markdown cannot provide. */
export interface DecisionMeta {
  status: string;
  lastVerifiedAt: string;
  lastVerifiedResult: string;
}

/**
 * Parse the pipe-delimited `query sql "SELECT id||'|'||title||'|'||status||'|'|
 * COALESCE(last_verified_at,'')||'|'||COALESCE(last_verified_result,'') …"`
 * output into a numId → meta map. The join key is the 4-digit ADR number: the
 * durable `id` is inconsistent (`0009` vs `0009-p2-…`), so only the numeric
 * prefix is stable across the table and the markdown filenames. Pure + total:
 * lines that do not start with a 4-digit id (header, separator, blank) are
 * skipped; never throws on partial/garbage output.
 */
export function parseDecisionMeta(stdout: string): Map<string, DecisionMeta> {
  const out = new Map<string, DecisionMeta>();
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line) continue;
    // <numId><slug>|<title>|<status>|<last_verified_at>|<last_verified_result>
    const m = line.match(/^(\d{4})[a-z0-9-]*\|[^|]*\|([^|]*)\|([^|]*)\|([^|]*)$/);
    if (!m) continue;
    out.set(m[1]!, {
      status: m[2]!.trim(),
      lastVerifiedAt: m[3]!.trim(),
      lastVerifiedResult: m[4]!.trim(),
    });
  }
  return out;
}

/** The parsed body of one ADR markdown file. Each section string is the trimmed
 *  body under its `## <heading>` (empty when absent — ADRs routinely omit
 *  Follow-Up / Alternatives). `title` is the H1 minus any leading `<numId>`. */
export interface AdrBody {
  title: string;
  status: string;
  context: string;
  decision: string;
  alternatives: string;
  consequences: string;
  followUp: string;
}

/** First `# ` heading of a markdown doc, trimmed of the leading `#` and any
 *  leading `<numId>` token (the template's H1 is `# 0010 <title>`). "" if none. */
function parseAdrTitle(md: string): string {
  const m = md.match(/^#\s+(.*)$/m);
  if (!m) return "";
  return m[1]!.trim().replace(/^\d{4}\s+/, "");
}

/**
 * Pure ADR-body parser (US-024). Extracts the title (H1) + each `## <heading>`
 * section via the shared `extractSection` helper. The single source of truth
 * for body rendering; the detail pane only formats its output. Total: missing
 * sections degrade to "" — never throws on a malformed/partial ADR.
 */
export function parseAdrBody(md: string): AdrBody {
  return {
    title: parseAdrTitle(md),
    status: extractSection(md, "Status"),
    context: extractSection(md, "Context"),
    decision: extractSection(md, "Decision"),
    alternatives: extractSection(md, "Alternatives Considered"),
    consequences: extractSection(md, "Consequences"),
    followUp: extractSection(md, "Follow-Up"),
  };
}

/** One ADR as the dashboard consumes it: the readable body (markdown) joined to
 *  the durable verify-age signal on the 4-digit number. */
export interface AdrRow {
  /** 4-digit ADR number, e.g. "0010" — canonical id, sort key, verify id. */
  id: string;
  /** Markdown filename, e.g. "0010-initiative-slices-workflow-model.md". */
  filename: string;
  /** Raw markdown body ("" only if the file was unreadable). */
  body: string;
  /** Durable status ("accepted"…) — "" when the ADR has no durable row. */
  durableStatus: string;
  /** `last_verified_at` from the durable layer — "" when never/untracked. */
  lastVerifiedAt: string;
}

/** Re-verify advisory fires when an ADR was never verified (no durable
 *  `last_verified_at`). Pure: trivially unit-testable. Age-based staleness is
 *  deferred — no in-repo ADR has been verified yet, so any threshold would be
 *  arbitrary until the first `decision verify` lands. */
export function needsReverify(lastVerifiedAt: string): boolean {
  return lastVerifiedAt.trim() === "";
}

/** Human verify-age for the detail view: "never" when blank, else "Nd ago" /
 *  "today". Pure + total; a non-parseable timestamp degrades to "—". */
export function formatAdrAge(lastVerifiedAt: string): string {
  const s = lastVerifiedAt.trim();
  if (!s) return "never";
  // durable timestamps are sqlite datetime('now') → "YYYY-MM-DD HH:MM:SS"
  const t = Date.parse(s.replace(" ", "T"));
  if (!Number.isFinite(t)) return "—";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ─── dashboard data aggregate (all tabs) ─────────────────────────────────────────────

/**
 * All parsed tab data + a per-tab error map. Renderers are pure functions of
 * this object: a present `errors[tab]` wins over the data and renders a dim
 * error row, so a failing query never throws out of the overlay. `matrix` keeps
 * US-010's empty-on-failure semantics (it has its own empty-state row).
 */

// ─── provenance (US-025): per-story intake + trace links ───────────────────

/** One intake linked to a story (the durable `intake.story_id` FK). */
export interface StoryProvenanceIntake {
  id: number;
  inputType: string;
}

/** The provenance behind one story: its linked intakes + trace ids (Tier 2
 *  evidence — US-025). Decisions are omitted: the `decision` table has no
 *  `story_id` FK, so there is no durable per-story decision link; the DECISIONS
 *  tab / US-024 owns decision surfacing. */
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

export interface DashboardData {
  matrix: MatrixRow[];
  stats: StatsCounts;
  backlog: BacklogRow[];
  tools: ToolRow[];
  drift: DriftRecord[];
  /** Last N observer events for the TIMELINE tab (US-015). */
  timeline: TimelineEvent[];
  /** ADRs for the DECISIONS tab (US-024): markdown bodies + durable age. */
  decisions: AdrRow[];
  /** storyId → packet file (filename + raw markdown), for the story detail pane. */
  packets: Record<string, PacketRef>;
  /** Story ids linked by a `spec_slice` intake = the grilled set (US-023).
   *  Drives the Matrix grilled-badge + the detail-pane `next:` line. */
  grilledStoryIds: ReadonlySet<string>;
  /** storyId → linked intakes + trace ids (Tier 2 provenance, US-025). Drives
   *  the detail-pane Provenance lane. Empty map when no story has links yet. */
  provenance: Map<string, StoryProvenance>;
  errors: Partial<Record<DashboardTab, string>>;
}

/** A story packet file: filename + raw markdown text (read at overlay open). */
export interface PacketRef {
  filename: string;
  text: string;
}

// ─── control-surface routing (US-023) ──────────────────────────────────────

/**
 * The next action to take on a story, derived purely from its grilled-status.
 * `grilled` = a `spec_slice` intake links the story (the durable signal).
 * Packet-existence canNOT discriminate, because drift-gate B′ (US-003) forces a
 * packet markdown on every durable story (else `orphan_durable` drift) — so the
 * act of grilling *is* recording the `spec_slice` intake. This pure router is
 * the single source of truth for the Matrix grilled-badge + the detail-pane
 * `next:` line, and is reused by the agent task-loop so both entry points
 * (dashboard + "do US-NNN") route identically. Advisory only — no durable
 * writes originate here (US-014 Command-Query invariant preserved).
 */
export interface NextAction {
  grilled: boolean;
  next: "grill" | "implement";
  prompt: string;
}

/**
 * Pure router: grilled → implement (hand off to a worker against the packet's
 * acceptance criteria); ungrilled → grill (run harness-intake-griller to record
 * a spec_slice intake + packet). Advisory prompt text only; the operator runs
 * it in their own pane/session.
 */
export function nextActionFor(
  story: { id: string },
  grilledStoryIds: ReadonlySet<string>
): NextAction {
  const grilled = grilledStoryIds.has(story.id);
  if (grilled) {
    return {
      grilled: true,
      next: "implement",
      prompt: `implement ${story.id} — worker against docs/stories/${story.id}-*.md (acceptance criteria)`,
    };
  }
  return {
    grilled: false,
    next: "grill",
    prompt: `run harness-intake-griller for ${story.id} (record a spec_slice intake + packet)`,
  };
}

// ─── matrix status-filter (US-026) ─────────────────────────────────────────

/** Matrix status-filter stops (US-026). `f` cycles through these in order. */
export const MATRIX_FILTER_CYCLE = ["all", "planned", "ungrilled", "done"] as const;
export type MatrixFilter = (typeof MATRIX_FILTER_CYCLE)[number];

/**
 * Pure matrix-row filter (US-026). Narrows the full matrix to the rows visible
 * under a given filter stop:
 * - `all`       — every row (identity).
 * - `planned`   — `status = planned` (work not yet started).
 * - `ungrilled` — the grill queue: `status = planned` AND no `spec_slice`
 *   intake linked (the US-023 intake-linkage signal). The primary stop.
 * - `done`      — `status = implemented`.
 * `retired` is deliberately not a stop (low signal; stays visible under `all`).
 * Pure + total: never throws; `undefined`/unknown filter → `all` (identity).
 */
export function filterMatrixRows(
  rows: readonly MatrixRow[],
  grilledStoryIds: ReadonlySet<string>,
  filter: MatrixFilter | undefined
): MatrixRow[] {
  const f = filter ?? "all";
  if (f === "all") return [...rows];
  if (f === "planned") return rows.filter((r) => r.status === "planned");
  if (f === "done") return rows.filter((r) => r.status === "implemented");
  return rows.filter((r) => r.status === "planned" && !grilledStoryIds.has(r.id));
}

// ─── drill-down navigation (US-014) ────────────────────────────────────────

/** Tabs whose body is a selectable list (cursor + drill apply). */
export type ListTab = "matrix" | "backlog" | "drift" | "timeline" | "decisions";

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
  "6": "decisions",
};

const LIST_TABS: ReadonlySet<ListTab> = new Set(["matrix", "backlog", "drift", "timeline", "decisions"]);

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
  lens: { matrix: number; backlog: number; drift: number; timeline: number; decisions: number }
): DashboardNavResult {
  if (isEscape(key)) {
    return nav.drill ? { nav: { ...nav, drill: null } } : { nav, action: "close" };
  }
  if (key === "r") return { nav, action: "refresh" };
  const t = TAB_KEYS[key];
  if (t) return { nav: { tab: t, cursor: 0, drill: null, matrixFilter: "all" } };
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
  const filteredMatrix = filterMatrixRows(data.matrix, data.grilledStoryIds, matrixFilter);
  if (nav.drill) {
    const drillData = nav.drill.kind === "matrix" ? { ...data, matrix: filteredMatrix } : data;
    content.push(...renderDetail(nav.drill, drillData, fg, innerW));
  } else if (nav.tab === "matrix") {
    content.push(...renderMatrixTab(filteredMatrix, data.grilledStoryIds, matrixFilter, nav.cursor, fg, innerW));
  } else if (nav.tab === "stats") {
    content.push(...renderStatsTab(data, fg, innerW));
  } else if (nav.tab === "backlog") {
    content.push(...renderBacklogTab(data, nav.cursor, fg, innerW));
  } else if (nav.tab === "tools") {
    content.push(...renderToolsTab(data, fg, innerW));
  } else if (nav.tab === "drift") {
    content.push(...renderDriftTab(data, nav.cursor, fg, innerW));
  } else if (nav.tab === "timeline") {
    content.push(...renderTimelineTab(data, nav.cursor, fg, innerW));
  } else if (nav.tab === "decisions") {
    content.push(...renderDecisionsTab(data, nav.cursor, fg, innerW));
  }
  content.push("");

  // ── footer hints (context-sensitive: drilled vs list) ──
  content.push(
    dim(
      nav.drill
        ? "[Esc] back to list"
        : "[↑↓/j,k] move · [Enter] open · [1-6,t] tabs · [r] refresh · [Esc] close"
    )
  );
  return box("repository-harness · dashboard", content, fg, w);
}

/** Render the proof-matrix tab body (column header + rows, with a selection
 *  cursor for drill-down). US-023: each row carries a leading grilled-badge
 *  (● grilled / ○ ungrilled) derived from `nextActionFor`. Inner width = innerW. */
function renderMatrixTab(
  matrix: MatrixRow[],
  grilledStoryIds: ReadonlySet<string>,
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

  const BADGE_W = 2; // grilled-badge glyph (●/○) + trailing space
  const idW = 7;
  const statusW = 12;
  const proofW = 7; // "✓ ✓ ✓ ✓" / "u i e p" — 4 marks joined by single spaces
  const gap = 2;
  const titleW = Math.max(10, innerW2 - (BADGE_W + idW + statusW + proofW + 3 * gap));

  // column header (indented to align with the marker column)
  const head =
    padRight(dim("g"), BADGE_W - 1) + " " +
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
    if (filter === "ungrilled") emptyMsg = "(no ungrilled stories — grill queue empty)";
    else if (filter === "planned") emptyMsg = "(no planned stories)";
    else if (filter === "done") emptyMsg = "(no implemented stories)";
    out.push(rowMarker(false) + dim(emptyMsg));
    return out;
  }

  matrix.forEach((r, i) => {
    const action = nextActionFor(r, grilledStoryIds);
    const badge = (action.grilled ? fg("success", "●") : fg("dim", "○")) + " ";
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

// ─── timeline render helpers (US-015) ──────────────────────────────────────

/** Compact duration: 340ms / 8.0s / 12s / — (for 0 or non-finite). */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return s < 100 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

/** `HH:MM:SS` from an ISO-ish ts ("2026-07-04T10:11:30+00:00" → "10:11:30");
 *  "" when the time part is absent. */
function hhmmss(ts: string): string {
  const m = ts.match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1]! : "";
}

/** Joined `table: b→a` delta string for an event (only changed tables; "" when
 *  none — reads / `--version` produce no delta). */
function renderTimelineDiff(ev: TimelineEvent): string {
  const segs = timelineDiff(ev);
  if (segs.length === 0) return "";
  return segs.map((s) => `${s.table}: ${s.before}→${s.after}`).join("  ");
}

/** Render the TIMELINE tab body (US-015): the last N observer events as flow
 *  rows — time · exit mark · cmd · duration · the db delta — with a selection
 *  cursor for drill-down. Degrades to a dim message when the file is absent or
 *  no events exist. Inner width = innerW. */
function renderTimelineTab(data: DashboardData, cursor: number, fg: FgFn, innerW: number): string[] {
  const dim = (t: string) => fg("dim", t);
  if (data.errors.timeline) {
    return [dim("(timeline unavailable — flow logging is off or .harness-observer/events.jsonl is absent)")];
  }
  const events = data.timeline;
  if (events.length === 0) {
    return [dim("(no observer events recorded yet)")];
  }
  const out: string[] = [];
  const innerW2 = innerW - MARK_W;
  const timeW = 8;
  const exitW = 1; // ✓ / ✗
  const durW = 8;
  const gap = 2;
  const cmdW = 26;
  const diffW = Math.max(12, innerW2 - (timeW + exitW + durW + cmdW + 4 * gap));
  out.push(
    rowMarker(false) +
      padRight(dim("time"), timeW) +
      gapSpaces(gap) +
      padRight("", exitW) +
      gapSpaces(gap) +
      padRight(dim("cmd"), cmdW) +
      gapSpaces(gap) +
      padRight(dim("dur"), durW) +
      gapSpaces(gap) +
      dim("delta")
  );
  events.forEach((ev, i) => {
    const exitMark = ev.exit === 0 ? fg("success", "✓") : fg("error", "✗");
    const diff = renderTimelineDiff(ev);
    const diffSeg = diff ? fg("accent", truncateAnsi(diff, diffW)) : padRight("", diffW);
    out.push(
      rowMarker(i === cursor) +
        padRight(hhmmss(ev.ts), timeW) +
        gapSpaces(gap) +
        padRight(exitMark, exitW) +
        gapSpaces(gap) +
        padRight(truncateAnsi(ev.cmd.join(" "), cmdW), cmdW) +
        gapSpaces(gap) +
        padRight(formatDuration(ev.durationMs), durW) +
        gapSpaces(gap) +
        diffSeg
    );
  });
  return out;
}

// ─── decisions render (US-024) ─────────────────────────────────────────────

/** ADR status → color (vocab: proposed/accepted/superseded/rejected). */
function decisionStatusColor(status: string): string {
  if (status === "accepted") return "success";
  if (status === "proposed") return "warning";
  if (status === "superseded") return "dim";
  if (status === "rejected") return "error";
  return "dim"; // unknown / untracked — never throws
}

/** Render the DECISIONS tab body (US-024): the ADR list (id / title / status /
 *  verify-age) with a selection cursor for drill-down. Source is markdown (where
 *  the bodies live), enriched with durable status + age; fetch sorts newest-
 *  first so the cursor index matches the drill index (US-014 invariant). */
function renderDecisionsTab(
  data: DashboardData,
  cursor: number,
  fg: FgFn,
  innerW: number
): string[] {
  const dim = (t: string) => fg("dim", t);
  if (data.errors.decisions) {
    return [dim("(decisions unavailable — query sql or docs/decisions read failed)")];
  }
  const rows = data.decisions;
  if (rows.length === 0) {
    return [dim("(no decisions — docs/decisions/*.md is empty or absent)")];
  }
  const out: string[] = [];
  const innerW2 = innerW - MARK_W;
  const idW = 5;
  const statusW = 10;
  const ageW = 10;
  const gap = 2;
  const titleW = Math.max(12, innerW2 - (idW + statusW + ageW + 3 * gap));
  out.push(
    rowMarker(false) +
      padRight(dim("id"), idW) +
      gapSpaces(gap) +
      padRight(dim("title"), titleW) +
      gapSpaces(gap) +
      padRight(dim("status"), statusW) +
      gapSpaces(gap) +
      dim("verified")
  );
  rows.forEach((r, i) => {
    const body = parseAdrBody(r.body);
    const status = r.durableStatus || body.status || "unknown";
    out.push(
      rowMarker(i === cursor) +
        padRight(r.id, idW) +
        gapSpaces(gap) +
        padRight(truncateAnsi(body.title || r.filename, titleW), titleW) +
        gapSpaces(gap) +
        padRight(fg(decisionStatusColor(status), status), statusW) +
        gapSpaces(gap) +
        padRight(formatAdrAge(r.lastVerifiedAt), ageW)
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

/** Render the drilled STORY detail: packet-derived status/lane + grilled/next
 *  routing (US-023) + Acceptance + Evidence excerpts + the packet path. Pure. */
function renderStoryDetail(
  row: MatrixRow,
  packet: PacketRef | undefined,
  grilledStoryIds: ReadonlySet<string>,
  provenance: StoryProvenance | undefined,
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
  // US-023: grilled-status (intake-linkage) + next-action routing. Advisory only;
  // the operator runs the prompt in their own pane. Shown for every story
  // (grilled-ness is independent of packet presence).
  const action = nextActionFor(row, grilledStoryIds);
  out.push(
    `${dim("grilled:")} ${action.grilled ? fg("success", "yes") : dim("no")}   ` +
      `${dim("next:")} ${action.next === "implement" ? fg("accent", "implement") : fg("warning", "grill")}`
  );
  out.push(dim("→ " + truncateAnsi(action.prompt, innerW - 2)));
  // US-025: Provenance lane — Tier 2 evidence for THIS story (read-only). Shown
  // for every story (independent of packet presence): intake linkage + traces.
  // Decisions omitted — no decision.story_id FK; the DECISIONS tab owns them.
  out.push(dim("Provenance:"));
  const ints = provenance?.intakes ?? [];
  out.push(
    "  " + dim("intake:") + " " +
      (ints.length
        ? truncateAnsi(ints.map((i) => `#${i.id} ${i.inputType}`).join(", "), Math.max(10, innerW - 11))
        : dim("— (no linked intake; grill first)"))
  );
  const trs = provenance?.traces ?? [];
  const shown = trs.slice(0, 5);
  const more = trs.length - shown.length;
  out.push(
    "  " + dim("traces:") + " " +
      (trs.length ? shown.join(", ") + (more > 0 ? dim(` (+${more} more)`) : "") : dim("—"))
  );
  out.push("  " + dim("decisions: see decisions tab (US-024)"));
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

/** Render the drilled TIMELINE detail (US-015): full cmd + exit/duration + the
 *  db delta + stdout/stderr excerpts. Pure. */
function renderTimelineDetail(ev: TimelineEvent, fg: FgFn, innerW: number): string[] {
  const dim = (t: string) => fg("dim", t);
  const out: string[] = [];
  const time = hhmmss(ev.ts);
  out.push(`${fg("accent", time || ev.ts)}  ${truncateAnsi(ev.cmd.join(" "), innerW - (time.length + 2))}`);
  out.push(
    `${dim("Exit:")} ${ev.exit === 0 ? fg("success", "0") : fg("error", String(ev.exit))}   ` +
      `${dim("Duration:")} ${formatDuration(ev.durationMs)}`
  );
  const diff = renderTimelineDiff(ev);
  out.push(`${dim("Delta:")} ${diff ? fg("accent", truncateAnsi(diff, innerW - 7)) : dim("(no state change)")}`);
  const dump = (label: string, body: string): void => {
    out.push(dim(label + ":"));
    const text = body.trim();
    if (!text) {
      out.push(dim("  (empty)"));
      return;
    }
    for (const l of text.split(/\r?\n/).slice(0, 6)) {
      out.push(dim("  " + truncateAnsi(l, innerW - 2)));
    }
  };
  dump("stdout", ev.stdout);
  dump("stderr", ev.stderr);
  return out;
}

/** Render the drilled DECISION detail (US-024): title + status/age + the
 *  advisory re-verify line (mirrors US-023's next-action) + Context/Decision/
 *  Consequences excerpts + the file path. Pure. */
function renderAdrDetail(row: AdrRow, fg: FgFn, innerW: number): string[] {
  const dim = (t: string) => fg("dim", t);
  const out: string[] = [];
  const body = parseAdrBody(row.body);
  const status = row.durableStatus || body.status || "unknown";
  const age = formatAdrAge(row.lastVerifiedAt);
  out.push(`${fg("accent", row.id)}  ${truncateAnsi(body.title || row.filename, innerW - row.id.length - 2)}`);
  out.push(`${dim("Status:")} ${fg(decisionStatusColor(status), status)}   ${dim("Verified:")} ${age === "never" ? fg("warning", age) : dim(age)}`);
  // US-024 advisory re-verify — mirrors US-023's `→ next:` line. Warning when
  // never verified (the actionable case); dim otherwise. Read-only: the
  // operator runs the command; no durable write originates here (US-014).
  out.push(`${needsReverify(row.lastVerifiedAt) ? fg("warning", "→ re-verify:") : dim("→ re-verify:")} run harness-cli decision verify ${row.id}`);
  if (!row.body) {
    out.push(dim(`(body unavailable — ${row.filename} unreadable)`));
    return out;
  }
  out.push(dim("File: " + truncateAnsi(row.filename, innerW - 6)));
  const section = (label: string, text: string, n: number): void => {
    if (!text) return;
    out.push(dim(label + ":"));
    out.push(...sectionLines(text, n, innerW - 2, fg));
  };
  section("Context", body.context, 3);
  section("Decision", body.decision, 3);
  section("Consequences", body.consequences, 2);
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
    return renderStoryDetail(row, data.packets[row.id], data.grilledStoryIds, data.provenance.get(row.id), fg, innerW);
  }
  if (drill.kind === "backlog") {
    const row = data.backlog[drill.index];
    if (!row) return [fg("dim", "(row no longer exists — press r to refresh)")];
    return renderBacklogDetail(row, fg, innerW);
  }
  if (drill.kind === "timeline") {
    const ev = data.timeline[drill.index];
    if (!ev) return [fg("dim", "(row no longer exists — press r to refresh)")];
    return renderTimelineDetail(ev, fg, innerW);
  }
  if (drill.kind === "decisions") {
    const row = data.decisions[drill.index];
    if (!row) return [fg("dim", "(row no longer exists — press r to refresh)")];
    return renderAdrDetail(row, fg, innerW);
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
