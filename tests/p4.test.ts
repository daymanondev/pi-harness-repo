// tests/p4.test.ts — unit tests for the P4 DASHBOARD pure module + /harness wiring.
//
// Run: npx tsx tests/p4.test.ts
//
// Two layers, mirroring tests/p3.test.ts:
//   1. Pure dashboard.ts logic (matrix/stats/backlog/tools parsers, dashboard
//      renderer, box-width alignment, tab placeholders).
//   2. Approach-B wiring: load the REAL index.ts, capture pi.registerCommand,
//      drive the /harness handler against an installed+db fixture with a mock
//      ExtensionAPI whose exec returns `query matrix/stats/backlog/tools`
//      output. Exercises route → fetchDashboardData → overlay (dashboard) →
//      tab switch → refresh loop → close, plus failing-query degradation —
//      without an LLM.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseMatrixNumeric,
  parseStats,
  parseBacklogOpen,
  parseToolsJson,
  reduceDashboardNav,
  renderDashboardLines,
  ZERO_STATS,
  type DashboardData,
  type DashboardNav,
  type DashboardTab,
  type DrillTarget,
} from "../extensions/harness/dashboard.ts";
import { ansiVisibleWidth } from "../extensions/harness/overlay.ts";
import type { HarnessState } from "../extensions/harness/detect.ts";
import { computeDrift, fixHintFor, type DriftKind } from "../extensions/harness/drift.ts";

