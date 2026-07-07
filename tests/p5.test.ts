// tests/p5.test.ts — unit + wiring tests for the P5 TIMELINE tab (US-015).
//
// Run: npx tsx tests/p5.test.ts
//
// Two layers, mirroring tests/p4.test.ts:
//   1. Pure dashboard.ts logic: parseEventsJsonl, timelineDiff, the timeline
//      renderer (rows + exit mark + db delta + drill-down detail), nav, and the
//      degrade paths (no file / no events).
//   2. Approach-B wiring: load the REAL index.ts, drive /harness against an
//      installed+db fixture repo that ships a .harness-observer/events.jsonl,
//      and assert the timeline tab renders, drills, and degrades — without an
//      LLM. fetchTimeline reads the fixture file directly (no exec mock needed).

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseEventsJsonl,
  readTimelineTail,
  timelineDiff,
  reduceDashboardNav,
  renderDashboardLines,
  TIMELINE_MAX,
  type DashboardData,
  type TimelineEvent,
} from "../extensions/harness/dashboard.ts";
import { ansiVisibleWidth } from "../extensions/harness/overlay.ts";
import type { HarnessState } from "../extensions/harness/detect.ts";

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

const id = (_c: string, t: string) => t; // identity fg → plain text assertions

function bareState(over: Partial<HarnessState> = {}): HarnessState {
  return {
    cwd: "/repo",
    cliInstalled: true,
    cliVersion: "0.1.11",
    dbInitialized: true,
    shimPresent: true,
    claudeShimPresent: false,
    observerInstalled: true,
    ...over,
  };
}

/** Build a single DashboardData with only the timeline populated. */
function dataWith(events: TimelineEvent[], over: Partial<DashboardData> = {}): DashboardData {
  return {
    matrix: [],
    stats: { intakes: 0, stories: 0, decisions: 0, backlogItems: 0, traces: 0 },
    backlog: [],
    tools: [],
    drift: [],
    timeline: events,
    packets: {},
    errors: {},
    ...over,
  };
}

/** Render the dashboard on the timeline tab, return the joined plain text. */
function renderTimeline(events: TimelineEvent[], cursor = 0, state?: Partial<HarnessState>): string {
  const lines = renderDashboardLines(
    bareState(state),
    { tab: "timeline", cursor, drill: null },
    dataWith(events),
    id,
    80
  );
  return lines.join("\n");
}

/** One JSONL line. */
function jl(o: Record<string, unknown>): string {
  return JSON.stringify(o);
}

// ─── layer 1: parseEventsJsonl ─────────────────────────────────────────────

console.log("=== parseEventsJsonl ===");

test("parses a well-formed line into a TimelineEvent", () => {
  const text = jl({
    ts: "2026-07-04T10:32:00+00:00",
    cmd: ["intake", "--type", "spec_slice"],
    exit: 0,
    duration_ms: 340,
    stdout: "Intake #3 recorded.",
    stderr: "",
    db_before: { intake: 2, story: 6 },
    db_after: { intake: 3, story: 7 },
  });
  const [ev] = parseEventsJsonl(text);
  assert.equal(ev.ts, "2026-07-04T10:32:00+00:00");
  assert.deepEqual(ev.cmd, ["intake", "--type", "spec_slice"]);
  assert.equal(ev.exit, 0);
  assert.equal(ev.durationMs, 340);
  assert.equal(ev.stdout, "Intake #3 recorded.");
  assert.deepEqual(ev.dbBefore, { intake: 2, story: 6 });
  assert.deepEqual(ev.dbAfter, { intake: 3, story: 7 });
});

test("skips blank lines and unparseable / non-object lines", () => {
  const text = [
    "",
    "not json at all",
    JSON.stringify(42), // valid JSON, not an object
    jl({ ts: "2026-07-04T10:32:00+00:00", cmd: ["query", "stats"], exit: 0, duration_ms: 9 }),
    "{ broken json",
  ].join("\n");
  const out = parseEventsJsonl(text);
  assert.equal(out.length, 1, "only the one valid object line survives");
  assert.deepEqual(out[0]!.cmd, ["query", "stats"]);
});

test("missing fields degrade to zero / empty (never throws, never undefined)", () => {
  const [ev] = parseEventsJsonl(jl({ cmd: ["--version"] }));
  assert.equal(ev.exit, 0);
  assert.equal(ev.durationMs, 0);
  assert.equal(ev.ts, "");
  assert.equal(ev.stdout, "");
  assert.deepEqual(ev.dbBefore, {});
  assert.deepEqual(ev.dbAfter, {});
});

