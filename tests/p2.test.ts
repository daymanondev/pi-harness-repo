// tests/p2.test.ts — unit tests for P2 pure modules (gates + drift).
//
// Run: npx tsx tests/p2.test.ts
//
// No pi runtime, no real filesystem. drift.detectDrift gets injected exec +
// readFile/readDir fixtures; gates get plain state/session objects.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decideGateA,
  gateIntake,
  gatePrecondition,
  isHarnessCliCall,
  isHarnessIntakeCall,
  isHarnessTraceCall,
  isMutationToolCall,
  parseCommandLeads,
} from "../extensions/harness/gates.ts";
import {
  parseMatrix,
  parseMarkdownStatus,
  isEvidenceMissing,
  storyIdFromFilename,
  detectDrift,
  type DriftRecord,
} from "../extensions/harness/drift.ts";
import { seedSession, getSession, refreshFromCounts, INTAKE_GRACE_MS } from "../extensions/harness/session.ts";

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

console.log("=== gates: isHarnessCliCall ===");
test("matches ./scripts/bin/harness-cli", () => {
  assert.equal(isHarnessCliCall("./scripts/bin/harness-cli query matrix"), true);
});
test("matches bare harness-cli", () => {
  assert.equal(isHarnessCliCall("harness-cli init"), true);
});
test("matches observer .real suffix", () => {
  assert.equal(isHarnessCliCall("./scripts/bin/harness-cli.real trace"), true);
});
test("does not match unrelated", () => {
  assert.equal(isHarnessCliCall("npm install"), false);
  assert.equal(isHarnessCliCall("cat harness-cli-notes.txt"), false);
});
test("undefined command is false", () => {
  assert.equal(isHarnessCliCall(undefined), false);
});

console.log("=== gates: argv parsing (no substring false positives) ===");
test("echo mentioning harness-cli is NOT a call", () => {
  assert.equal(isHarnessCliCall('echo "harness-cli trace"'), false);
  assert.equal(isHarnessTraceCall('echo "harness-cli trace"'), false);
});
test("grep over harness-cli.md is NOT a call", () => {
  assert.equal(isHarnessCliCall("grep trace path/harness-cli.md"), false);
});
test("env-prefixed real invocation IS a call", () => {
  assert.equal(isHarnessCliCall("FOO=bar harness-cli query matrix"), true);
});
test("compound script: trace detected as a real segment", () => {
  assert.equal(
    isHarnessTraceCall("git commit -m x && ./scripts/bin/harness-cli trace --summary y"),
    true
  );
});
test("compound script: intake detected as a real segment", () => {
  assert.equal(
    isHarnessIntakeCall("echo hi; harness-cli intake --type spec_slice"),
    true
  );
});
test("cat of a harness-cli-notes file is NOT a call", () => {
  assert.equal(isHarnessCliCall("cat harness-cli-notes.txt"), false);
});
test("parseCommandLeads splits segments", () => {
  const leads = parseCommandLeads("a=b git commit && echo hi || harness-cli trace");
  assert.deepEqual(leads, ["git", "echo", "harness-cli"]);
});

console.log("=== gates: intake/trace/mutation classifiers ===");
test("isHarnessIntakeCall", () => {
  assert.equal(isHarnessIntakeCall("harness-cli intake --type spec_slice"), true);
  assert.equal(isHarnessIntakeCall("harness-cli trace --summary x"), false);
});
test("isHarnessTraceCall", () => {
  assert.equal(isHarnessTraceCall("harness-cli trace --summary x"), true);
  assert.equal(isHarnessTraceCall("harness-cli intake --type x"), false);
});
test("isMutationToolCall", () => {
  assert.equal(isMutationToolCall("write"), true);
  assert.equal(isMutationToolCall("edit"), true);
  assert.equal(isMutationToolCall("bash"), false);
  assert.equal(isMutationToolCall("read"), false);
});

console.log("=== gates: gatePrecondition (A′) ===");
const OK = { cliInstalled: true, dbInitialized: true };
const NO_DB = { cliInstalled: true, dbInitialized: false };
const NO_CLI = { cliInstalled: false, dbInitialized: false };
test("A′ blocks when db missing", () => {
  const d = gatePrecondition(NO_DB);
  assert.equal(d.block, true);
  assert.match((d as { reason: string }).reason, /init/);
});
test("A′ passes when cli+db present", () => {
  assert.equal(gatePrecondition(OK).block, false);
});

