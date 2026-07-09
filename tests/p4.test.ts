// tests/p4.test.ts — unit tests for the DASHBOARD pure module + /harness wiring.
//
// Run: npx tsx tests/p4.test.ts
//
// Two layers, mirroring tests/p3.test.ts:
//   1. Pure dashboard.ts logic (matrix/backlog parsers, dashboard renderer,
//      box-width alignment, control-surface routing).
//   2. Approach-B wiring: load the REAL index.ts, capture pi.registerCommand,
//      drive the /harness handler against an installed+db fixture with a mock
//      ExtensionAPI whose exec returns `query matrix/backlog` output. Exercises
//      route → fetchDashboardData → overlay (dashboard) → tab switch → refresh
//      loop → close, plus failing-query degradation — without an LLM.
//
// US-040: the dashboard was decluttered to Matrix + Backlog only. The earlier
// stats/tools/drift/timeline/decisions/initiatives tab tests were removed with
// the tabs; drift still has pure computeDrift coverage (drift.ts is live —
// Gate B′ + the footer use it directly).

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseMatrixNumeric,
  parseClassifiedStoryIds,
  parseInitiatives,
  parseBacklogOpen,
  parseIntakesByStory,
  parseTracesByStory,
  buildProvenance,
  reduceDashboardNav,
  renderDashboardLines,
  nextActionFor,
  dispatchPromptFor,
  filterMatrixRows,
  buildIntakeByStory,
  type DashboardData,
  type DashboardNav,
  type DashboardTab,
  type DrillTarget,
} from "../extensions/harness/dashboard.ts";
import { ansiVisibleWidth, normalizeKey } from "../extensions/harness/overlay.ts";
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
  return { matrix: [], backlog: [], packets: {}, classifiedStoryIds: new Set(), provenance: new Map(), initiatives: [], errors: {}, ...over };
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

// Captured `query backlog --open` shape: free-text titles (incl. '<->' and "'"),
// 2-space column gaps, trailing free-text predicted_impact the parser ignores.
const FIXTURE_BACKLOG =
  "id  title                                    status    risk  predicted_impact  actual_outcome\n" +
  "--  ---------------------------------------  --------  ----  ----------------  --------------\n" +
  "2   markdown<->durable status drift pattern  proposed  tiny  A cross-check makes drift visible within one session.\n" +
  "3   Gate B' over-blocks compound scripts     implemented  tiny  Inspect argv instead of substring-grepping.\n";

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

// ─── control-surface routing (US-023) ─────────────────────────────────────

console.log("=== dashboard: nextActionFor + grilled signal (US-023) ===");
test("parseClassifiedStoryIds: extracts US-NNN tokens, ignores header/separator", () => {
  const sql = "story_id\n--------\nUS-006  \nUS-023  \n";
  assert.deepEqual(parseClassifiedStoryIds(sql), new Set(["US-006", "US-023"]));
});
test("parseClassifiedStoryIds: empty/noise/garbage → empty set (never throws)", () => {
  assert.deepEqual(parseClassifiedStoryIds(""), new Set());
  assert.deepEqual(parseClassifiedStoryIds("story_id\n--------\nno ids here\n"), new Set());
});
test("nextActionFor: classified story → implement + packet-path prompt", () => {
  const a = nextActionFor({ id: "US-023" }, new Set(["US-023", "US-006"]));
  assert.equal(a.classified, true);
  assert.equal(a.next, "implement");
  assert.match(a.prompt, /implement US-023/);
  assert.match(a.prompt, /docs\/stories\/US-023-\*\.md/);
});
test("nextActionFor: unclassified story → classify + skill+id prompt", () => {
  const a = nextActionFor({ id: "US-024" }, new Set(["US-023"]));
  assert.equal(a.classified, false);
  assert.equal(a.next, "classify");
  assert.match(a.prompt, /harness-intake-griller/);
  assert.match(a.prompt, /US-024/);
});

// ─── dispatch prompt (US-027) ─────────────────────────────────────────────

