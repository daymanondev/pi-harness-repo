// tests/p3.test.ts — unit tests for P3 pure modules + /harness wiring.
//
// Run: npx tsx tests/p3.test.ts
//
// Two layers, mirroring tests/p2.test.ts:
//   1. Pure overlay.ts logic (router, plan, render, key helpers, shim).
//   2. Approach-B wiring: load the REAL index.ts, capture pi.registerCommand,
//      then drive the /harness handler against a fixture repo with a mock
//      ExtensionAPI. Exercises route → overlay → runInstallPlan end-to-end
//      without an LLM.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ansiVisibleWidth,
  buildInstallerCommand,
  buildInstallPlan,
  buildShimInsertion,
  DEFAULT_FLAGS,
  enabledModes,
  HARNESS_BEGIN,
  HARNESS_SHIM_BLOCK,
  initialMode,
  INSTALLER_REF,
  installerUrl,
  isEnter,
  isEscape,
  nextMode,
  renderInstallLines,
  routeView,
  type InstallFlags,
} from "../extensions/harness/overlay.ts";
import type { HarnessState } from "../extensions/harness/detect.ts";
import { cliBinaryPath } from "../extensions/harness/detect.ts";

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

// helper: a fresh "nothing installed" state
function bareState(over: Partial<HarnessState> = {}): HarnessState {
  return {
    cwd: "/repo",
    cliInstalled: false,
    cliVersion: null,
    dbInitialized: false,
    shimPresent: false,
    claudeShimPresent: false,
    observerInstalled: false,
    ...over,
  };
}
const id = (_c: string, t: string) => t; // identity fg for plain-text assertions

// ─── router ────────────────────────────────────────────────────────────────

console.log("=== overlay: routeView ===");
test("no CLI → install", () => {
  assert.equal(routeView(bareState({ cliInstalled: false })), "install");
});
test("CLI present but db missing → install", () => {
  assert.equal(routeView(bareState({ cliInstalled: true, dbInitialized: false })), "install");
});
test("CLI + db present → dashboard", () => {
  assert.equal(
    routeView(bareState({ cliInstalled: true, dbInitialized: true })),
    "dashboard"
  );
});
test("shim present alone does not force install", () => {
  assert.equal(routeView(bareState({ cliInstalled: true, dbInitialized: true, shimPresent: true })), "dashboard");
});

// ─── protected-path awareness + mode cycling ───────────────────────────────

console.log("=== overlay: enabledModes / initialMode / nextMode ===");
test("clean repo: only fresh enabled", () => {
  const en = enabledModes(bareState({ shimPresent: false }));
  assert.deepEqual(en, { fresh: true, merge: false, override: false });
});
test("shim present: fresh disabled, merge/override enabled", () => {
  const en = enabledModes(bareState({ shimPresent: true }));
  assert.deepEqual(en, { fresh: false, merge: true, override: true });
});
test("initialMode prefers fresh", () => {
  assert.equal(initialMode(bareState({ shimPresent: false })), "fresh");
});
test("initialMode falls back to merge when shim present", () => {
  assert.equal(initialMode(bareState({ shimPresent: true })), "merge");
});
test("nextMode skips disabled (clean repo stays fresh)", () => {
  const f = { ...DEFAULT_FLAGS, mode: "fresh" as const };
  assert.equal(nextMode(f, bareState({ shimPresent: false })), "fresh");
});
test("nextMode cycles merge → override when both enabled", () => {
  const state = bareState({ shimPresent: true });
  let f: InstallFlags = { ...DEFAULT_FLAGS, mode: "merge" };
  assert.equal(nextMode(f, state), "override");
  f = { ...DEFAULT_FLAGS, mode: "override" };
  assert.equal(nextMode(f, state), "merge");
});

// ─── installer command + plan ──────────────────────────────────────────────