console.log("=== gates: gateIntake (A) ===");
test("A blocks when no intake recorded", () => {
  const d = gateIntake(OK, { intakeRecorded: false });
  assert.equal(d.block, true);
  assert.match((d as { reason: string }).reason, /intake/);
});
test("A passes when intake recorded", () => {
  assert.equal(gateIntake(OK, { intakeRecorded: true }).block, false);
});

console.log("=== gates: decideGateA (precedence) ===");
test("non-harness repo: pass everything", () => {
  for (const tool of ["write", "edit", "bash", "read"]) {
    assert.equal(
      decideGateA(tool, {}, NO_CLI, { intakeRecorded: false }).block,
      false,
      `${tool} should pass in non-harness repo`
    );
  }
});
test("bash always passes (narrow scope §13.6)", () => {
  assert.equal(
    decideGateA("bash", { command: "npm install" }, OK, { intakeRecorded: false }).block,
    false
  );
});
test("harness-cli bash passes", () => {
  assert.equal(
    decideGateA("bash", { command: "harness-cli query matrix" }, OK, { intakeRecorded: false }).block,
    false
  );
});
test("write blocked pre-intake", () => {
  const d = decideGateA("write", { path: "src/x.ts" }, OK, { intakeRecorded: false });
  assert.equal(d.block, true);
});
test("write allowed post-intake", () => {
  assert.equal(
    decideGateA("write", { path: "src/x.ts" }, OK, { intakeRecorded: true }).block,
    false
  );
});
test("write blocked by A′ when db missing", () => {
  const d = decideGateA("write", { path: "src/x.ts" }, NO_DB, { intakeRecorded: true });
  assert.equal(d.block, true);
  assert.match((d as { reason: string }).reason, /A′/);
});
test("read passes regardless", () => {
  assert.equal(
    decideGateA("read", { path: "x" }, OK, { intakeRecorded: false }).block,
    false
  );
});

console.log("=== drift: parsers ===");
test("parseMatrix extracts statuses (spaces in title)", () => {
  const out = parseMatrix(
    "id  title           status       unit\n" +
      "US-001  P1 detect foo  implemented  yes\n" +
      "US-002  bar baz quux    planned      no\n"
  );
  assert.deepEqual(out, { "US-001": "implemented", "US-002": "planned" });
});
test("parseMarkdownStatus reads ## Status", () => {
  assert.equal(parseMarkdownStatus("# US-001\n\n## Status\n\nimplemented\n\n## Evidence"), "implemented");
});
test("parseMarkdownStatus empty when absent", () => {
  assert.equal(parseMarkdownStatus("# US-001\n\nno status here"), "");
});
test("isEvidenceMissing flags placeholder", () => {
  assert.equal(isEvidenceMissing("## Evidence\n\nTo be added\n\n## Status"), true);
  assert.equal(isEvidenceMissing("## Evidence\n\n- tsc clean\n- smoke pass\n\n## Status"), false);
});
test("isEvidenceMissing flags missing section", () => {
  assert.equal(isEvidenceMissing("# US-001\n\n## Status\n\nplanned"), true);
});
test("storyIdFromFilename", () => {
  assert.equal(storyIdFromFilename("US-003-drift-detection.md"), "US-003");
  assert.equal(storyIdFromFilename("README.md"), null);
});

console.log("=== drift: detectDrift (4 kinds + clean) ===");

// fake exec: returns query matrix
function makeExec(matrixOut: string) {
  return async (_cmd: string, args: string[]) => {
    if (args[0] === "query" && args[1] === "matrix") {
      return { stdout: matrixOut, stderr: "", code: 0, killed: false };
    }
    return { stdout: "", stderr: "", code: 1, killed: false };
  };
}

function driftFixture(
  matrixOut: string,
  files: Record<string, string>
): Promise<DriftRecord[]> {
  const exec = makeExec(matrixOut) as never;
  return detectDrift(
    "/fake/cwd",
    exec,
    {},
    {
      readDir: async () => Object.keys(files),
      readFile: async (p: string) => {
        const name = p.split("/").pop()!;
        return files[name] ?? "";
      },
    }
  );
}