let passed = 0;
let failed = 0;
const tests: { name: string; fn: () => unknown }[] = [];
function test(name: string, fn: () => unknown) {
  tests.push({ name, fn });
}
async function run() {
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${(e as Error).message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

function bareState(over: Partial<HarnessState> = {}): HarnessState {
  return {
    cwd: "/repo",
    cliInstalled: true,
    cliVersion: "0.1.11",
    dbInitialized: true,
    shimPresent: false,
    claudeShimPresent: false,
    observerInstalled: false,
    ...over,
  };
}
const id = (_c: string, t: string) => t; // identity fg for plain-text assertions

/** Build a DashboardData with empty defaults, overridden by `over`. */
function dashData(over: Partial<DashboardData> = {}): DashboardData {
  return { matrix: [], stats: ZERO_STATS, backlog: [], tools: [], drift: [], packets: {}, errors: {}, ...over };
}

/** Build a DashboardNav for render assertions (cursor + drill default off). */
function nav(tab: DashboardTab, cursor = 0, drill: DrillTarget | null = null): DashboardNav {
  return { tab, cursor, drill };
}

// Captured `query matrix --numeric` shape (3 rows: implemented / planned / retired;
// titles include spaces + punctuation to exercise the parser).
const FIXTURE_MATRIX =
  "id      title                                                             status       unit  integ  e2e  plat  evidence\n" +
  "------  ----------------------------------------------------------------  -----------  ----  -----  ---  ----  --------\n" +
  "US-001  Auth login                                                        implemented  1     1      0    0\n" +
  "US-002  Manager roles                                                     planned      0     0      0    0\n" +
  "US-003  Old/replaced thing                                                retired      0     0      0    0\n";

// Captured `query stats` shape (title + header + separator + one data row).
const FIXTURE_STATS =
  "=== Harness Stats ===\n" +
  "intakes  stories  decisions  backlog_items  traces\n" +
  "-------  -------  ---------  -------------  ------\n" +
  "12       12       4          4              17    \n";

// Captured `query backlog --open` shape: free-text titles (incl. '<->' and "'"),
// 2-space column gaps, trailing free-text predicted_impact the parser ignores.
const FIXTURE_BACKLOG =
  "id  title                                    status    risk  predicted_impact  actual_outcome\n" +
  "--  ---------------------------------------  --------  ----  ----------------  --------------\n" +
  "2   markdown<->durable status drift pattern  proposed  tiny  A cross-check makes drift visible within one session.\n" +
  "3   Gate B' over-blocks compound scripts     implemented  tiny  Inspect argv instead of substring-grepping.\n";

// Captured `query tools --json` shape (native JSON; missing-status row exercises
// the · mark, unknown fields degrade to placeholders).
const FIXTURE_TOOLS_JSON = JSON.stringify([
  { name: "init", kind: "builtin", responsibility: "Task state", status: "present" },
  { name: "query matrix", kind: "builtin", responsibility: "Task state", status: "present" },
  { name: "eslint", kind: "external", responsibility: "Verification", status: "absent" },
  { name: "ghost", kind: "builtin" }, // missing responsibility + status → placeholders
]);

// ─── parser: matrix ────────────────────────────────────────────────────────

console.log("=== dashboard: parseMatrixNumeric ===");
test("parses rows: id, title (with spaces), status, 4 proof cols", () => {
  const rows = parseMatrixNumeric(FIXTURE_MATRIX);
  assert.equal(rows.length, 3);
  const r = rows[0]!;
  assert.equal(r.id, "US-001");
  assert.equal(r.title, "Auth login");
  assert.equal(r.status, "implemented");
  assert.equal(r.unit, 1);
  assert.equal(r.integ, 1);
  assert.equal(r.e2e, 0);
  assert.equal(r.plat, 0);
});
test("title with punctuation ('/' ) is kept verbatim", () => {
  const rows = parseMatrixNumeric(FIXTURE_MATRIX);
  assert.equal(rows[2]!.title, "Old/replaced thing");
  assert.equal(rows[2]!.status, "retired");
});
test("skips header + separator + blank lines (no false rows)", () => {
  const rows = parseMatrixNumeric(FIXTURE_MATRIX);
  assert.ok(rows.every((r) => /^US-\d+$/.test(r.id)));
});
test("empty / garbage stdout → [] (never throws)", () => {
  assert.deepEqual(parseMatrixNumeric(""), []);
  assert.deepEqual(parseMatrixNumeric("noise\nno ids here\n"), []);
});
test("a malformed data row (missing proof cols) is skipped, not crashed", () => {
  const out =
    "US-009  Truncated row with no numbers\n" +
    "US-010  Good row                                       implemented  1  1  0  0\n";
  const rows = parseMatrixNumeric(out);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, "US-010");
});

// ─── parser: stats ─────────────────────────────────────────────────────────

console.log("=== dashboard: parseStats ===");
test("parses the 5 counts past title + header + separator", () => {
  const c = parseStats(FIXTURE_STATS);
  assert.deepEqual(c, {
    intakes: 12,
    stories: 12,
    decisions: 4,
    backlogItems: 4,
    traces: 17,
  });
});
test("empty / garbage / header-only stdout → null (never throws)", () => {
  assert.equal(parseStats(""), null);
  assert.equal(parseStats("noise\n"), null);
  assert.equal(parseStats("=== Harness Stats ===\nintakes  stories  decisions  backlog_items  traces\n"), null);
});
test("ignores a trailing extra numeric column (takes first 5)", () => {
  const out =
    "intakes  stories  decisions  backlog_items  traces  extra\n" +
    "-------  -------  ---------  -------------  ------  -----\n" +
    "1        2        3          4              5       99\n";
  const c = parseStats(out);
  assert.equal(c?.intakes, 1);
  assert.equal(c?.traces, 5);
});

// ─── parser: backlog ───────────────────────────────────────────────────────

console.log("=== dashboard: parseBacklogOpen ===");
test("parses id/title/status/risk; title keeps spaces + special chars", () => {
  const rows = parseBacklogOpen(FIXTURE_BACKLOG);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.id, 2);
  assert.equal(rows[0]!.title, "markdown<->durable status drift pattern");
  assert.equal(rows[0]!.status, "proposed");
  assert.equal(rows[0]!.risk, "tiny");
  assert.equal(rows[1]!.title, "Gate B' over-blocks compound scripts");
  assert.equal(rows[1]!.status, "implemented");
});
test("skips header + separator (no false rows); ignores trailing free text", () => {
  const rows = parseBacklogOpen(FIXTURE_BACKLOG);
  assert.ok(rows.every((r) => typeof r.id === "number"));
  assert.ok(!rows.some((r) => /predicted_impact/.test(r.title)));
});
test("empty stdout → [] (never throws)", () => {
  assert.deepEqual(parseBacklogOpen(""), []);
});

// ─── parser: tools (JSON) ──────────────────────────────────────────────────

console.log("=== dashboard: parseToolsJson ===");
test("parses JSON array into rows (name/kind/responsibility/status)", () => {
  const rows = parseToolsJson(FIXTURE_TOOLS_JSON)!;
  assert.equal(rows.length, 4);
  assert.equal(rows[0]!.name, "init");
  assert.equal(rows[0]!.status, "present");
  assert.equal(rows[2]!.status, "absent");
});
test("missing fields degrade to placeholders ('-' / '?'), never throw", () => {
  const rows = parseToolsJson(FIXTURE_TOOLS_JSON)!;
  const ghost = rows[3]!;
  assert.equal(ghost.responsibility, "-");
  assert.equal(ghost.status, "?");
});
test("malformed JSON → null; non-array → null (never throws)", () => {
  assert.equal(parseToolsJson("not json"), null);
  assert.equal(parseToolsJson("{"), null);
  assert.equal(parseToolsJson('{"a":1}'), null);
});