console.log("=== dashboard: dispatchPromptFor (US-027) ===");
test("dispatchPromptFor: backlog → triage prompt with #id + close/promote/reframe", () => {
  const p = dispatchPromptFor({ kind: "backlog", id: "5", title: "Dashboard view-only" }, new Set());
  assert.match(p, /start with backlog #5/);
  assert.match(p, /triage/);
  assert.match(p, /close/);
  assert.match(p, /promote/);
  assert.match(p, /reframe/);
});
test("dispatchPromptFor: matrix unclassified → classify prompt", () => {
  const p = dispatchPromptFor({ kind: "matrix", id: "US-027", title: "backlog triage" }, new Set());
  assert.match(p, /classify US-027/);
  assert.match(p, /harness-intake-griller/);
});
test("dispatchPromptFor: matrix grilled → implement prompt with packet path", () => {
  const p = dispatchPromptFor({ kind: "matrix", id: "US-023", title: "grilled-badge" }, new Set(["US-023"]));
  assert.match(p, /implement US-023/);
  assert.match(p, /docs\/stories\/US-023-\*\.md/);
});
test("dispatchPromptFor: every prompt leads with the AGENTS.md idiom", () => {
  const grill = dispatchPromptFor({ kind: "matrix", id: "US-001", title: "x" }, new Set());
  const impl = dispatchPromptFor({ kind: "matrix", id: "US-001", title: "x" }, new Set(["US-001"]));
  const bl = dispatchPromptFor({ kind: "backlog", id: "1", title: "x" }, new Set());
  for (const p of [grill, impl, bl]) {
    assert.match(p, /^please check @AGENTS\.md, follow the harness flow and/);
  }
});
test("US-027: backlog detail renders [s] start hint", () => {
  const text = renderDashboardLines(
    bareState(),
    nav("backlog", 0, { kind: "backlog", index: 0 }),
    dashData({ backlog: [{ id: 5, title: "view-only", status: "proposed", risk: "normal", detail: "" }] }),
    id
  ).join("\n");
  assert.match(text, /\[s\] start.*#5/);
});

// ─── render: matrix tab ────────────────────────────────────────────────────

console.log("=== dashboard: renderDashboardLines (matrix tab) ===");
test("renders title, detected-state header, 2-tab strip, footer hints", () => {
  const text = renderDashboardLines(bareState(), nav("matrix"), dashData({ matrix: parseMatrixNumeric(FIXTURE_MATRIX) }), id).join("\n");
  assert.match(text, /repository-harness · dashboard/);
  assert.match(text, /cli 0\.1\.11/);
  assert.match(text, /db ok/);
  assert.match(text, /1 matrix/);
  assert.match(text, /2 backlog/);
  assert.doesNotMatch(text, /\bstats\b/);
  assert.doesNotMatch(text, /\btools\b/);
  assert.match(text, /\[r\] refresh.*\[s\] start.*\[Esc\] close/);
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

// ─── render: matrix initiative badge + group-by (US-041) ───────────────────

console.log("=== dashboard: matrix initiative badge + group-by (US-041) ===");

const INIT_INTAKES = "44|Realign griller/kicker/dashboard to upstream\n56|Dashboard focus rework\n";
const INIT_SLICES = "44|US-001|Auth login|implemented\n44|US-002|Manager roles|planned\n56|US-040|Dashboard declutter|implemented\n";

test("buildIntakeByStory: maps slice ids → parent intake id; unlinked absent", () => {
  const m = buildIntakeByStory(parseInitiatives(INIT_INTAKES, INIT_SLICES));
  assert.equal(m.get("US-001"), 44);
  assert.equal(m.get("US-002"), 44);
  assert.equal(m.get("US-040"), 56);
  assert.equal(m.get("US-003"), undefined); // not in any initiative
});

test("matrix flat view: linked row shows #NN initiative badge; unlinked shows –", () => {
  const data = dashData({
    matrix: parseMatrixNumeric(FIXTURE_MATRIX),
    initiatives: parseInitiatives(INIT_INTAKES, INIT_SLICES),
  });
  const text = renderDashboardLines(bareState(), nav("matrix"), data, id).join("\n");
  assert.match(text, /init/); // new column header
  assert.match(text, /\[g\] group/); // toggle discovery
  assert.match(text, /US-001.*#44/); // linked row carries its initiative badge
  assert.match(text, /US-003.*–/); // unlinked row shows the dash
});

test("reducer: 'g' toggles groupByInitiative on matrix + resets cursor", () => {
  const on = reduceDashboardNav({ tab: "matrix", cursor: 2, drill: null }, "g", LENS(3, 0)).nav;
  assert.equal(on.groupByInitiative, true);
  assert.equal(on.cursor, 0);
  const off = reduceDashboardNav({ ...on }, "g", LENS(3, 0)).nav;
  assert.equal(off.groupByInitiative, false);
});

test("reducer: 'g' no-op on backlog + when drilled; tab switch resets it", () => {
  const backlog = reduceDashboardNav({ tab: "backlog", cursor: 0, drill: null }, "g", LENS(0, 3)).nav;
  assert.equal(backlog.groupByInitiative, undefined);
  const drilled = reduceDashboardNav(
    { tab: "matrix", cursor: 0, drill: { kind: "matrix", index: 0 }, groupByInitiative: false },
    "g",
    LENS(3, 0)
  ).nav;
  assert.equal(drilled.groupByInitiative, false); // Esc is the only drill exit
  const switched = reduceDashboardNav(
    { tab: "matrix", cursor: 0, drill: null, groupByInitiative: true },
    "2",
    LENS(3, 3)
  ).nav;
  assert.equal(switched.tab, "backlog");
  assert.equal(switched.groupByInitiative, false);
});

test("matrix grouped view: initiative headers + indented stories + no-initiative bucket", () => {
  const data = dashData({
    matrix: parseMatrixNumeric(FIXTURE_MATRIX),
    initiatives: parseInitiatives(INIT_INTAKES, INIT_SLICES),
  });
  const grouped = renderDashboardLines(bareState(), { ...nav("matrix"), groupByInitiative: true }, data, id).join("\n");
  assert.match(grouped, /\[g\] flat/); // toggle hint flips
  assert.match(grouped, /#44/); // initiative header
  assert.match(grouped, /Realign griller\/kicker\/dashboard to upstream/); // summary only in grouped mode
  assert.match(grouped, /US-001/);
  assert.match(grouped, /US-002/);
  assert.match(grouped, /no initiative/); // trailing bucket for unlinked stories
  assert.match(grouped, /US-003/);
  // the flat view does NOT show the summary header line
  const flat = renderDashboardLines(bareState(), nav("matrix"), data, id).join("\n");
  assert.doesNotMatch(flat, /Realign griller\/kicker\/dashboard to upstream/);
});

// ─── reducer: 'o' openDoc action (US-042) ──────────────────────────────────

console.log("=== dashboard: 'o' openDoc action (US-042) ===");

test("reducer: 'o' on matrix signals openDoc (matrix-only; empty-safe)", () => {
  // matrix with rows → openDoc
  const a = reduceDashboardNav({ tab: "matrix", cursor: 1, drill: null }, "o", LENS(3, 0));
  assert.equal(a.action, "openDoc");
  // empty matrix → nothing to open (no action)
  const b = reduceDashboardNav({ tab: "matrix", cursor: 0, drill: null }, "o", LENS(0, 0));
  assert.equal(b.action, undefined);
  // backlog → no openDoc (stories have packet docs; backlog items do not)
  const c = reduceDashboardNav({ tab: "backlog", cursor: 0, drill: null }, "o", LENS(0, 3));
  assert.equal(c.action, undefined);
});

test("reducer: 'o' works from the drilled story detail too", () => {
  const a = reduceDashboardNav(
    { tab: "matrix", cursor: 0, drill: { kind: "matrix", index: 0 } },
    "o",
    LENS(3, 0)
  );
  assert.equal(a.action, "openDoc");
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

// ─── drift: pure computeDrift (drift.ts is live — Gate B′ + footer) ─────────

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
  const r = computeDrift({ "US-7": "in_progress", "US-8": "retired" }, {});
  assert.equal(r.length, 1);
  assert.equal(r[0]!.kind, "orphan_durable");
  assert.equal(r[0]!.storyId, "US-7");
  assert.equal(r[0]!.markdown, "(no file)");
});
test("computeDrift: planned durable without packet is NOT drift (US-039 #6)", () => {
  assert.deepEqual(computeDrift({ "US-1": "planned" }, {}), []);
});
test("computeDrift: in_progress durable without packet IS orphan_durable (US-039 #6)", () => {
  const r = computeDrift({ "US-1": "in_progress" }, {});
  assert.equal(r.length, 1);
  assert.equal(r[0]!.kind, "orphan_durable");
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

// ─── drill-down: nav reducer + detail panes (US-014) ─────────────────────

console.log("=== dashboard: reduceDashboardNav (pure) ===");
// rest-args absorbed so legacy multi-arg call shapes stay harmless.
const LENS = (m: number, b: number, ..._rest: number[]) => ({ matrix: m, backlog: b });

test("reducer: ↓/j moves cursor down, clamped to list length-1", () => {
  const start: DashboardNav = { tab: "matrix", cursor: 0, drill: null };
  const a = reduceDashboardNav(start, "\x1b[B", LENS(3, 0)).nav;
  assert.equal(a.cursor, 1);
  const b = reduceDashboardNav(a, "\x1b[B", LENS(3, 0)).nav;
  assert.equal(b.cursor, 2);
  // clamp at len-1
  const c = reduceDashboardNav(b, "\x1b[B", LENS(3, 0)).nav;
  assert.equal(c.cursor, 2);
});
test("reducer: ↑/k moves cursor up, clamped to 0", () => {
  const start: DashboardNav = { tab: "matrix", cursor: 2, drill: null };
  const a = reduceDashboardNav(start, "k", LENS(3, 0)).nav;
  assert.equal(a.cursor, 1);
  const b = reduceDashboardNav(a, "\x1b[A", LENS(3, 0)).nav;
  assert.equal(b.cursor, 0);
  const c = reduceDashboardNav(b, "k", LENS(3, 0)).nav;
  assert.equal(c.cursor, 0);
});
test("reducer: Enter drills selected row; Esc pops back (not close); Esc on list closes", () => {
  const start: DashboardNav = { tab: "matrix", cursor: 1, drill: null };
  const d = reduceDashboardNav(start, "\r", LENS(3, 0)).nav;
  assert.deepEqual(d.drill, { kind: "matrix", index: 1 });
  // Esc while drilled → pop only
  const back = reduceDashboardNav(d, "\u001b", LENS(3, 0));
  assert.equal(back.nav.drill, null);
  assert.equal(back.action, undefined);
  // Esc when not drilled → close
  const close = reduceDashboardNav(back.nav, "\u001b", LENS(3, 0));
  assert.equal(close.action, "close");
});
test("reducer: tab switch (1/2) resets cursor + drill", () => {
  const start: DashboardNav = { tab: "matrix", cursor: 2, drill: { kind: "matrix", index: 2 } };
  const r = reduceDashboardNav(start, "2", LENS(0, 0)).nav;
  assert.equal(r.tab, "backlog");
  assert.equal(r.cursor, 0);
  assert.equal(r.drill, null);
});
test("reducer: empty list disables drill + cursor move", () => {
  const start: DashboardNav = { tab: "backlog", cursor: 0, drill: null };
  assert.equal(reduceDashboardNav(start, "\r", LENS(0, 0)).nav.drill, null);
  assert.equal(reduceDashboardNav(start, "j", LENS(0, 0)).nav.cursor, 0);
});
test("reducer: drilled state ignores cursor keys + Enter (Esc is the only exit)", () => {
  const drilled: DashboardNav = { tab: "backlog", cursor: 1, drill: { kind: "backlog", index: 1 } };
  assert.equal(reduceDashboardNav(drilled, "j", LENS(0, 5)).nav.cursor, 1);
  assert.equal(reduceDashboardNav(drilled, "\r", LENS(0, 5)).nav.drill?.index, 1);
});

console.log("=== dashboard: detail panes (drill-down) ===");
console.log("=== dashboard: normalizeKey (Kitty CSI-u → legacy, US-031) ===");
test("normalizeKey: Kitty CSI-u printables decode to the literal char", () => {
  assert.equal(normalizeKey("\x1b[106u"), "j"); // j
  assert.equal(normalizeKey("\x1b[107u"), "k"); // k
  assert.equal(normalizeKey("\x1b[114u"), "r"); // r (refresh)
  assert.equal(normalizeKey("\x1b[102u"), "f"); // f (filter)
  assert.equal(normalizeKey("\x1b[49u"), "1");  // 1 (tab)
  assert.equal(normalizeKey("\x1b[50u"), "2");  // 2 (tab)
  assert.equal(normalizeKey("\x1b[105u"), "i");  // i (install confirm)
});
test("normalizeKey: Kitty CSI-u Esc/Enter/Up/Down → legacy bytes", () => {
  assert.equal(normalizeKey("\x1b[27u"), "\u001b");     // Esc
  assert.equal(normalizeKey("\x1b[27;1u"), "\u001b");   // Esc (explicit mod=1)
  assert.equal(normalizeKey("\x1b[13u"), "\r");         // Enter
  assert.equal(normalizeKey("\x1b[13;1u"), "\r");       // Enter (mod=1)
  assert.equal(normalizeKey("\x1b[57419u"), "\x1b[A");   // Up (Kitty functional)
  assert.equal(normalizeKey("\x1b[57419;1u"), "\x1b[A"); // Up (mod=1)
  assert.equal(normalizeKey("\x1b[57420u"), "\x1b[B");   // Down
});
test("normalizeKey: legacy bytes pass through unchanged (non-Kitty parity)", () => {
  // Every input the reducers already match must map to itself so behavior on
  // non-Kitty terminals is byte-identical.
  for (const k of ["j", "k", "r", "f", "1", "2", "i", "m", "c", "d", "\u001b", "\r", "\n", "\x1b[A", "\x1b[B", "\x1bOA", "\x1bOB"]) {
    assert.equal(normalizeKey(k), k, `legacy passthrough failed for ${JSON.stringify(k)}`);
  }
});
test("normalizeKey: modified Kitty keys pass through (no false match)", () => {
  // Shift/Alt/Ctrl have mod ≥ 2; the reducers never matched them and still
  // must not (e.g. Ctrl+J ≠ j). Format: \x1b[<cp>;<mod>u, mod=2 → shift.
  assert.equal(normalizeKey("\x1b[106;2u"), "\x1b[106;2u"); // Shift+j → passthrough
  assert.equal(normalizeKey("\x1b[106;5u"), "\x1b[106;5u"); // Ctrl+j → passthrough
});
test("normalizeKey: CSI-u with event-type suffix (Kitty flag 2) still decodes", () => {
  // flag 2 (report event types) appends :<event> (1=press). Presses decode.
  assert.equal(normalizeKey("\x1b[106;1:1u"), "j");       // j press
  assert.equal(normalizeKey("\x1b[27;1:1u"), "\u001b");    // Esc press
});
test("integration: reducer + normalizeKey recognizes Kitty input like legacy", () => {
  // The bug: on Ghostty/Kitty, handleInput receives \x1b[106u not "j".
  // After normalizeKey, the reducer must behave exactly as it did for "j".
  const start: DashboardNav = { tab: "matrix", cursor: 0, drill: null };
  assert.equal(reduceDashboardNav(start, normalizeKey("\x1b[106u"), LENS(3, 0)).nav.cursor, 1); // j → down
  assert.equal(reduceDashboardNav({ ...start, cursor: 2 }, normalizeKey("\x1b[107u"), LENS(3, 0)).nav.cursor, 1); // k → up
  assert.deepEqual(reduceDashboardNav(start, normalizeKey("\x1b[13u"), LENS(3, 0)).nav.drill, { kind: "matrix", index: 0 }); // Enter → drill
  assert.equal(reduceDashboardNav(start, normalizeKey("\x1b[27u"), LENS(3, 0)).action, "close"); // Esc → close
  assert.equal(reduceDashboardNav(start, normalizeKey("\x1b[57419u"), LENS(3, 0)).nav.cursor, 0); // Up at 0 → clamp 0
  assert.equal(reduceDashboardNav({ ...start, cursor: 2 }, normalizeKey("\x1b[57420u"), LENS(3, 0)).nav.cursor, 2); // Down at len-1 → clamp
  assert.equal(reduceDashboardNav(start, normalizeKey("\x1b[50u"), LENS(0, 0)).nav.tab, "backlog"); // "2" → backlog tab
});

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
console.log("=== dashboard: grilled-badge + next-action routing (US-023) ===");
test("matrix badge: classified row shows ●, unclassified shows ○", () => {
  const rows = parseMatrixNumeric(FIXTURE_MATRIX); // US-001 / US-002 / US-003
  const data = dashData({ matrix: rows, classifiedStoryIds: new Set(["US-001"]) });
  const lines = renderDashboardLines(bareState(), nav("matrix"), data, id).join("\n").split("\n");
  const us001 = lines.find((l) => /US-001/.test(l))!;
  const us002 = lines.find((l) => /US-002/.test(l))!;
  assert.ok(/●/.test(us001), "US-001 (classified) row should show ●");
  assert.ok(/○/.test(us002), "US-002 (unclassified) row should show ○");
});
test("matrix badge: header carries the classified 'c' column label", () => {
  const data = dashData({ matrix: parseMatrixNumeric(FIXTURE_MATRIX), classifiedStoryIds: new Set() });
  const headerLine = renderDashboardLines(bareState(), nav("matrix"), data, id).join("\n").split("\n").find((l) => /u i e p/.test(l))!;
  assert.match(headerLine, /\bc\b/);
});
test("story detail: classified shows yes + next: implement + packet prompt", () => {
  const row = { id: "US-023", title: "Dashboard grilled-badge", status: "in_progress", unit: 0, integ: 0, e2e: 0, plat: 0 };
  const data = dashData({
    matrix: [row],
    classifiedStoryIds: new Set(["US-023"]),
    packets: { "US-023": PACKET("US-023", "in_progress", "normal", "- badge.", "t=1") },
  });
  const text = renderDashboardLines(bareState(), nav("matrix", 0, { kind: "matrix", index: 0 }), data, id).join("\n");
  assert.match(text, /classified:.*yes/);
  assert.match(text, /next:.*implement/);
  assert.match(text, /docs\/stories\/US-023-\*\.md/);
});
test("story detail: unclassified shows no + next: classify + skill prompt", () => {
  const row = { id: "US-024", title: "ADR reader", status: "planned", unit: 0, integ: 0, e2e: 0, plat: 0 };
  const data = dashData({ matrix: [row], classifiedStoryIds: new Set() });
  const text = renderDashboardLines(bareState(), nav("matrix", 0, { kind: "matrix", index: 0 }), data, id).join("\n");
  assert.match(text, /classified:.*no/);
  assert.match(text, /next:.*classify/);
  assert.match(text, /harness-intake-griller/);
});
console.log("=== dashboard: matrix status-filter (US-026) ===");

test("filterMatrixRows: all → every row (identity)", () => {
  const rows = parseMatrixNumeric(FIXTURE_MATRIX);
  const out = filterMatrixRows(rows, new Set(), "all");
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((r) => r.id), ["US-001", "US-002", "US-003"]);
});
test("filterMatrixRows: planned → only status=planned", () => {
  const rows = parseMatrixNumeric(FIXTURE_MATRIX);
  assert.deepEqual(filterMatrixRows(rows, new Set(), "planned").map((r) => r.id), ["US-002"]);
});
test("filterMatrixRows: done → only status=implemented", () => {
  const rows = parseMatrixNumeric(FIXTURE_MATRIX);
  assert.deepEqual(filterMatrixRows(rows, new Set(), "done").map((r) => r.id), ["US-001"]);
});
test("filterMatrixRows: unclassified → planned AND not classified (the classify queue)", () => {
  const rows = parseMatrixNumeric(FIXTURE_MATRIX); // US-002 is the only planned
  assert.deepEqual(filterMatrixRows(rows, new Set(), "unclassified").map((r) => r.id), ["US-002"]);
  // US-002 classified → queue empty
  assert.deepEqual(filterMatrixRows(rows, new Set(["US-002"]), "unclassified"), []);
});
test("filterMatrixRows: undefined/unknown → all (identity, never throws)", () => {
  const rows = parseMatrixNumeric(FIXTURE_MATRIX);
  assert.equal(filterMatrixRows(rows, new Set(), undefined).length, 3);
});

test("reducer: `f` cycles matrix filter all→planned→unclassified→done→all", () => {
  let st: DashboardNav = { tab: "matrix", cursor: 0, drill: null };
  st = reduceDashboardNav(st, "f", LENS(3, 0)).nav;
  assert.equal(st.matrixFilter, "planned");
  st = reduceDashboardNav(st, "f", LENS(3, 0)).nav;
  assert.equal(st.matrixFilter, "unclassified");
  st = reduceDashboardNav(st, "f", LENS(3, 0)).nav;
  assert.equal(st.matrixFilter, "done");
  st = reduceDashboardNav(st, "f", LENS(3, 0)).nav;
  assert.equal(st.matrixFilter, "all"); // wraps done→all
});
test("reducer: `f` resets cursor to 0 (list content changes)", () => {
  const st: DashboardNav = { tab: "matrix", cursor: 2, drill: null };
  const r = reduceDashboardNav(st, "f", LENS(3, 0)).nav;
  assert.equal(r.cursor, 0);
  assert.equal(r.matrixFilter, "planned");
});
test("reducer: `f` is a no-op on non-matrix list tabs (backlog)", () => {
  const st: DashboardNav = { tab: "backlog", cursor: 0, drill: null };
  const r = reduceDashboardNav(st, "f", LENS(0, 3)).nav;
  assert.equal(r.matrixFilter, undefined);
  assert.equal(r.cursor, 0);
});
test("reducer: `f` is a no-op when drilled (Esc is the only exit)", () => {
  const drilled: DashboardNav = { tab: "matrix", cursor: 1, drill: { kind: "matrix", index: 1 }, matrixFilter: "planned" };
  assert.equal(reduceDashboardNav(drilled, "f", LENS(3, 0)).nav.matrixFilter, "planned");
});
test("reducer: tab switch resets matrixFilter to all", () => {
  const st: DashboardNav = { tab: "matrix", cursor: 2, drill: null, matrixFilter: "unclassified" };
  const r = reduceDashboardNav(st, "2", LENS(0, 0)).nav;
  assert.equal(r.tab, "backlog");
  assert.equal(r.matrixFilter, "all");
});

// ─── reducer: `s` dispatch signal (US-027) ────────────────────────────────
test("reducer: `s` on matrix (non-empty) → action dispatch", () => {
  const st: DashboardNav = { tab: "matrix", cursor: 0, drill: null };
  assert.equal(reduceDashboardNav(st, "s", LENS(3, 0)).action, "dispatch");
});
test("reducer: `s` on backlog (non-empty) → action dispatch", () => {
  const st: DashboardNav = { tab: "backlog", cursor: 0, drill: null };
  assert.equal(reduceDashboardNav(st, "s", LENS(0, 3)).action, "dispatch");
});
test("reducer: `s` on empty list → no-op (no dispatch)", () => {
  const st: DashboardNav = { tab: "backlog", cursor: 0, drill: null };
  assert.equal(reduceDashboardNav(st, "s", LENS(0, 0)).action, undefined);
});
test("reducer: `s` works when drilled (cursor holds the row)", () => {
  const drilled: DashboardNav = { tab: "backlog", cursor: 1, drill: { kind: "backlog", index: 1 } };
  assert.equal(reduceDashboardNav(drilled, "s", LENS(0, 3)).action, "dispatch");
});
test("reducer: `s` preserves nav (no cursor/filter change)", () => {
  const st: DashboardNav = { tab: "matrix", cursor: 2, drill: null, matrixFilter: "planned" };
  const r = reduceDashboardNav(st, "s", LENS(3, 0)).nav;
  assert.equal(r.cursor, 2);
  assert.equal(r.matrixFilter, "planned");
});
test("reducer: `r` refresh preserves the active matrixFilter", () => {
  const st: DashboardNav = { tab: "matrix", cursor: 0, drill: null, matrixFilter: "planned" };
  const res = reduceDashboardNav(st, "r", LENS(3, 0));
  assert.equal(res.action, "refresh");
  assert.equal(res.nav.matrixFilter, "planned");
});

test("render: matrix body shows the active-filter label + [f] discovery", () => {
  const data = dashData({ matrix: parseMatrixNumeric(FIXTURE_MATRIX) });
  const text = renderDashboardLines(bareState(), { tab: "matrix", cursor: 0, drill: null, matrixFilter: "planned" }, data, id).join("\n");
  assert.match(text, /filter: planned/);
  assert.match(text, /\[f\] cycle/);
});
test("render: `planned` filter narrows the matrix list to planned rows", () => {
  const data = dashData({ matrix: parseMatrixNumeric(FIXTURE_MATRIX) });
  const text = renderDashboardLines(bareState(), { tab: "matrix", cursor: 0, drill: null, matrixFilter: "planned" }, data, id).join("\n");
  assert.match(text, /US-002/);
  assert.ok(!/US-001/.test(text), "US-001 (implemented) should be filtered out");
  assert.ok(!/US-003/.test(text), "US-003 (retired) should be filtered out");
});
test("render: `unclassified` empty → classify-queue-empty empty-state", () => {
  const data = dashData({ matrix: parseMatrixNumeric(FIXTURE_MATRIX), classifiedStoryIds: new Set(["US-002"]) });
  const text = renderDashboardLines(bareState(), { tab: "matrix", cursor: 0, drill: null, matrixFilter: "unclassified" }, data, id).join("\n");
  assert.match(text, /classify queue empty/);
  assert.ok(!/US-002/.test(text), "classified US-002 should not appear in unclassified filter");
});
test("render: drill resolves the correct story from a filtered position", () => {
  // Under `planned`, only US-002 shows (index 0 in the filtered list). Drilling
  // index 0 must open US-002, NOT US-001 (index 0 in the FULL list).
  const data = dashData({
    matrix: parseMatrixNumeric(FIXTURE_MATRIX),
    packets: { "US-002": PACKET("US-002", "planned", "normal", "- ac.", "ev") },
  });
  const text = renderDashboardLines(bareState(), { tab: "matrix", cursor: 0, drill: { kind: "matrix", index: 0 }, matrixFilter: "planned" }, data, id).join("\n");
  assert.match(text, /US-002/);
  assert.match(text, /Manager roles/);
  assert.ok(!/Auth login/.test(text), "must not show US-001 (full-list index 0)");
});

console.log("=== dashboard: provenance lane (US-025) ===");
test("parseIntakesByStory: groups pipe-delimited rows by story_id", () => {
  const sql = "story_id\n--------\nUS-025|35|spec_slice\nUS-023|30|spec_slice\nUS-025|9|harness_improvement\n";
  const m = parseIntakesByStory(sql);
  assert.deepEqual(m.get("US-025"), [{ id: 35, inputType: "spec_slice" }, { id: 9, inputType: "harness_improvement" }]);
  assert.deepEqual(m.get("US-023"), [{ id: 30, inputType: "spec_slice" }]);
});
test("parseIntakesByStory: empty/noise/garbage → empty map (never throws)", () => {
  assert.deepEqual(parseIntakesByStory(""), new Map());
  assert.deepEqual(parseIntakesByStory("story_id\n--------\nUS-006\n123|bad\n"), new Map());
});
test("parseTracesByStory: groups trace ids by story_id", () => {
  const sql = "US-025|59\nUS-023|57\nUS-025|54\n";
  const m = parseTracesByStory(sql);
  assert.deepEqual(m.get("US-025"), [59, 54]);
  assert.deepEqual(m.get("US-023"), [57]);
});
test("buildProvenance: merges intake + trace maps, union of keys", () => {
  const ints = new Map([["US-025", [{ id: 35, inputType: "spec_slice" }]]]);
  const trs = new Map([["US-025", [59, 54]], ["US-024", [60]]]);
  const p = buildProvenance(ints, trs);
  assert.deepEqual(p.get("US-025"), { intakes: [{ id: 35, inputType: "spec_slice" }], traces: [59, 54] });
  assert.deepEqual(p.get("US-024"), { intakes: [], traces: [60] });
  assert.equal(p.has("US-999"), false);
});
test("story detail: provenance lane shows intake + traces", () => {
  const row = { id: "US-025", title: "Dashboard entity reframe", status: "planned", unit: 0, integ: 0, e2e: 0, plat: 0 };
  const data = dashData({
    matrix: [row],
    classifiedStoryIds: new Set(["US-025"]),
    provenance: new Map([["US-025", { intakes: [{ id: 35, inputType: "spec_slice" }], traces: [59, 54] }]]),
  });
  const text = renderDashboardLines(bareState(), nav("matrix", 0, { kind: "matrix", index: 0 }), data, id).join("\n");
  assert.match(text, /Provenance:/);
  assert.match(text, /intake:.*#35 spec_slice/);
  assert.match(text, /traces:.*59.*54/);
});
test("story detail: no provenance → dim intake — + traces —", () => {
  const row = { id: "US-999", title: "Ghost", status: "planned", unit: 0, integ: 0, e2e: 0, plat: 0 };
  const data = dashData({ matrix: [row], provenance: new Map() });
  const text = renderDashboardLines(bareState(), nav("matrix", 0, { kind: "matrix", index: 0 }), data, id).join("\n");
  assert.match(text, /Provenance:/);
  assert.match(text, /no linked intake/);
  assert.match(text, /traces:.*—/);
});
test("story detail: intake but no traces", () => {
  const row = { id: "US-026", title: "Next + grill-queue", status: "planned", unit: 0, integ: 0, e2e: 0, plat: 0 };
  const data = dashData({
    matrix: [row],
    provenance: new Map([["US-026", { intakes: [{ id: 40, inputType: "spec_slice" }], traces: [] }]]),
  });
  const text = renderDashboardLines(bareState(), nav("matrix", 0, { kind: "matrix", index: 0 }), data, id).join("\n");
  assert.match(text, /intake:.*#40 spec_slice/);
  assert.match(text, /traces:.*—/);
});
test("story detail: traces cap at 5 with (+N more)", () => {
  const row = { id: "US-023", title: "Grilled badge", status: "implemented", unit: 1, integ: 1, e2e: 0, plat: 0 };
  const data = dashData({
    matrix: [row],
    provenance: new Map([["US-023", { intakes: [], traces: [60, 59, 58, 57, 56, 55, 54] }]]),
  });
  const text = renderDashboardLines(bareState(), nav("matrix", 0, { kind: "matrix", index: 0 }), data, id).join("\n");
  assert.match(text, /\+2 more/);
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

// ─── render: box-width alignment ───────────────────────────────────────────

console.log("=== dashboard: box-width alignment ===");
const fullData = dashData({
  matrix: parseMatrixNumeric(FIXTURE_MATRIX),
  backlog: parseBacklogOpen(FIXTURE_BACKLOG),
});
test("every rendered line is exactly the box width (76 outer) on every tab", () => {
  for (const tab of ["matrix", "backlog"] as DashboardTab[]) {
    const lines = renderDashboardLines(bareState(), nav(tab), fullData, id, 76);
    for (const ln of lines) {
      assert.equal(ansiVisibleWidth(ln), 76, `${tab}: line not 76 cols: ${JSON.stringify(ln)}`);
    }
  }
});
test("alignment holds at the narrower floor width (60) on every tab", () => {
  for (const tab of ["matrix", "backlog"] as DashboardTab[]) {
    const lines = renderDashboardLines(bareState(), nav(tab), fullData, id, 60);
    for (const ln of lines) {
      assert.equal(ansiVisibleWidth(ln), 60, `${tab}: line not 60 cols: ${JSON.stringify(ln)}`);
    }
  }
});
test("dashboard FILLS the available width (no 76-col cap → no right-side void) [intake #19]", () => {
  const data = dashData({ matrix: parseMatrixNumeric(FIXTURE_MATRIX) });
  for (const w of [100, 140]) {
    const lines = renderDashboardLines(bareState(), nav("matrix"), data, id, w);
    for (const ln of lines) {
      assert.equal(ansiVisibleWidth(ln), w, `width ${w}: line not filled (box capped?): ${JSON.stringify(ln)}`);
    }
  }
});

// ─── Approach B: wiring through the REAL index.ts ──────────────────────────

console.log("=== wiring: /harness → DASHBOARD route + fetch ===");

/** A realistic `query matrix --numeric` body for the wired exec mock. */
const WIRED_MATRIX =
  "US-001  P1 detect + footer      implemented  1  1  0  0\n" +
  "US-010  P4 dashboard shell      planned      0  0  0  0\n";
// `query stats` is still called by detect() for the footer counts (detect.ts
// has its own parseStats). Return a valid shape so the footer renders.
const WIRED_STATS =
  "=== Harness Stats ===\n" +
  "intakes  stories  decisions  backlog_items  traces\n" +
  "-------  -------  ---------  -------------  ------\n" +
  "2        2        0          0              1    \n";
const WIRED_BACKLOG =
  "id  title                       status     risk  predicted_impact\n" +
  "--  --------------------------  ---------  ----  ----------------\n" +
  "2   markdown drift cross-check  proposed   tiny  makes drift visible\n";

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
    backlogStdout?: string;
    backlogCode?: number;
  } = {}
) {
  const matrixStdout = opts.matrixStdout ?? WIRED_MATRIX;
  const matrixCode = opts.matrixCode ?? 0;
  const keySeqs = opts.keySeqs ?? [["\u001b"]];
  const execCalls: { cmd: string; args: string[] }[] = [];
  const state = { customCalls: 0, matrixCalls: 0, renders: [] as string[][], sentMessages: [] as string[] };
  let seqIdx = 0;
  const registeredCommands = new Map<string, (a: string, c: unknown) => Promise<void>>();

  const pi = {
    registerCommand(name: string, o: { handler: (a: string, c: unknown) => Promise<void> }) {
      registeredCommands.set(name, o.handler);
    },
    on() {
      /* not exercised by the command handler */
    },
    sendUserMessage(content: unknown) {
      state.sentMessages.push(String(content));
    },
    async exec(cmd: string, args: string[]) {
      execCalls.push({ cmd, args });
      if (args[0] === "--version")
        return { stdout: "harness-cli 0.1.11\n", stderr: "", code: 0, killed: false };
      if (args[0] === "query" && args[1] === "stats") {
        return { stdout: WIRED_STATS, stderr: "", code: 0, killed: false };
      }
      if (args[0] === "query" && args[1] === "backlog") {
        return { stdout: opts.backlogStdout ?? WIRED_BACKLOG, stderr: "", code: opts.backlogCode ?? 0, killed: false };
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

test("installed+db → DASHBOARD route: fetches matrix + backlog, no installer", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, execCalls, state, registeredCommands } = mockHarness(cwd);
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);

    assert.equal(state.customCalls, 1, "dashboard overlay opens exactly once");
    assert.equal(state.matrixCalls, 1, "matrix fetched once per open by fetchMatrix (--numeric)");
    for (const sub of ["matrix", "backlog"] as const) {
      assert.ok(
        execCalls.some((c) => c.args[0] === "query" && c.args[1] === sub),
        `must exec query ${sub}`
      );
    }
    assert.ok(
      !execCalls.some((c) => c.args[0] === "query" && (c.args[1] === "tools" || c.args[1] === "drift")),
      "removed tabs (tools/drift) must NOT be fetched"
    );
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

test("tab switch: '2' backlog content; '1' back to matrix", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, {
      keySeqs: [["2", "1", "\u001b"]],
    });
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);

    const renders = state.renders[0]!;
    assert.match(renders[0]!, /US-001/, "initial render = matrix tab");
    assert.match(renders[1]!, /markdown drift/, "after '2' = backlog tab content");
    assert.match(renders[2]!, /US-001/, "after '1' = back to matrix");
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
    assert.equal(state.matrixCalls, 2, "matrix re-fetched on each refresh by fetchMatrix (2 opens)");
    for (const sub of ["matrix", "backlog"] as const) {
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

test("failing backlog query (exit 1) → backlog tab shows a dim error row, never throws", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, {
      backlogStdout: "",
      backlogCode: 1,
      keySeqs: [["2", "\u001b"]],
    });
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never); // must not throw
    const backlogRender = state.renders[0]![1]!;
    assert.match(backlogRender, /backlog unavailable/, "backlog tab degrades to error row");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ─── US-027: dispatch key (in-session sendUserMessage) ────────────────────

console.log("=== dashboard: US-027 dispatch key ===");
test("US-027 dispatch: `s` on backlog → pi.sendUserMessage with triage prompt", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, { keySeqs: [["2", "s"]] });
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);
    assert.equal(state.sentMessages.length, 1, "dispatch sends exactly one user message");
    assert.match(state.sentMessages[0]!, /start with backlog #2/);
    assert.match(state.sentMessages[0]!, /triage/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
test("US-027 dispatch: `s` on matrix → classify prompt (unclassified default)", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, { keySeqs: [["s"]] });
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);
    assert.equal(state.sentMessages.length, 1);
    // WIRED_MATRIX row 0 = US-001; classifiedStoryIds empty (intakes unmocked) → classify
    assert.match(state.sentMessages[0]!, /classify US-001/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
test("US-027 dispatch: Esc (no `s`) → no user message sent", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, { keySeqs: [["\u001b"]] });
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);
    assert.equal(state.sentMessages.length, 0, "plain close sends nothing");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ─── US-036: initiative link (parser kept; feeds the matrix badge, US-041) ──

console.log("=== dashboard: initiative link (US-036) ===");
test("parseInitiatives: groups slices by parent_intake_id, newest initiative first", () => {
  const intakes = "44|Realign to upstream\n29|Control-surface initiative\n";
  const slices =
    "44|US-033|Slice link|planned\n" +
    "44|US-036|Dashboard|planned\n" +
    "29|US-023|Grilled badge|implemented\n";
  const groups = parseInitiatives(intakes, slices);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.intakeId, 44, "newest initiative first");
  assert.equal(groups[0]!.summary, "Realign to upstream");
  assert.deepEqual(groups[0]!.slices.map((s) => s.id), ["US-033", "US-036"]);
  assert.equal(groups[1]!.intakeId, 29);
  assert.deepEqual(groups[1]!.slices.map((s) => s.id), ["US-023"]);
});
test("parseInitiatives: empty/garbage → empty list (never throws)", () => {
  assert.deepEqual(parseInitiatives("", ""), []);
  assert.deepEqual(parseInitiatives("id\n--\nnope\n", "garbage|not|a|slice"), []);
});
test("story detail: shows the initiative link (#parent_intake_id)", () => {
  const row = { id: "US-036", title: "Dashboard classified badge", status: "planned", unit: 0, integ: 0, e2e: 0, plat: 0 };
  const data = dashData({
    matrix: [row],
    initiatives: [{ intakeId: 44, summary: "Realign to upstream", slices: [{ id: "US-036", title: "Dashboard", status: "planned" }] }],
  });
  const text = renderDashboardLines(bareState(), nav("matrix", 0, { kind: "matrix", index: 0 }), data, id).join("\n");
  assert.match(text, /initiative:.*#44/);
});

void run();