test("db_before/after non-numeric values are dropped by toCounts", () => {
  const [ev] = parseEventsJsonl(
    jl({ db_before: { intake: "oops", story: 5 }, db_after: { story: 6, trace: null } })
  );
  assert.deepEqual(ev.dbBefore, { story: 5 }, "string entry dropped");
  assert.deepEqual(ev.dbAfter, { story: 6 }, "null entry dropped");
});

// ─── layer 1: readTimelineTail (US-016 live-tail re-derivation seam) ────────

console.log("=== readTimelineTail ===");

/** Build N synthetic mutation events (i:N). */
function events(n: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= n; i++) {
    lines.push(jl({ ts: `2026-07-04T10:1${i}:00+00:00`, cmd: ["intake"], exit: 0, duration_ms: 10, stdout: `Intake #${i}`, stderr: "", db_before: { intake: i - 1 }, db_after: { intake: i } }));
  }
  return lines.join("\n");
}

test("empty / garbage text → []", () => {
  assert.deepEqual(readTimelineTail(""), []);
  assert.deepEqual(readTimelineTail("not json\n{broken"), []);
});

test("under the cap returns every event in order", () => {
  const tail = readTimelineTail(events(3));
  assert.equal(tail.length, 3);
  assert.equal(tail[0]!.stdout, "Intake #1");
  assert.equal(tail[2]!.stdout, "Intake #3");
});

test("over the cap drops the OLDEST and keeps the last TIMELINE_MAX", () => {
  const tail = readTimelineTail(events(TIMELINE_MAX + 5));
  assert.equal(tail.length, TIMELINE_MAX);
  assert.equal(tail[0]!.stdout, "Intake #6", "oldest 5 dropped");
  assert.equal(tail[tail.length - 1]!.stdout, `Intake #${TIMELINE_MAX + 5}`);
});

test("appending a line re-derives the tail with no duplicate or dropped row (watcher fire)", () => {
  // Simulate the live-tail contract: the watcher fires after an append, and the
  // handler re-derives from the CURRENT file contents (not an incremental
  // append onto a stale list). Two re-derivations from the same grown file are
  // identical ⇒ idempotent ⇒ no dup, no drop, even if the watcher coalesces.
  const before = events(3);
  const appended = before + "\n" + jl({ ts: "2026-07-04T10:20:00+00:00", cmd: ["trace"], exit: 0, duration_ms: 9, stdout: "Trace #4 recorded.", stderr: "", db_before: { trace: 3 }, db_after: { trace: 4 } });
  const t1 = readTimelineTail(appended);
  const t2 = readTimelineTail(appended); // coalesced re-fire → same input
  assert.equal(t1.length, 4);
  assert.deepEqual(t1, t2, "re-derivation is idempotent (no dup on coalesce)");
  assert.equal(t1[3]!.stdout, "Trace #4 recorded.", "appended event surfaces");
  assert.equal(t1[0]!.stdout, "Intake #1", "no pre-existing row dropped while under cap");
});

test("cap boundary: exactly TIMELINE_MAX keeps all; +1 drops the first", () => {
  assert.equal(readTimelineTail(events(TIMELINE_MAX)).length, TIMELINE_MAX);
  const over = readTimelineTail(events(TIMELINE_MAX + 1));
  assert.equal(over.length, TIMELINE_MAX);
  assert.equal(over[0]!.stdout, "Intake #2", "first dropped when one over");
});

// ─── layer 1: timelineDiff ─────────────────────────────────────────────────

console.log("=== timelineDiff ===");

test("returns only tables where before ≠ after", () => {
  const ev: TimelineEvent = {
    ts: "", cmd: [], exit: 0, durationMs: 0, stdout: "", stderr: "",
    dbBefore: { intake: 2, story: 6, decision: 5 },
    dbAfter: { intake: 3, story: 6, decision: 5 },
  };
  assert.deepEqual(timelineDiff(ev), [{ table: "intake", before: 2, after: 3 }]);
});

test("empty for a read (both maps empty)", () => {
  const ev: TimelineEvent = {
    ts: "", cmd: ["query", "stats"], exit: 0, durationMs: 9, stdout: "", stderr: "",
    dbBefore: {}, dbAfter: {},
  };
  assert.deepEqual(timelineDiff(ev), []);
});