// ─── render: matrix tab ────────────────────────────────────────────────────

console.log("=== dashboard: renderDashboardLines (matrix tab) ===");
test("renders title, detected-state header, tab strip, footer hints", () => {
  const text = renderDashboardLines(bareState(), nav("matrix"), dashData({ matrix: parseMatrixNumeric(FIXTURE_MATRIX) }), id).join("\n");
  assert.match(text, /repository-harness · dashboard/);
  assert.match(text, /cli 0\.1\.11/);
  assert.match(text, /db ok/);
  assert.match(text, /1 matrix/);
  assert.match(text, /2 stats.*3 backlog.*4 tools.*5 drift.*t timeline/);
  assert.match(text, /\[1-5\] tabs.*\[r\] refresh.*\[Esc\] close/);
});
test("matrix tab lists every story row with status + id", () => {
  const text = renderDashboardLines(bareState(), nav("matrix"), dashData({ matrix: parseMatrixNumeric(FIXTURE_MATRIX) }), id).join("\n");
  assert.match(text, /US-001/);
  assert.match(text, /Auth login/);
  assert.match(text, /implemented/);
  assert.match(text, /US-002/);
  assert.match(text, /planned/);
  assert.match(text, /US-003/);
  assert.match(text, /retired/);
});
test("empty matrix → dim empty-state row (no throw)", () => {
  const text = renderDashboardLines(bareState(), nav("matrix"), dashData(), id).join("\n");
  assert.match(text, /no stories/);
});

// ─── render: stats tab ─────────────────────────────────────────────────────

console.log("=== dashboard: renderDashboardLines (stats tab) ===");
test("renders every count label + its value", () => {
  const text = renderDashboardLines(bareState(), nav("stats"), dashData({ stats: parseStats(FIXTURE_STATS)! }), id).join("\n");
  assert.match(text, /intakes/);
  assert.match(text, /stories/);
  assert.match(text, /decisions/);
  assert.match(text, /backlog/);
  assert.match(text, /traces/);
  // values from FIXTURE_STATS
  for (const v of ["12", "4", "17"]) assert.match(text, new RegExp(`\\b${v}\\b`), `value ${v}`);
});
test("stats fetch error → dim error row, no counts", () => {
  const text = renderDashboardLines(bareState(), nav("stats"), dashData({ errors: { stats: "stats" } }), id).join("\n");
  assert.match(text, /stats unavailable/);
  assert.doesNotMatch(text, /intakes/);
});

// ─── render: backlog tab ───────────────────────────────────────────────────

