// tests/p4.test.ts — unit tests for the P4 DASHBOARD pure module + /harness wiring.
//
// Run: npx tsx tests/p4.test.ts
//
// Two layers, mirroring tests/p3.test.ts:
//   1. Pure dashboard.ts logic (matrix parser, dashboard renderer, box-width
//      alignment, tab placeholders).
//   2. Approach-B wiring: load the REAL index.ts, capture pi.registerCommand,
//      drive the /harness handler against an installed+db fixture with a mock
//      ExtensionAPI whose exec returns `query matrix --numeric` output. Exercises
//      route → fetchMatrix → overlay (dashboard) → tab switch → refresh loop →
//      close, plus failing-query degradation — without an LLM.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseMatrixNumeric,
  renderDashboardLines,
  type DashboardTab,
  type MatrixRow,
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

// Captured `query matrix --numeric` shape (3 rows: implemented / planned / retired;
// titles include spaces + punctuation to exercise the parser).
const FIXTURE_MATRIX =
  "id      title                                                             status       unit  integ  e2e  plat  evidence\n" +
  "------  ----------------------------------------------------------------  -----------  ----  -----  ---  ----  --------\n" +
  "US-001  Auth login                                                        implemented  1     1      0    0\n" +
  "US-002  Manager roles                                                     planned      0     0      0    0\n" +
  "US-003  Old/replaced thing                                                retired      0     0      0    0\n";

// ─── parser ────────────────────────────────────────────────────────────────

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

// ─── render: matrix tab ────────────────────────────────────────────────────

console.log("=== dashboard: renderDashboardLines (matrix tab) ===");
test("renders title, detected-state header, tab strip, footer hints", () => {
  const rows = parseMatrixNumeric(FIXTURE_MATRIX);
  const text = renderDashboardLines(bareState(), "matrix", rows, id).join("\n");
  assert.match(text, /repository-harness · dashboard/);
  assert.match(text, /cli 0\.1\.11/);
  assert.match(text, /db ok/);
  assert.match(text, /1 matrix/);
  assert.match(text, /2 stats.*3 backlog.*4 tools.*t timeline/);
  assert.match(text, /\[1-4\] tabs.*\[r\] refresh.*\[Esc\] close/);
});
test("matrix tab lists every story row with status + id", () => {
  const rows = parseMatrixNumeric(FIXTURE_MATRIX);
  const text = renderDashboardLines(bareState(), "matrix", rows, id).join("\n");
  assert.match(text, /US-001/);
  assert.match(text, /Auth login/);
  assert.match(text, /implemented/);
  assert.match(text, /US-002/);
  assert.match(text, /planned/);
  assert.match(text, /US-003/);
  assert.match(text, /retired/);
});
test("empty matrix → dim empty-state row (no throw)", () => {
  const text = renderDashboardLines(bareState(), "matrix", [], id).join("\n");
  assert.match(text, /no stories/);
});

// ─── render: non-matrix tabs are honest placeholders ───────────────────────

console.log("=== dashboard: renderDashboardLines (placeholder tabs) ===");
test("stats/backlog/tools tabs ship-in-US-011; timeline ships-in-P5", () => {
  const tabs: DashboardTab[] = ["stats", "backlog", "tools", "timeline"];
  for (const t of tabs) {
    const text = renderDashboardLines(bareState(), t, [], id).join("\n");
    const expect = t === "timeline" ? "P5" : "US-011";
    assert.match(text, new RegExp(`${t} tab ships in ${expect}`), `${t} placeholder`);
  }
});

// ─── render: box-width alignment ───────────────────────────────────────────

console.log("=== dashboard: box-width alignment ===");
test("every rendered line is exactly the box width (74 inner / 76 outer)", () => {
  const rows = parseMatrixNumeric(FIXTURE_MATRIX);
  for (const tab of ["matrix", "stats", "backlog", "tools", "timeline"] as DashboardTab[]) {
    const lines = renderDashboardLines(bareState(), tab, rows, id, 76);
    for (const ln of lines) {
      assert.equal(ansiVisibleWidth(ln), 76, `${tab}: line not 76 cols: ${JSON.stringify(ln)}`);
    }
  }
});
test("alignment holds at the narrower floor width (60)", () => {
  const rows = parseMatrixNumeric(FIXTURE_MATRIX);
  const lines = renderDashboardLines(bareState(), "matrix", rows, id, 60);
  for (const ln of lines) {
    assert.equal(ansiVisibleWidth(ln), 60, `line not 60 cols: ${JSON.stringify(ln)}`);
  }
});

// ─── Approach B: wiring through the REAL index.ts ──────────────────────────

console.log("=== wiring: /harness → DASHBOARD route + matrix fetch ===");

/** A realistic `query matrix --numeric` body for the wired exec mock. */
const WIRED_MATRIX =
  "US-001  P1 detect + footer      implemented  1  1  0  0\n" +
  "US-010  P4 dashboard shell      planned      0  0  0  0\n";

/**
 * Mock ExtensionAPI + ctx. `keySeqs[i]` is the key sequence driven on the i-th
 * `ctx.ui.custom` call; after each non-closing key the component is re-rendered
 * into `renders` so tests can assert tab switches. `matrixCode`/`matrixStdout`
 * model a failing query for the degradation test.
 */
function mockHarness(
  cwd: string,
  opts: { keySeqs?: string[][]; matrixStdout?: string; matrixCode?: number } = {}
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
      if (args[0] === "query" && args[1] === "stats")
        return {
          stdout: "intakes  stories  decisions  backlog_items  traces\n2        2        0          0              1\n",
          stderr: "",
          code: 0,
          killed: false,
        };
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

test("installed+db → DASHBOARD route: fetches query matrix --numeric, no installer", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, execCalls, state, registeredCommands } = mockHarness(cwd);
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);

    assert.equal(state.customCalls, 1, "dashboard overlay opens exactly once");
    assert.equal(state.matrixCalls, 1, "fetchMatrix runs query matrix --numeric once");
    assert.ok(
      execCalls.some((c) => c.args[0] === "query" && c.args[1] === "matrix" && c.args[2] === "--numeric"),
      "must exec `query matrix --numeric`"
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

test("tab switch: '2' re-renders the stats placeholder; '1' returns to matrix", async () => {
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
    assert.match(renders[1]!, /stats tab ships in US-011/, "after '2' = stats placeholder");
    assert.match(renders[2]!, /US-001/, "after '1' = back to matrix");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("refresh loop: 'r' re-fetches matrix and re-opens the overlay", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, {
      keySeqs: [["r"], ["\u001b"]],
    });
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);

    assert.equal(state.customCalls, 2, "overlay re-opens once per refresh");
    assert.equal(state.matrixCalls, 2, "matrix is re-fetched on each refresh");
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

test("failing query (exit 1) → empty matrix, dim empty-state, no throw", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = installedRepo();
  try {
    const { pi, ctx, state, registeredCommands } = mockHarness(cwd, {
      matrixStdout: "",
      matrixCode: 1,
      keySeqs: [["\u001b"]],
    });
    mod.default(pi as never);
    // must not throw
    await registeredCommands.get("harness")!("", ctx as never);
    assert.match(state.renders[0]![0]!, /no stories/, "degrades to empty-state row");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

void run();