test("clean: no drift", async () => {
  const r = await driftFixture(
    "US-001  foo  implemented\n",
    { "US-001-foo.md": "## Status\n\nimplemented\n\n## Evidence\n\n- tsc clean\n" }
  );
  assert.equal(r.length, 0, JSON.stringify(r));
});

test("status_mismatch", async () => {
  const r = await driftFixture(
    "US-001  foo  implemented\n",
    { "US-001-foo.md": "## Status\n\nin_progress\n\n## Evidence\n\n- x\n" }
  );
  assert.equal(r.length, 1);
  assert.equal(r[0]!.kind, "status_mismatch");
  assert.equal(r[0]!.storyId, "US-001");
});

test("orphan_markdown (file, no durable row)", async () => {
  const r = await driftFixture("US-001  foo  implemented\n", {
    "US-001-foo.md": "## Status\n\nimplemented\n\n## Evidence\n\n- x\n",
    "US-002-bar.md": "## Status\n\nplanned\n\n## Evidence\n\n- x\n",
  });
  assert.equal(r.length, 1);
  assert.equal(r[0]!.kind, "orphan_markdown");
  assert.equal(r[0]!.storyId, "US-002");
});

test("orphan_durable (active row, no file)", async () => {
  const r = await driftFixture(
    "US-001  foo  implemented\nUS-002  bar  planned\n",
    {
      "US-001-foo.md": "## Status\n\nimplemented\n\n## Evidence\n\n- x\n",
    }
  );
  assert.equal(r.length, 1);
  assert.equal(r[0]!.kind, "orphan_durable");
  assert.equal(r[0]!.storyId, "US-002");
});

test("retired durable without file is NOT drift", async () => {
  const r = await driftFixture(
    "US-001  foo  retired\n",
    {}
  );
  assert.equal(r.length, 0, JSON.stringify(r));
});

test("missing_evidence on implemented story", async () => {
  const r = await driftFixture(
    "US-001  foo  implemented\n",
    { "US-001-foo.md": "## Status\n\nimplemented\n\n## Evidence\n\nTo be added\n" }
  );
  assert.equal(r.length, 1);
  assert.equal(r[0]!.kind, "missing_evidence");
});

test("planned story without evidence is NOT drift", async () => {
  const r = await driftFixture(
    "US-001  foo  planned\n",
    { "US-001-foo.md": "## Status\n\nplanned\n\n## Evidence\n\nTo be added\n" }
  );
  assert.equal(r.length, 0, JSON.stringify(r));
});

console.log("=== session: seeding + grace window ===");
test("seedSession clears intake gate within grace window", () => {
  seedSession("/t1", 5, 3, Date.now() - 1000); // 1s ago
  assert.equal(getSession("/t1").intakeRecorded, true);
});
test("seedSession re-arms intake gate outside grace window", () => {
  seedSession("/t2", 5, 3, Date.now() - INTAKE_GRACE_MS - 1);
  assert.equal(getSession("/t2").intakeRecorded, false);
});
test("refreshFromCounts clears on count increase", () => {
  seedSession("/t3", 5, 3, 0);
  assert.equal(getSession("/t3").intakeRecorded, false);
  refreshFromCounts("/t3", 6, 3);
  assert.equal(getSession("/t3").intakeRecorded, true);
  assert.equal(getSession("/t3").traceRecorded, false);
  refreshFromCounts("/t3", 6, 4);
  assert.equal(getSession("/t3").traceRecorded, true);
});
test("trace gate has no grace window (always starts uncleared)", () => {
  seedSession("/t4", 5, 3, Date.now() - 1000);
  assert.equal(getSession("/t4").traceRecorded, false);
});

// ─── Approach B: wiring test through the REAL index.ts ─────────────────────
//
// Load the actual extension default export, feed it a mock ExtensionAPI that
// captures pi.on() handler registrations, then replay synthetic session_start /
// tool_call / tool_result events through the REAL handlers against a fixture
// repo on disk. This is the layer between unit (stubbed everything) and a live
// agent (LLM): deterministic, free, and it exercises the index.ts wiring +
// detect/drift/session modules end-to-end. Catches the stale-cache +
// over-block class of bugs that manual dogfood found.

console.log("=== wiring: index.ts gate lifecycle (Approach B) ===");