console.log("=== overlay: buildInstallerCommand ===");
test("fresh → curl|bash --yes with cache-bust", () => {
  const { command, args } = buildInstallerCommand({ ...DEFAULT_FLAGS, mode: "fresh" });
  assert.equal(command, "bash");
  assert.equal(args[0], "-c");
  const script = args[1]!;
  assert.ok(script.startsWith('curl -fsSL "'), `unexpected start: ${script}`);
  assert.ok(script.includes(installerUrl()), "must reference the pinned installer URL");
  assert.ok(script.includes("?$(date +%s)"), "must cache-bust the fetch");
  assert.ok(script.endsWith("| bash -s -- --yes"), `must pipe to bash --yes: ${script}`);
});
test("merge → --merge --yes", () => {
  const script = buildInstallerCommand({ ...DEFAULT_FLAGS, mode: "merge" }).args[1]!;
  assert.match(script, /--merge --yes$/);
});
test("override → --override --yes", () => {
  const script = buildInstallerCommand({ ...DEFAULT_FLAGS, mode: "override" }).args[1]!;
  assert.match(script, /--override --yes$/);
});
test("claude flag appended", () => {
  const script = buildInstallerCommand({ ...DEFAULT_FLAGS, claude: true }).args[1]!;
  assert.match(script, /--yes --claude$/);
});
test("dry-run flag appended", () => {
  const script = buildInstallerCommand({ ...DEFAULT_FLAGS, dryRun: true }).args[1]!;
  assert.match(script, / --dry-run$/);
});
test("installerUrl embeds the pinned ref", () => {
  assert.ok(installerUrl().includes(`/${INSTALLER_REF}/`));
  assert.ok(installerUrl().includes("install-harness.sh"));
});

console.log("=== overlay: buildInstallPlan (step sequence) ===");
test("fresh + initDb → [installer, init, migrate, shim]", () => {
  const plan = buildInstallPlan({ ...DEFAULT_FLAGS, mode: "fresh" }, { cwd: "/repo" });
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map((s) => s.kind), ["installer", "init", "migrate", "shim"]);
  assert.equal(plan[1]!.command, cliBinaryPath("/repo"));
  assert.deepEqual(plan[1]!.args, ["init"]);
  assert.deepEqual(plan[2]!.args, ["migrate"]);
});
test("dry-run → installer only", () => {
  const plan = buildInstallPlan({ ...DEFAULT_FLAGS, dryRun: true }, { cwd: "/repo" });
  assert.equal(plan.length, 1);
  assert.equal(plan[0]!.kind, "installer");
});
test("initDb=false → [installer, shim]", () => {
  const plan = buildInstallPlan({ ...DEFAULT_FLAGS, initDb: false }, { cwd: "/repo" });
  assert.deepEqual(plan.map((s) => s.kind), ["installer", "shim"]);
});
test("installer label reflects mode", () => {
  const plan = buildInstallPlan({ ...DEFAULT_FLAGS, mode: "merge" }, { cwd: "/repo" });
  assert.match(plan[0]!.label, /merge/);
});
test("init/migrate use the resolved CLI path, not bare harness-cli", () => {
  const plan = buildInstallPlan({ ...DEFAULT_FLAGS }, { cwd: "/repo" });
  assert.equal(plan[1]!.command, join("/repo", "scripts", "bin", "harness-cli"));
});

// ─── shim insertion ─────────────────────────────────────────────────────────

console.log("=== overlay: buildShimInsertion (idempotent) ===");
test("null when marker already present", () => {
  assert.equal(buildShimInsertion(`# Hi\n\n${HARNESS_SHIM_BLOCK}\n`), null);
});
test("appends block when absent", () => {
  const out = buildShimInsertion("# Project\n");
  assert.ok(out);
  assert.ok(out!.includes(HARNESS_BEGIN));
});
test("adds a blank separator when content lacks trailing newline", () => {
  const out = buildShimInsertion("# Project");
  assert.ok(out!.startsWith("\n\n"));
});

// ─── terminal helpers ──────────────────────────────────────────────────────

