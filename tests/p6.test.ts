// tests/p6.test.ts — P6 readiness() + footer next-required-action (US-018).
//
// Run: npx tsx tests/p6.test.ts
//
// US-018 re-points the footer at the ONE next-required-action (or `ready`)
// sourced from pure readiness(). This file unit-tests readiness() (the shared
// contract US-019/020/021 will consume) and renderFooter per-branch. decideGateA
// stays byte-identical (HARD CONSTRAINT) so p2's gate suite is the regression
// guard for that.

import assert from "node:assert/strict";
import { readiness } from "../extensions/harness/gates.ts";
import type { HarnessState } from "../extensions/harness/detect.ts";
import type { DriftRecord } from "../extensions/harness/drift.ts";

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

const SETUP_OK = { cliInstalled: true, dbInitialized: true };
/** identity colorizer — returns text verbatim so assertions see the raw string */
const id = (_c: string, t: string) => t;

console.log("=== readiness: ordered checklist + firstUnmet (OQ-1 setup>intake>drift>trace) ===");

test("cli unmet → firstUnmet 'cli' even when everything else is also off", () => {
  const r = readiness(
    { cliInstalled: false, dbInitialized: false },
    { intakeRecorded: false, traceRecorded: false },
    5
  );
  assert.equal(r.firstUnmet, "cli");
  assert.equal(r.ready, false);
  assert.match(r.nextAction!, /install/i);
  assert.equal(r.checklist.cli, false);
});

test("cli ok, db missing → firstUnmet 'db'", () => {
  const r = readiness(
    { cliInstalled: true, dbInitialized: false },
    { intakeRecorded: true, traceRecorded: true },
    0
  );
  assert.equal(r.firstUnmet, "db");
  assert.match(r.nextAction!, /\/harness to set up/);
});

test("setup ok, no intake → firstUnmet 'intake' (drift present is ignored)", () => {
  const r = readiness(SETUP_OK, { intakeRecorded: false, traceRecorded: false }, 3);
  assert.equal(r.firstUnmet, "intake");
  assert.match(r.nextAction!, /record an intake/i);
});

test("setup+intake ok, drift present → firstUnmet 'drift' with count embedded", () => {
  const r = readiness(SETUP_OK, { intakeRecorded: true, traceRecorded: false }, 2);
  assert.equal(r.firstUnmet, "drift");
  assert.equal(r.nextAction, "2 drift — sync markdown↔durable");
});

test("setup+intake+drift ok, no trace → firstUnmet 'trace'", () => {
  const r = readiness(SETUP_OK, { intakeRecorded: true, traceRecorded: false }, 0);
  assert.equal(r.firstUnmet, "trace");
  assert.match(r.nextAction!, /record a trace/i);
});

test("all met → ready, nextAction null, full checklist true", () => {
  const r = readiness(SETUP_OK, { intakeRecorded: true, traceRecorded: true }, 0);
  assert.equal(r.firstUnmet, null);
  assert.equal(r.nextAction, null);
  assert.equal(r.ready, true);
  assert.deepEqual(r.checklist, {
    cli: true,
    db: true,
    intake: true,
    drift: true,
    trace: true,
  });
});

test("priority: intake beats drift+trace when several are unmet", () => {
  const r = readiness(SETUP_OK, { intakeRecorded: false, traceRecorded: false }, 9);
  assert.equal(r.firstUnmet, "intake");
});

test("priority: drift beats trace when both unmet", () => {
  const r = readiness(SETUP_OK, { intakeRecorded: true, traceRecorded: false }, 4);
  assert.equal(r.firstUnmet, "drift");
});

test("driftCount 0 → checklist.drift true; >0 → false", () => {
  assert.equal(
    readiness(SETUP_OK, { intakeRecorded: true, traceRecorded: true }, 0).checklist.drift,
    true
  );
  assert.equal(
    readiness(SETUP_OK, { intakeRecorded: true, traceRecorded: true }, 1).checklist.drift,
    false
  );
});

console.log("=== renderFooter: per-branch next-action + ready (OQ-3 quiet) ===");

// renderFooter lives in index.ts (the pi entrypoint); dynamic-import it the way
// p2/p3/p4/p5 do. It only reads state.{error,cliInstalled,dbInitialized}.
type RenderFooter = (
  s: HarnessState,
  drift: DriftRecord[],
  session: { intakeRecorded: boolean; traceRecorded: boolean },
  fg: (c: string, t: string) => string
) => string;
let renderFooter!: RenderFooter;

function hstate(
  opts: Partial<{ cliInstalled: boolean; dbInitialized: boolean; error: string }>
): HarnessState {
  return {
    cwd: "",
    cliInstalled: true,
    dbInitialized: true,
    cliVersion: null,
    shimPresent: false,
    claudeShimPresent: false,
    observerInstalled: false,
    ...opts,
  } as HarnessState;
}
const driftN = (n: number) => Array.from({ length: n }) as unknown as DriftRecord[];

test("renderFooter is exported from index.ts", async () => {
  const mod = await import("../extensions/harness/index.ts");
  renderFooter = mod.renderFooter;
  assert.equal(typeof renderFooter, "function");
});

test("detection error → '🪢 —' (short-circuit before readiness)", () => {
  const out = renderFooter(
    hstate({ error: "boom" }),
    [],
    { intakeRecorded: false, traceRecorded: false },
    id
  );
  assert.equal(out, "🪢 —");
});

test("no cli → setup install line", () => {
  const out = renderFooter(
    hstate({ cliInstalled: false }),
    [],
    { intakeRecorded: false, traceRecorded: false },
    id
  );
  assert.equal(out, "🪢 no harness — run /harness to install");
});

test("db missing → points to /harness (the install wizard inits the db)", () => {
  const out = renderFooter(
    hstate({ dbInitialized: false }),
    [],
    { intakeRecorded: true, traceRecorded: true },
    id
  );
  assert.equal(out, "🪢 db not initialized — run /harness to set up");
});

test("no intake → intake line (drift ignored — lower priority)", () => {
  const out = renderFooter(
    hstate({}),
    driftN(2),
    { intakeRecorded: false, traceRecorded: false },
    id
  );
  assert.equal(out, "🪢 record an intake before editing");
});

test("drift present → drift line with count", () => {
  const out = renderFooter(
    hstate({}),
    driftN(3),
    { intakeRecorded: true, traceRecorded: false },
    id
  );
  assert.equal(out, "🪢 3 drift — sync markdown↔durable");
});

test("no trace → trace line", () => {
  const out = renderFooter(hstate({}), [], { intakeRecorded: true, traceRecorded: false }, id);
  assert.equal(out, "🪢 record a trace when done");
});

test("all clear → '🪢 ready' and NO vanity counts", () => {
  const out = renderFooter(hstate({}), [], { intakeRecorded: true, traceRecorded: true }, id);
  assert.equal(out, "🪢 ready");
  assert.ok(!/stories|traces|backlog/.test(out), "vanity counts must be gone from the footer");
});

await run();