test("empty when before === after (no-op query)", () => {
  const ev: TimelineEvent = {
    ts: "", cmd: ["query", "stats"], exit: 0, durationMs: 9, stdout: "", stderr: "",
    dbBefore: { intake: 17, story: 14 }, dbAfter: { intake: 17, story: 14 },
  };
  assert.deepEqual(timelineDiff(ev), []);
});

test("multiple changed tables all surface", () => {
  const ev: TimelineEvent = {
    ts: "", cmd: ["intake"], exit: 0, durationMs: 1, stdout: "", stderr: "",
    dbBefore: { intake: 2, story: 6 }, dbAfter: { intake: 3, story: 7 },
  };
  const tables = timelineDiff(ev).map((d) => d.table).sort();
  assert.deepEqual(tables, ["intake", "story"]);
});

// ─── layer 1: reduceDashboardNav (timeline is now a list tab) ───────────────

console.log("=== nav: timeline cursor + drill ===");

const LENS = { matrix: 0, backlog: 0, drift: 0, timeline: 3 };

test("'t' switches to the timeline tab (resets cursor + drill)", () => {
  const res = reduceDashboardNav({ tab: "matrix", cursor: 5, drill: null }, "t", LENS);
  assert.deepEqual(res.nav, { tab: "timeline", cursor: 0, drill: null });
});

test("j/k move the cursor on the timeline tab, clamped", () => {
  const a = reduceDashboardNav({ tab: "timeline", cursor: 0, drill: null }, "j", LENS);
  assert.equal(a.nav.cursor, 1);
  const b = reduceDashboardNav({ tab: "timeline", cursor: 2, drill: null }, "j", LENS);
  assert.equal(b.nav.cursor, 2, "clamps at len-1");
  const c = reduceDashboardNav({ tab: "timeline", cursor: 0, drill: null }, "k", LENS);
  assert.equal(c.nav.cursor, 0, "clamps at 0");
});

test("Enter drills the selected timeline row; Esc pops back", () => {
  const d = reduceDashboardNav({ tab: "timeline", cursor: 1, drill: null }, "\r", LENS);
  assert.deepEqual(d.nav.drill, { kind: "timeline", index: 1 });
  const back = reduceDashboardNav(d.nav, "\x1b", LENS);
  assert.equal(back.nav.drill, null);
  assert.notEqual(back.action, "close", "Esc pops drill, does not close");
});

// ─── layer 1: renderTimelineTab ────────────────────────────────────────────

console.log("=== render: TIMELINE tab ===");

const MUTATION: TimelineEvent = {
  ts: "2026-07-04T10:32:00+00:00", cmd: ["intake", "--type", "spec_slice"], exit: 0,
  durationMs: 340, stdout: "Intake #3 recorded.", stderr: "",
  dbBefore: { intake: 2 }, dbAfter: { intake: 3 },
};
const READ: TimelineEvent = {
  ts: "2026-07-04T10:11:37+00:00", cmd: ["--version"], exit: 0, durationMs: 9,
  stdout: "harness-cli 0.1.11", stderr: "", dbBefore: {}, dbAfter: {},
};
const FAIL: TimelineEvent = {
  ts: "2026-07-04T10:11:30+00:00", cmd: ["query", "matrix"], exit: 1, durationMs: 411,
  stdout: "", stderr: "error: database not found", dbBefore: {}, dbAfter: {},
};

test("renders the time, cmd, duration, and the db delta for a mutation", () => {
  const out = renderTimeline([MUTATION]);
  assert.match(out, /10:32:00/);
  assert.match(out, /intake --type spec_slice/);
  assert.match(out, /340ms/);
  assert.match(out, /intake: 2→3/);
  assert.match(out, /✓/, "exit 0 → success mark");
});

test("renders ✗ for a failed (exit≠0) command", () => {
  const out = renderTimeline([FAIL]);
  assert.match(out, /✗/);
  assert.match(out, /query matrix/);
});

test("omits a delta for reads (db maps empty)", () => {
  const out = renderTimeline([READ]);
  assert.match(out, /--version/);
  assert.doesNotMatch(out, /→/, "no delta arrow for a read");
});

test("selects the cursor row with the ▸ marker", () => {
  const out = renderTimeline([READ, MUTATION], 1);
  const readLine = out.split("\n").find((l) => l.includes("--version"))!;
  const mutLine = out.split("\n").find((l) => l.includes("intake --type"))!;
  assert.ok(!readLine.includes("▸"), "non-selected row has no marker");
  assert.ok(mutLine.includes("▸"), "selected row is marked");
});