console.log("=== overlay: ansiVisibleWidth / keys ===");
test("ansiVisibleWidth strips SGR escapes", () => {
  assert.equal(ansiVisibleWidth("\x1b[31mhi\x1b[39m"), 2);
  assert.equal(ansiVisibleWidth("plain"), 5);
});
test("isEscape / isEnter", () => {
  assert.equal(isEscape("\u001b"), true);
  assert.equal(isEscape("a"), false);
  assert.equal(isEnter("\r"), true);
  assert.equal(isEnter("\n"), true);
  assert.equal(isEnter("a"), false);
});

// ─── render (identity fg → plain text) ─────────────────────────────────────

console.log("=== overlay: renderInstallLines / renderStatusLines ===");
test("install view renders title, detected state, planned steps, key hints", () => {
  const plan = buildInstallPlan({ ...DEFAULT_FLAGS, mode: "fresh" }, { cwd: "/repo" });
  const lines = renderInstallLines(bareState({ cwd: "/repo" }), { ...DEFAULT_FLAGS, mode: "fresh" }, plan, id);
  const text = lines.join("\n");
  assert.match(text, /repository-harness · install/);
  assert.match(text, /Detected state/);
  assert.match(text, /harness CLI : absent/);
  assert.match(text, /Planned steps/);
  assert.match(text, /Run repository-harness installer/);
  assert.match(text, /\(•\) Fresh/); // selected mode marker
  assert.match(text, /\[Enter\]\/i install/);
});
// renderStatusLines was retired in US-010 (DASHBOARD replaces the STATUS
// placeholder); its coverage lives in tests/p4.test.ts (renderDashboardLines).

test("all rendered lines are exactly the box width", () => {
  const plan = buildInstallPlan({ ...DEFAULT_FLAGS }, { cwd: "/repo" });
  const lines = renderInstallLines(bareState(), { ...DEFAULT_FLAGS }, plan, id, 76);
  for (const ln of lines) {
    assert.equal(ansiVisibleWidth(ln), 76, `line not 76 cols: ${JSON.stringify(ln)}`);
  }
});
test("overflow content is truncated to the box width (right border stays aligned)", () => {
  // Target path longer than the inner width must be truncated, not overflow.
  const longCwd = "/" + "x".repeat(200);
  const plan = buildInstallPlan({ ...DEFAULT_FLAGS }, { cwd: longCwd });
  const lines = renderInstallLines(bareState({ cwd: longCwd }), { ...DEFAULT_FLAGS }, plan, id, 60);
  for (const ln of lines) {
    assert.equal(ansiVisibleWidth(ln), 60, `line not 60 cols: ${JSON.stringify(ln)}`);
  }
});

// ─── Approach B: wiring through the REAL index.ts ──────────────────────────

console.log("=== wiring: /harness command registration + handler ===");