console.log("=== dashboard: renderDashboardLines (backlog tab) ===");
test("renders every open backlog row with status + risk", () => {
  const text = renderDashboardLines(bareState(), nav("backlog"), dashData({ backlog: parseBacklogOpen(FIXTURE_BACKLOG) }), id).join("\n");
  assert.match(text, /markdown<->durable/);
  assert.match(text, /proposed/);
  assert.match(text, /tiny/);
  assert.match(text, /Gate B'/);
  assert.match(text, /implemented/);
});
test("empty backlog → dim empty-state row", () => {
  const text = renderDashboardLines(bareState(), nav("backlog"), dashData(), id).join("\n");
  assert.match(text, /no open backlog items/);
});
test("backlog fetch error → dim error row", () => {
  const text = renderDashboardLines(bareState(), nav("backlog"), dashData({ errors: { backlog: "backlog" } }), id).join("\n");
  assert.match(text, /backlog unavailable/);
});

// ─── render: tools tab ─────────────────────────────────────────────────────

console.log("=== dashboard: renderDashboardLines (tools tab) ===");
test("renders every tool with ✓ for present and · for absent", () => {
  const rows = parseToolsJson(FIXTURE_TOOLS_JSON)!;
  const text = renderDashboardLines(bareState(), nav("tools"), dashData({ tools: rows }), id).join("\n");
  assert.match(text, /init/);
  assert.match(text, /query matrix/);
  assert.match(text, /Task state/);
  // present tools render ✓; the absent 'eslint' still lists its name
  assert.match(text, /eslint/);
});
test("empty tools → dim empty-state row", () => {
  const text = renderDashboardLines(bareState(), nav("tools"), dashData(), id).join("\n");
  assert.match(text, /no tools registered/);
});
test("tools fetch error → dim error row", () => {
  const text = renderDashboardLines(bareState(), nav("tools"), dashData({ errors: { tools: "tools" } }), id).join("\n");
  assert.match(text, /tools unavailable/);
});

// ─── drift: pure computeDrift + Drift tab (US-012) ──────────────────────────

console.log("=== drift: computeDrift (pure) ===");
test("computeDrift: clean durable↔markdown → no drift", () => {
  const durable = { "US-1": "implemented", "US-2": "planned" };
  const md = {
    "US-1": { status: "implemented", evidenceMissing: false },
    "US-2": { status: "planned", evidenceMissing: true }, // planned: evidence not required
  };
  assert.deepEqual(computeDrift(durable, md), []);
});
test("computeDrift: status_mismatch carries durable/markdown + fixHint", () => {
  const r = computeDrift(
    { "US-9": "implemented" },
    { "US-9": { status: "planned", evidenceMissing: false } }
  );
  assert.equal(r.length, 1);
  assert.equal(r[0]!.kind, "status_mismatch");
  assert.equal(r[0]!.durable, "implemented");
  assert.equal(r[0]!.markdown, "planned");
  assert.equal(r[0]!.fixHint, fixHintFor("status_mismatch"));
});
test("computeDrift: orphan_markdown (file exists, no durable row)", () => {
  const r = computeDrift({}, { "US-5": { status: "implemented", evidenceMissing: false } });
  assert.equal(r.length, 1);
  assert.equal(r[0]!.kind, "orphan_markdown");
  assert.equal(r[0]!.durable, "(no row)");
  assert.equal(r[0]!.fixHint, fixHintFor("orphan_markdown"));
});
test("computeDrift: orphan_durable for active rows; retired row is NOT drift", () => {
  const r = computeDrift({ "US-7": "planned", "US-8": "retired" }, {});
  assert.equal(r.length, 1);
  assert.equal(r[0]!.kind, "orphan_durable");
  assert.equal(r[0]!.storyId, "US-7");
  assert.equal(r[0]!.markdown, "(no file)");
});
test("computeDrift: missing_evidence only for implemented stories", () => {
  const r = computeDrift(
    { "US-1": "implemented" },
    { "US-1": { status: "implemented", evidenceMissing: true } }
  );
  assert.equal(r.length, 1);
  assert.equal(r[0]!.kind, "missing_evidence");
  assert.ok(/Evidence/.test(r[0]!.fixHint ?? ""));
});
test("fixHintFor: every kind has a non-empty hint", () => {
  const kinds: DriftKind[] = ["status_mismatch", "orphan_markdown", "orphan_durable", "missing_evidence"];
  for (const k of kinds) assert.ok(fixHintFor(k).length > 0, `hint for ${k}`);
});

console.log("=== dashboard: renderDashboardLines (drift tab) ===");
test("drift tab: 'no drift' line when clean", () => {
  const text = renderDashboardLines(bareState(), nav("drift"), dashData(), id).join("\n");
  assert.match(text, /no drift.*markdown.*durable agree/);
});
test("drift tab: renders each mismatch + its fix hint", () => {
  const drift = computeDrift(
    { "US-9": "implemented" },
    { "US-9": { status: "planned", evidenceMissing: false } }
  );
  const text = renderDashboardLines(bareState(), nav("drift"), dashData({ drift }), id).join("\n");
  assert.match(text, /US-9/);
  assert.match(text, /status_mismatch/);
  assert.match(text, /implemented \| planned/);
  assert.match(text, /## Status/); // fixHint substring
});
test("drift tab: dim error row when data.errors.drift", () => {
  const text = renderDashboardLines(bareState(), nav("drift"), dashData({ errors: { drift: "drift" } }), id).join("\n");
  assert.match(text, /drift unavailable/);
});

// ─── render: timeline is still the honest P5 placeholder ───────────────────

console.log("=== dashboard: renderDashboardLines (timeline placeholder) ===");
test("timeline tab still ships-in-P5 placeholder", () => {
  const text = renderDashboardLines(bareState(), nav("timeline"), dashData(), id).join("\n");
  assert.match(text, /timeline tab ships in P5/);
});

// ─── drill-down: nav reducer + detail panes (US-014) ─────────────────────

console.log("=== dashboard: reduceDashboardNav (pure) ===");
const LENS = (m: number, b: number, d: number) => ({ matrix: m, backlog: b, drift: d });

test("reducer: ↓/j moves cursor down, clamped to list length-1", () => {
  const start: DashboardNav = { tab: "matrix", cursor: 0, drill: null };
  const a = reduceDashboardNav(start, "\x1b[B", LENS(3, 0, 0)).nav;
  assert.equal(a.cursor, 1);
  const b = reduceDashboardNav(a, "\x1b[B", LENS(3, 0, 0)).nav;
  assert.equal(b.cursor, 2);
  // clamp at len-1
  const c = reduceDashboardNav(b, "\x1b[B", LENS(3, 0, 0)).nav;
  assert.equal(c.cursor, 2);
});
test("reducer: ↑/k moves cursor up, clamped to 0", () => {
  const start: DashboardNav = { tab: "matrix", cursor: 2, drill: null };
  const a = reduceDashboardNav(start, "k", LENS(3, 0, 0)).nav;
  assert.equal(a.cursor, 1);
  const b = reduceDashboardNav(a, "\x1b[A", LENS(3, 0, 0)).nav;
  assert.equal(b.cursor, 0);
  const c = reduceDashboardNav(b, "k", LENS(3, 0, 0)).nav;
  assert.equal(c.cursor, 0);
});
test("reducer: Enter drills selected row; Esc pops back (not close); Esc on list closes", () => {
  const start: DashboardNav = { tab: "matrix", cursor: 1, drill: null };
  const d = reduceDashboardNav(start, "\r", LENS(3, 0, 0)).nav;
  assert.deepEqual(d.drill, { kind: "matrix", index: 1 });
  // Esc while drilled → pop only
  const back = reduceDashboardNav(d, "\u001b", LENS(3, 0, 0));
  assert.equal(back.nav.drill, null);
  assert.equal(back.action, undefined);
  // Esc when not drilled → close
  const close = reduceDashboardNav(back.nav, "\u001b", LENS(3, 0, 0));
  assert.equal(close.action, "close");
});
test("reducer: tab switch (1-5/t) resets cursor + drill", () => {
  const start: DashboardNav = { tab: "matrix", cursor: 2, drill: { kind: "matrix", index: 2 } };
  const r = reduceDashboardNav(start, "3", LENS(0, 0, 0)).nav;
  assert.equal(r.tab, "backlog");
  assert.equal(r.cursor, 0);
  assert.equal(r.drill, null);
});
test("reducer: empty list disables drill + cursor move", () => {
  const start: DashboardNav = { tab: "drift", cursor: 0, drill: null };
  assert.equal(reduceDashboardNav(start, "\r", LENS(0, 0, 0)).nav.drill, null);
  assert.equal(reduceDashboardNav(start, "j", LENS(0, 0, 0)).nav.cursor, 0);
});
test("reducer: cursor/drill no-op on non-list tabs (stats/tools)", () => {
  const start: DashboardNav = { tab: "stats", cursor: 0, drill: null };
  assert.equal(reduceDashboardNav(start, "j", LENS(0, 0, 0)).nav.cursor, 0);
  assert.equal(reduceDashboardNav(start, "\r", LENS(0, 0, 0)).nav.drill, null);
});
test("reducer: drilled state ignores cursor keys + Enter (Esc is the only exit)", () => {
  const drilled: DashboardNav = { tab: "backlog", cursor: 1, drill: { kind: "backlog", index: 1 } };
  assert.equal(reduceDashboardNav(drilled, "j", LENS(0, 5, 0)).nav.cursor, 1);
  assert.equal(reduceDashboardNav(drilled, "\r", LENS(0, 5, 0)).nav.drill?.index, 1);
});

console.log("=== dashboard: detail panes (drill-down) ===");
const PACKET = (id: string, status: string, lane: string, ac: string, ev: string) => ({
  filename: `${id}-foo.md`,
  text: `# ${id} Title\n\n## Status\n\n${status}\n\n## Lane\n\n${lane}\n\n## Acceptance Criteria\n\n${ac}\n\n## Evidence\n\n${ev}\n`,
});

test("story detail: renders id, status, lane, packet path, AC + Evidence excerpts", () => {
  const row = { id: "US-014", title: "Drill-down navigator", status: "in_progress", unit: 0, integ: 0, e2e: 0, plat: 0 };
  const data = dashData({
    matrix: [row],
    packets: { "US-014": PACKET("US-014", "in_progress", "normal", "- Cursor moves.\n- Enter drills.", "t=42 passed") },
  });
  const text = renderDashboardLines(bareState(), nav("matrix", 0, { kind: "matrix", index: 0 }), data, id).join("\n");
  assert.match(text, /US-014/);
  assert.match(text, /in_progress/);
  assert.match(text, /Lane:.*normal/);
  assert.match(text, /US-014-foo\.md/);
  assert.match(text, /Cursor moves/);
  assert.match(text, /t=42 passed/);
});
test("story detail: missing packet → '(no packet file — orphan durable)'", () => {
  const row = { id: "US-999", title: "Ghost story", status: "planned", unit: 0, integ: 0, e2e: 0, plat: 0 };
  const data = dashData({ matrix: [row], packets: {} });
  const text = renderDashboardLines(bareState(), nav("matrix", 0, { kind: "matrix", index: 0 }), data, id).join("\n");
  assert.match(text, /no packet file/);
  assert.match(text, /US-999/);
});
test("backlog detail: renders full fields + detail tail", () => {
  const row = { id: 5, title: "Dashboard view-only", status: "proposed", risk: "normal", detail: "Turns gauge into control surface." };
  const data = dashData({ backlog: [row] });
  const text = renderDashboardLines(bareState(), nav("backlog", 0, { kind: "backlog", index: 0 }), data, id).join("\n");
  assert.match(text, /Dashboard view-only/);
  assert.match(text, /proposed/);
  assert.match(text, /Risk:.*normal/);
  assert.match(text, /Turns gauge into control surface/);
});
test("drift detail: renders mismatch sides + fix hint", () => {
  const drift = computeDrift({ "US-9": "implemented" }, { "US-9": { status: "planned", evidenceMissing: false } });
  const data = dashData({ drift });
  const text = renderDashboardLines(bareState(), nav("drift", 0, { kind: "drift", index: 0 }), data, id).join("\n");
  assert.match(text, /US-9/);
  assert.match(text, /status_mismatch/);
  assert.match(text, /Durable:.*implemented/);
  assert.match(text, /Markdown:.*planned/);
  assert.match(text, /## Status/); // fixHint substring
});

// ─── render: box-width alignment ───────────────────────────────────────────

console.log("=== dashboard: box-width alignment ===");
const fullData = dashData({
  matrix: parseMatrixNumeric(FIXTURE_MATRIX),
  stats: parseStats(FIXTURE_STATS)!,
  backlog: parseBacklogOpen(FIXTURE_BACKLOG),
  tools: parseToolsJson(FIXTURE_TOOLS_JSON)!,
});
test("every rendered line is exactly the box width (76 outer) on every tab", () => {
  for (const tab of ["matrix", "stats", "backlog", "tools", "timeline"] as DashboardTab[]) {
    const lines = renderDashboardLines(bareState(), nav(tab), fullData, id, 76);
    for (const ln of lines) {
      assert.equal(ansiVisibleWidth(ln), 76, `${tab}: line not 76 cols: ${JSON.stringify(ln)}`);
    }
  }
});
test("alignment holds at the narrower floor width (60) on every tab", () => {
  for (const tab of ["matrix", "stats", "backlog", "tools"] as DashboardTab[]) {
    const lines = renderDashboardLines(bareState(), nav(tab), fullData, id, 60);
    for (const ln of lines) {
      assert.equal(ansiVisibleWidth(ln), 60, `${tab}: line not 60 cols: ${JSON.stringify(ln)}`);
    }
  }
});

// ─── Approach B: wiring through the REAL index.ts ──────────────────────────

console.log("=== wiring: /harness → DASHBOARD route + triplet fetch ===");

/** A realistic `query matrix --numeric` body for the wired exec mock. */
const WIRED_MATRIX =
  "US-001  P1 detect + footer      implemented  1  1  0  0\n" +
  "US-010  P4 dashboard shell      planned      0  0  0  0\n";
const WIRED_STATS =
  "=== Harness Stats ===\n" +
  "intakes  stories  decisions  backlog_items  traces\n" +
  "-------  -------  ---------  -------------  ------\n" +
  "2        2        0          0              1    \n";
const WIRED_BACKLOG =
  "id  title                       status     risk  predicted_impact\n" +
  "--  --------------------------  ---------  ----  ----------------\n" +
  "2   markdown drift cross-check  proposed   tiny  makes drift visible\n";
const WIRED_TOOLS_JSON = JSON.stringify([
  { name: "init", kind: "builtin", responsibility: "Task state", status: "present" },
  { name: "query matrix", kind: "builtin", responsibility: "Task state", status: "present" },
]);

/**
 * Mock ExtensionAPI + ctx. `keySeqs[i]` is the key sequence driven on the i-th
 * `ctx.ui.custom` call; after each non-closing key the component is re-rendered
 * into `renders` so tests can assert tab switches. Per-query stdout/code model
 * a failing query for the degradation tests.
 */
function mockHarness(
  cwd: string,
  opts: {
    keySeqs?: string[][];
    matrixStdout?: string;
    matrixCode?: number;
    statsStdout?: string;
    statsCode?: number;
    backlogStdout?: string;
    backlogCode?: number;
    toolsStdout?: string;
    toolsCode?: number;
  } = {}
) {
  const matrixStdout = opts.matrixStdout ?? WIRED_MATRIX;
  const matrixCode = opts.matrixCode ?? 0;
  const keySeqs = opts.keySeqs ?? [["\u001b"]];
  const execCalls: { cmd: string; args: string[] }[] = [];
  const state = { customCalls: 0, matrixCalls: 0, renders: [] as string[][] };
  let seqIdx = 0;
  const registeredCommands = new Map<string, (a: string, c: unknown) => Promise<void>>();

  const pi = {
    registerCommand(name: string, o: { handler: (a: string, c: unknown) => Promise<void> }) {
      registeredCommands.set(name, o.handler);
    },
    on() {
      /* not exercised by the command handler */
    },
    async exec(cmd: string, args: string[]) {
      execCalls.push({ cmd, args });
      if (args[0] === "--version")
        return { stdout: "harness-cli 0.1.11\n", stderr: "", code: 0, killed: false };
      if (args[0] === "query" && args[1] === "stats") {
        return { stdout: opts.statsStdout ?? WIRED_STATS, stderr: "", code: opts.statsCode ?? 0, killed: false };
      }
      if (args[0] === "query" && args[1] === "backlog") {
        return { stdout: opts.backlogStdout ?? WIRED_BACKLOG, stderr: "", code: opts.backlogCode ?? 0, killed: false };
      }
      if (args[0] === "query" && args[1] === "tools") {
        return { stdout: opts.toolsStdout ?? WIRED_TOOLS_JSON, stderr: "", code: opts.toolsCode ?? 0, killed: false };
      }
      if (args[0] === "query" && args[1] === "matrix") {
        state.matrixCalls++;
        return { stdout: matrixStdout, stderr: "", code: matrixCode, killed: false };
      }
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
  };

  const ctx = {
    cwd,
    signal: undefined as AbortSignal | undefined,
    mode: "tui" as const,
    hasUI: true,
    ui: {
      theme: { fg: (_c: string, t: string) => t },
      notify: () => {},
      setStatus: () => {},
      custom: async (
        factory: (t: unknown, th: unknown, kb: unknown, done: (r: unknown) => void) => {
          handleInput?(d: string): void;
          render?(w: number): string[];
        }
      ) => {
        state.customCalls++;
        let result: unknown;
        const done = (r: unknown) => {
          result = r;
        };
        const comp = factory({}, { fg: (_c: string, t: string) => t }, {}, done);
        const renders: string[] = [];
        if (typeof comp.render === "function") renders.push(comp.render(76).join("\n"));
        const seq = keySeqs[seqIdx++] ?? ["\u001b"];
        for (const k of seq) {
          comp.handleInput?.(k);
          if (result !== undefined) break;
          if (typeof comp.render === "function") renders.push(comp.render(76).join("\n"));
        }
        state.renders.push(renders);
        return result;
      },
    },
  };

  return { pi, ctx, execCalls, state, registeredCommands };
}

/** Fixture: a repo where detect() sees harness as installed + db-ok. */
function installedRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), "harness-dash-"));
  mkdirSync(join(cwd, "scripts", "bin"), { recursive: true });
  writeFileSync(join(cwd, "scripts", "bin", "harness-cli"), "#!/bin/sh\n"); // CLI present
  writeFileSync(join(cwd, "harness.db"), ""); // db present
  return cwd;
}