test("full gate lifecycle: intake block -> clear -> drift block -> clear", async () => {
  // dynamically import the compiled-runnable extension (default export)
  const mod = await import("../extensions/harness/index.ts");
  const setup = mod.default;

  // fixture repo on disk
  const cwd = mkdtempSync(join(tmpdir(), "harness-wiring-"));
  mkdirSync(join(cwd, "scripts", "bin"), { recursive: true });
  writeFileSync(join(cwd, "scripts", "bin", "harness-cli"), "#!/bin/sh\n"); // dummy presence
  writeFileSync(join(cwd, "harness.db"), ""); // dummy presence
  mkdirSync(join(cwd, "docs", "stories"), { recursive: true });
  writeFileSync(
    join(cwd, "docs", "stories", "US-001-foo.md"),
    "# US-001\n\n## Status\n\nimplemented\n\n## Evidence\n\n- proof\n"
  );
  // US-002: markdown says in_progress but durable (matrix) will say implemented => drift
  const driftedPacket = join(cwd, "docs", "stories", "US-002-bar.md");
  writeFileSync(driftedPacket, "# US-002\n\n## Status\n\nin_progress\n\n## Evidence\n\n- proof\n");
  const matrixOut = () => "US-001  foo  implemented\nUS-002  bar  implemented\n";

  try {
    // mock ExtensionAPI: capture handlers + canned exec
    const handlers = new Map<string, (e: Record<string, unknown>, ctx: Record<string, unknown>) => unknown>();
    const pi = {
      on(event: string, handler: (e: unknown, ctx: unknown) => unknown) {
        handlers.set(event, handler as never);
      },
      async exec(_cmd: string, args: string[]) {
        if (args[0] === "--version") return { stdout: "harness-cli 0.1.11\n", stderr: "", code: 0, killed: false };
        if (args[0] === "query" && args[1] === "stats")
          return { stdout: "intakes  stories  decisions  backlog_items  traces\n1        2        0          0              0\n", stderr: "", code: 0, killed: false };
        if (args[0] === "query" && args[1] === "matrix") return { stdout: matrixOut(), stderr: "", code: 0, killed: false };
        // old intake => outside grace window => intake gate starts armed
        if (args[0] === "query" && args[1] === "intakes")
          return { stdout: "id  created_at\n1   2020-01-01 00:00:00\n", stderr: "", code: 0, killed: false };
        return { stdout: "", stderr: "", code: 1, killed: false };
      },
    };
    setup(pi as never);

    const ctx = { cwd, signal: undefined, hasUI: false, ui: {} } as never;
    const tc = (e: Record<string, unknown>) => handlers.get("tool_call")!(e, ctx);
    const tr = (e: Record<string, unknown>) => handlers.get("tool_result")!(e, ctx);

    // session_start seeds baselines (intake old => armed)
    await handlers.get("session_start")!({}, ctx);

    // 1. Gate A: write BLOCKED pre-intake
    let d: { block?: boolean; reason?: string } | undefined =
      (await tc({ toolName: "write", input: { path: "x.ts" } })) as { block?: boolean } | undefined;
    assert.equal(d?.block, true, "write must block before intake");

    // 2. intake tool_result clears the gate
    await tr({ toolName: "bash", input: { command: "harness-cli intake --type spec_slice" }, isError: false });

    // 3. write now PASSES
    d = (await tc({ toolName: "write", input: { path: "x.ts" } })) as { block?: boolean } | undefined;
    assert.equal(d?.block ?? false, false, "write must pass after intake");

    // 4. Gate B': trace BLOCKED while US-002 drifts
    d = (await tc({ toolName: "bash", input: { command: "harness-cli trace --summary x" } })) as { block?: boolean; reason?: string } | undefined;
    assert.equal(d?.block, true, "trace must block while drift exists");
    assert.match(d?.reason ?? "", /drift gate/);

    // 5. fix the drift on disk (status -> implemented matches durable)
    writeFileSync(driftedPacket, "# US-002\n\n## Status\n\nimplemented\n\n## Evidence\n\n- proof\n");

    // 6. trace now PASSES (gateDriftOnTrace always fresh)
    d = (await tc({ toolName: "bash", input: { command: "harness-cli trace --summary x" } })) as { block?: boolean } | undefined;
    assert.equal(d?.block ?? false, false, "trace must pass once drift cleared");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

void run();