test("degrades to a dim message when no events exist", () => {
  const out = renderTimeline([]);
  assert.match(out, /no observer events recorded yet/);
});

test("degrades to a dim message when errors.timeline is set (file absent)", () => {
  const lines = renderDashboardLines(
    bareState(),
    { tab: "timeline", cursor: 0, drill: null },
    dataWith([], { errors: { timeline: "timeline" } }),
    id,
    80
  );
  assert.match(lines.join("\n"), /timeline unavailable/);
});

// ─── layer 1: drill-down detail pane ───────────────────────────────────────

console.log("=== render: TIMELINE drill-down detail ===");

test("drilled detail shows cmd, exit, delta, and stdout/stderr", () => {
  const lines = renderDashboardLines(
    bareState(),
    { tab: "timeline", cursor: 0, drill: { kind: "timeline", index: 0 } },
    dataWith([MUTATION]),
    id,
    80
  );
  const out = lines.join("\n");
  assert.match(out, /intake --type spec_slice/);
  assert.match(out, /Exit:/);
  assert.match(out, /Delta:/);
  assert.match(out, /intake: 2→3/);
  assert.match(out, /stdout:/);
  assert.match(out, /Intake #3 recorded/);
});

test("drilled detail shows (no state change) for a read", () => {
  const lines = renderDashboardLines(
    bareState(),
    { tab: "timeline", cursor: 0, drill: { kind: "timeline", index: 0 } },
    dataWith([READ]),
    id,
    80
  );
  assert.match(lines.join("\n"), /\(no state change\)/);
});

test("drilled detail shows stderr for a failed command", () => {
  const lines = renderDashboardLines(
    bareState(),
    { tab: "timeline", cursor: 0, drill: { kind: "timeline", index: 0 } },
    dataWith([FAIL]),
    id,
    80
  );
  assert.match(lines.join("\n"), /database not found/);
});

// ─── layer 1: TIMELINE_MAX cap ─────────────────────────────────────────────

console.log("=== TIMELINE_MAX ===");

test("TIMELINE_MAX is 50 (DESIGN §8.2: last 50 calls)", () => {
  assert.equal(TIMELINE_MAX, 50);
});

// ─── layer 1: box-width alignment (intake #19 class of bug) ─────────────────

console.log("=== render: timeline box-width alignment ===");

/** A row whose cmd + delta would overflow a narrow box without truncation. */
const LONG: TimelineEvent = {
  ts: "2026-07-04T10:33:12+00:00",
  cmd: ["intake", "--type", "new_initiative", "--lane", "normal", "--summary", "a-very-long-summary-that-must-be-truncated"],
  exit: 0, durationMs: 12345,
  stdout: "x".repeat(200), stderr: "",
  dbBefore: { intake: 2, story: 6, decision: 5, backlog: 5, trace: 32 },
  dbAfter: { intake: 3, story: 7, decision: 5, backlog: 5, trace: 32 },
};

test("every timeline line fills the box width exactly at 76 (no overflow)", () => {
  const lines = renderDashboardLines(bareState(), { tab: "timeline", cursor: 0, drill: null }, dataWith([LONG]), id, 76);
  for (const ln of lines) {
    assert.equal(ansiVisibleWidth(ln), 76, `not 76 cols: ${JSON.stringify(ln)}`);
  }
});

test("every timeline line fills the box width exactly at the 60-col floor", () => {
  const lines = renderDashboardLines(bareState(), { tab: "timeline", cursor: 0, drill: null }, dataWith([LONG]), id, 60);
  for (const ln of lines) {
    assert.equal(ansiVisibleWidth(ln), 60, `not 60 cols: ${JSON.stringify(ln)}`);
  }
});

// ─── layer 2: Approach B — wiring through the REAL index.ts ────────────────

console.log("=== wiring: /harness → DASHBOARD → timeline tab ===");

const FIXTURE_EVENTS = [
  jl({ ts: "2026-07-04T10:11:30+00:00", cmd: ["query", "matrix"], exit: 1, duration_ms: 411, stdout: "", stderr: "error: database not found", db_before: {}, db_after: {} }),
  jl({ ts: "2026-07-04T10:32:00+00:00", cmd: ["intake", "--type", "spec_slice"], exit: 0, duration_ms: 340, stdout: "Intake #3 recorded.", stderr: "", db_before: { intake: 2 }, db_after: { intake: 3 } }),
  jl({ ts: "2026-07-04T10:33:12+00:00", cmd: ["story", "add", "--id", "US-015"], exit: 0, duration_ms: 210, stdout: "Story US-015 added.", stderr: "", db_before: { story: 16 }, db_after: { story: 17 } }),
].join("\n");

const WIRED_MATRIX =
  "US-015  P5 timeline render  planned  0  0  0  0\n";
const WIRED_STATS =
  "=== Harness Stats ===\nintakes  stories  decisions  backlog_items  traces\n" +
  "-------  -------  ---------  -------------  ------\n18       17       5          6              34\n";

/** Minimal mock ExtensionAPI + ctx (modeled on tests/p4.test.ts). `keySeqs[i]`
 *  is the key sequence driven on the i-th ctx.ui.custom call. */
function mockHarness(cwd: string, keySeqs: string[][] = [["\u001b"]]) {
  const state = {
    customCalls: 0,
    renders: [] as string[][],
    /** # of times the live-tail watcher entry asked the TUI to re-render. */
    requestRenderCalls: 0,
    /** Last overlay component (US-016: so tests can drive refreshTimelineTail). */
    lastComponent: undefined as
      | undefined
      | {
          render?(w: number): string[];
          handleInput?(d: string): void;
          refreshTimelineTail(): Promise<void>;
          dispose?(): void;
        },
  };
  let seqIdx = 0;
  const registeredCommands = new Map<string, (a: string, c: unknown) => Promise<void>>();
  const pi = {
    registerCommand(name: string, o: { handler: (a: string, c: unknown) => Promise<void> }) {
      registeredCommands.set(name, o.handler);
    },
    on() { /* not exercised by the command handler */ },
    async exec(_cmd: string, args: string[]) {
      if (args[0] === "--version") return { stdout: "harness-cli 0.1.11\n", stderr: "", code: 0, killed: false };
      if (args[0] === "query" && args[1] === "stats") return { stdout: WIRED_STATS, stderr: "", code: 0, killed: false };
      if (args[0] === "query" && args[1] === "matrix") return { stdout: WIRED_MATRIX, stderr: "", code: 0, killed: false };
      if (args[0] === "query" && args[1] === "backlog") return { stdout: "", stderr: "", code: 0, killed: false };
      if (args[0] === "query" && args[1] === "tools") return { stdout: "[]", stderr: "", code: 0, killed: false };
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
  };
  /** Mock pi-tui TUI: requestRender is the live-tail re-render lever (OQ-4). */
  const tui = { requestRender: () => { state.requestRenderCalls++; } };
  const ctx = {
    cwd,
    signal: undefined as AbortSignal | undefined,
    mode: "tui" as const,
    hasUI: true,
    ui: {
      theme: { fg: (_c: string, t: string) => t },
      notify() {},
      setStatus() {},
      custom: async (
        factory: (t: unknown, th: unknown, kb: unknown, done: (r: unknown) => void) => {
          handleInput?(d: string): void; render?(w: number): string[]; dispose?(): void;
        }
      ) => {
        state.customCalls++;
        let result: unknown;
        let closedByComponent = false;
        const done = (r: unknown) => { result = r; closedByComponent = true; };
        const comp = factory(tui, { fg: (_c: string, t: string) => t }, {}, done);
        state.lastComponent = comp as typeof state.lastComponent;
        const renders: string[] = [];
        if (typeof comp.render === "function") renders.push(comp.render(76).join("\n"));
        const seq = keySeqs[seqIdx++] ?? ["\u001b"];
        for (const k of seq) {
          comp.handleInput?.(k);
          if (result !== undefined) break;
          if (typeof comp.render === "function") renders.push(comp.render(76).join("\n"));
        }
        // Faithful to the real showExtensionCustom.close(): dispose ONLY when
        // the component actually closed itself (Esc/refresh/install). When the
        // key sequence ends open, return a harmless `close` so the handler's
        // do/while exits cleanly, but leave the component alive + undisposed so
        // live-tail tests can drive refreshTimelineTail then dispose() itself.
        if (closedByComponent) {
          try { comp.dispose?.(); } catch { /* ignore */ }
        }
        state.renders.push(renders);
        return result ?? { action: "close" };
      },
    },
  };
  return { pi, ctx, state, registeredCommands };
}

/** Fixture repo: harness installed + db + a populated events.jsonl. */
function repoWithEvents(eventsText?: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "harness-p5-"));
  mkdirSync(join(cwd, "scripts", "bin"), { recursive: true });
  writeFileSync(join(cwd, "scripts", "bin", "harness-cli"), "#!/bin/sh\n");
  writeFileSync(join(cwd, "harness.db"), "");
  if (eventsText !== undefined) {
    mkdirSync(join(cwd, ".harness-observer"), { recursive: true });
    writeFileSync(join(cwd, ".harness-observer", "events.jsonl"), eventsText);
  }
  return cwd;
}