test("installed+db → DASHBOARD route: fetches matrix/stats/backlog/tools, no installer", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, execCalls, state, registeredCommands } = mockHarness(cwd);
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);

    assert.equal(state.customCalls, 1, "dashboard overlay opens exactly once");
    assert.equal(state.matrixCalls, 2, "matrix fetched by fetchMatrix (--numeric) + the drift cross-check (no flag), once each per open");
    for (const sub of ["matrix", "stats", "backlog", "tools"] as const) {
      assert.ok(
        execCalls.some((c) => c.args[0] === "query" && c.args[1] === sub),
        `must exec query ${sub} (triplet)`
      );
    }
    assert.ok(
      !execCalls.some((c) => c.args[0] === "-c" && /curl/.test((c.args[1] ?? ""))),
      "installer must NOT run on the dashboard route"
    );
    // initial render shows matrix rows
    assert.match(state.renders[0]![0]!, /repository-harness · dashboard/);
    assert.match(state.renders[0]![0]!, /US-001/);
    assert.match(state.renders[0]![0]!, /US-010/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("tab switch: '2' stats content; '3' backlog content; '4' tools content; '1' back to matrix", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, {
      keySeqs: [["2", "3", "4", "1", "\u001b"]],
    });
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);

    const renders = state.renders[0]!;
    assert.match(renders[0]!, /US-001/, "initial render = matrix tab");
    assert.match(renders[1]!, /intakes/, "after '2' = stats tab content");
    assert.match(renders[2]!, /markdown drift/, "after '3' = backlog tab content");
    assert.match(renders[3]!, /init/, "after '4' = tools tab content");
    assert.match(renders[4]!, /US-001/, "after '1' = back to matrix");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("drift tab ('5'): surfaces markdown↔durable drift on the live fixture", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  mkdirSync(join(cwd, "docs", "stories"), { recursive: true });
  // US-001 packet disagrees with the durable row (status_mismatch); US-010 has
  // no packet at all (orphan_durable) — the same class Gate B′ blocks on.
  writeFileSync(join(cwd, "docs", "stories", "US-001-foo.md"), "# US-001\n\n## Status\n\nplanned\n");
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, { keySeqs: [["5", "\u001b"]] });
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);
    const driftRender = state.renders[0]![1]!;
    assert.match(driftRender, /status_mismatch/);
    assert.match(driftRender, /US-001/);
    assert.match(driftRender, /orphan_durable/);
    assert.match(driftRender, /US-010/);
    assert.match(driftRender, /## Status/); // a fixHint is rendered
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("refresh loop: 'r' re-fetches all tabs and re-opens the overlay", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, execCalls, state, registeredCommands } = mockHarness(cwd, {
      keySeqs: [["r"], ["\u001b"]],
    });
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);

    assert.equal(state.customCalls, 2, "overlay re-opens once per refresh");
    assert.equal(state.matrixCalls, 4, "matrix re-fetched on each refresh by both fetchMatrix + drift (2 opens × 2)");
    // each dashboard tab query is re-fetched on both opens. (detect() also runs a
    // cached `query stats` for the footer counts — that is the +1 over 4×2 — so
    // assert per-subcommand rather than on the raw total.)
    for (const sub of ["matrix", "stats", "backlog", "tools"] as const) {
      const n = execCalls.filter((c) => c.args[0] === "query" && c.args[1] === sub).length;
      assert.ok(n >= 2, `query ${sub} fetched on each open (>=2); got ${n}`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Esc closes the dashboard overlay", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, { keySeqs: [["\u001b"]] });
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);
    assert.equal(state.customCalls, 1, "single open, then close — no loop");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("failing matrix query (exit 1) → empty matrix, dim empty-state, no throw", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, {
      matrixStdout: "",
      matrixCode: 1,
      keySeqs: [["\u001b"]],
    });
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never); // must not throw
    assert.match(state.renders[0]![0]!, /no stories/, "matrix degrades to empty-state row");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("failing stats query → stats tab shows a dim error row, never throws", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, {
      statsStdout: "",
      statsCode: 1,
      keySeqs: [["2", "\u001b"]],
    });
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never); // must not throw
    const statsRender = state.renders[0]![1]!;
    assert.match(statsRender, /stats unavailable/, "stats tab degrades to error row");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("failing tools query (bad JSON) → tools tab shows a dim error row", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, {
      toolsStdout: "not json at all",
      toolsCode: 0,
      keySeqs: [["4", "\u001b"]],
    });
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);
    const toolsRender = state.renders[0]![1]!;
    assert.match(toolsRender, /tools unavailable/, "tools tab degrades to error row on bad JSON");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("failing backlog query (exit 1) → backlog tab shows a dim error row, never throws", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, {
      backlogStdout: "",
      backlogCode: 1,
      keySeqs: [["3", "\u001b"]],
    });
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never); // must not throw
    const backlogRender = state.renders[0]![1]!;
    assert.match(backlogRender, /backlog unavailable/, "backlog tab degrades to error row");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

void run();