/** Build a mock ExtensionAPI + ctx capturing exec/notify/custom/registerCommand. */
function mockHarness(cwd: string, mode: "tui" | "json" = "tui") {
  const execCalls: { cmd: string; args: string[] }[] = [];
  const notifies: { msg: string; type?: string }[] = [];
  // Tracked on an object so tests read the LIVE value after the handler runs
  // (a bare `let customCalls` would be snapshotted by destructuring).
  const state = { customCalls: 0 };
  const registeredCommands = new Map<string, (args: string, ctx: unknown) => Promise<void>>();

  const pi = {
    registerCommand(name: string, opts: { handler: (a: string, c: unknown) => Promise<void> }) {
      registeredCommands.set(name, opts.handler);
    },
    on() {
      /* events not exercised by the command handler */
    },
    async exec(cmd: string, args: string[]) {
      execCalls.push({ cmd, args });
      if (args[0] === "--version")
        return { stdout: "harness-cli 0.1.11\n", stderr: "", code: 0, killed: false };
      if (args[0] === "query" && args[1] === "stats")
        return {
          stdout: "intakes  stories  decisions  backlog_items  traces\n9        9        3          4              12\n",
          stderr: "",
          code: 0,
          killed: false,
        };
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
  };

  const ctx = {
    cwd,
    signal: undefined as AbortSignal | undefined,
    mode,
    hasUI: mode === "tui",
    ui: {
      theme: { fg: (_c: string, t: string) => t },
      notify: (msg: string, type?: string) => notifies.push({ msg, type }),
      setStatus: () => {},
      custom: async (factory: (t: unknown, th: unknown, kb: unknown, done: (r: unknown) => void) => unknown) => {
        state.customCalls++;
        let result: unknown;
        const done = (r: unknown) => {
          result = r;
        };
        const comp = factory({}, { fg: (_c: string, t: string) => t }, {}, done) as {
          handleInput?(d: string): void;
        };
        // Simulate the user confirming: "i" installs (install view); Esc closes (status).
        comp.handleInput?.("i");
        if (result === undefined) comp.handleInput?.("\u001b");
        return result;
      },
    },
  };

  return { pi, ctx, execCalls, notifies, state, registeredCommands };
}

test("/harness is registered on setup", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = mkdtempSync(join(tmpdir(), "harness-reg-"));
  try {
    const { pi, registeredCommands } = mockHarness(cwd);
    mod.default(pi as never);
    assert.ok(registeredCommands.has("harness"), "/harness command not registered");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("INSTALL route: confirm → runs installer + init + migrate, writes shim, notifies success", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = mkdtempSync(join(tmpdir(), "harness-install-"));
  try {
    const { pi, ctx, execCalls, notifies, state, registeredCommands } = mockHarness(cwd);
    mod.default(pi as never);
    const handler = registeredCommands.get("harness")!;
    await handler("", ctx as never);

    assert.equal(state.customCalls, 1, "overlay should open exactly once");
    // plan = installer + init + migrate + shim(shim is a file write, not exec)
    const cmds = execCalls.map((c) => c.args[0]);
    assert.ok(cmds.includes("-c"), "installer (bash -c curl|bash) must run");
    assert.ok(execCalls.some((c) => c.args[0] === "init"), "harness-cli init must run");
    assert.ok(execCalls.some((c) => c.args[0] === "migrate"), "harness-cli migrate must run");
    // installer is the FIRST exec (detect skipped CLI probes — no CLI on disk)
    assert.equal(execCalls[0]!.args[0], "-c");
    // shim step wrote AGENTS.md with the marker
    const agents = readFileSync(join(cwd, "AGENTS.md"), "utf8");
    assert.ok(agents.includes(HARNESS_BEGIN), "AGENTS.md shim marker must be written");
    // success notify fired
    assert.ok(
      notifies.some((n) => /installed — footer is live/.test(n.msg)),
      `expected success notify; got: ${JSON.stringify(notifies)}`
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("DASHBOARD route: harness present → overlay opens, fetches matrix, no installer", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = mkdtempSync(join(tmpdir(), "harness-status-"));
  mkdirSync(join(cwd, "scripts", "bin"), { recursive: true });
  writeFileSync(join(cwd, "scripts", "bin", "harness-cli"), "#!/bin/sh\n"); // CLI present
  writeFileSync(join(cwd, "harness.db"), ""); // db present
  try {
    const { pi, ctx, execCalls, state, registeredCommands } = mockHarness(cwd);
    mod.default(pi as never);
    const handler = registeredCommands.get("harness")!;
    await handler("", ctx as never);

    assert.equal(state.customCalls, 1, "status overlay should open");
    assert.ok(
      !execCalls.some((c) => c.args[0] === "-c" && /curl/.test((c.args[1] ?? ""))),
      "installer must NOT run on the status route"
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("non-TUI: no overlay; one-line status notify only", async () => {
  const mod = await import("../extensions/harness/index.ts");
  const cwd = mkdtempSync(join(tmpdir(), "harness-nontui-"));
  try {
    const { pi, ctx, state, notifies, registeredCommands } = mockHarness(cwd, "json");
    mod.default(pi as never);
    await registeredCommands.get("harness")!("", ctx as never);
    assert.equal(state.customCalls, 0, "no overlay in non-TUI mode");
    assert.ok(notifies.length >= 1, "should print a one-line status");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

void run();