test("wired: 't' renders the observer events as flow rows with the db delta", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = repoWithEvents(FIXTURE_EVENTS);
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, [["t", "\u001b"]]);
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);

    const renders = state.renders[0]!;
    assert.match(renders[0]!, /US-015/, "initial render = matrix tab");
    const tl = renders[renders.length - 1]!;
    assert.match(tl, /intake --type spec_slice/);
    assert.match(tl, /intake: 2→3/, "db delta surfaces in the wired timeline");
    assert.match(tl, /story: 16→17/);
    assert.match(tl, /✗/, "failed query matrix shows the error mark");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("wired: timeline drill-down shows stdout/stderr", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = repoWithEvents(FIXTURE_EVENTS);
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, [["t", "j", "\r", "\u001b", "\u001b"]]);
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);

    const renders = state.renders[0]!;
    const drilled = renders.find((r) => /Intake #3 recorded/.test(r));
    assert.ok(drilled, "drilled detail surfaces the event stdout");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("wired: missing events.jsonl → timeline tab degrades to a dim message", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = repoWithEvents(/* no events.jsonl written */ undefined);
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, [["t", "\u001b"]]);
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);

    const renders = state.renders[0]!;
    const tl = renders[renders.length - 1]!;
    assert.match(tl, /timeline unavailable/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ─── layer 2 wiring: US-016 live tail (fs.watch + async re-render) ─────────

console.log("\n=== wiring: US-016 live tail ===");

test("wired: live tail — appending events.jsonl surfaces the new row without re-opening the overlay", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = repoWithEvents(FIXTURE_EVENTS);
  try {
    // key seq ["t"] lands on the timeline tab and does NOT close → the component
    // stays alive so we can drive the watcher entry point directly.
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, [["t"]]);
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);

    const comp = state.lastComponent!;
    const before = state.renders[0]!.at(-1)!;
    assert.doesNotMatch(before, /97→98/, "live event not yet present");

    // Simulate the observer appending a flow event while the tab is open.
    appendFileSync(
      join(cwd, ".harness-observer", "events.jsonl"),
      "\n" + jl({ ts: "2026-07-04T10:40:00+00:00", cmd: ["trace"], exit: 0, duration_ms: 12, stdout: "Trace #98 recorded.", stderr: "", db_before: { trace: 97 }, db_after: { trace: 98 } })
    );
    // Drive the watcher entry point (the real fs.watch fires the same method).
    await comp.refreshTimelineTail();

    const after = (comp.render?.(76) ?? []).join("\n");
    assert.match(after, /trace/, "appended event surfaces in place");
    assert.match(after, /trace: 97→98/, "db delta of the live event surfaces");
    assert.equal(state.customCalls, 1, "overlay was NOT re-opened — update was in-place");
    assert.ok(state.requestRenderCalls >= 1, "the watcher entry requested a re-render (OQ-4 lever)");
    comp.dispose?.();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("wired: refreshTimelineTail degrades to a dim message when events.jsonl disappears mid-watch", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = repoWithEvents(FIXTURE_EVENTS);
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, [["t"]]);
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);
    const comp = state.lastComponent!;

    // File deleted under the watcher (ENOENT mid-watch).
    rmSync(join(cwd, ".harness-observer", "events.jsonl"));
    await comp.refreshTimelineTail();

    const after = (comp.render?.(76) ?? []).join("\n");
    assert.match(after, /timeline unavailable/, "degrades to the dim message, never throws");
    comp.dispose?.();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("wired: dispose tears down the watcher and is idempotent (never throws)", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = repoWithEvents(FIXTURE_EVENTS);
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, [["t"]]);
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);
    const comp = state.lastComponent!;

    assert.doesNotThrow(() => comp.dispose?.(), "first dispose closes the watcher + clears the debounce");
    assert.doesNotThrow(() => comp.dispose?.(), "second dispose is a no-op");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await run();
