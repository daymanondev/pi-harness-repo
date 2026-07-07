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

console.log("=== US-019: hintLines becomes a persistent next-action coach ===");

type HintLines = (
  s: HarnessState,
  drift: DriftRecord[],
  session: { intakeRecorded: boolean; traceRecorded: boolean }
) => string[] | undefined;
let hintLines!: HintLines;
const sess = (intake: boolean, trace: boolean) => ({
  intakeRecorded: intake,
  traceRecorded: trace,
});
/** Real-shaped drift record — summarizeDrift reads .storyId, so driftN's
 *  undefined-filled array only works for .length consumers (footer). */
const driftRec = (id: string): DriftRecord => ({
  storyId: id,
  durable: "planned",
  markdown: "implemented",
  kind: "status_mismatch",
});
const driftReal = (n: number): DriftRecord[] =>
  Array.from({ length: n }, (_, i) => driftRec(`US-00${10 + i}`));

test("hintLines is exported from index.ts", async () => {
  const mod = await import("../extensions/harness/index.ts");
  hintLines = mod.hintLines;
  assert.equal(typeof hintLines, "function");
});

test("no cli → install lines (unchanged)", () => {
  assert.deepEqual(hintLines(hstate({ cliInstalled: false }), [], sess(false, false)), [
    "repository-harness not found in this repo.",
    "Run /harness to install it.",
  ]);
});

test("cli present, db missing → db-init lines (unchanged)", () => {
  assert.deepEqual(hintLines(hstate({ dbInitialized: false }), [], sess(false, false)), [
    "Harness CLI is installed but the database isn't initialized.",
    "Run /harness to finish setup.",
  ]);
});

test("US-019: db ready, no intake → persistent coach line (does NOT vanish)", () => {
  const out = hintLines(hstate({}), driftN(0), sess(false, false));
  assert.deepEqual(out, ["Harness: record an intake before editing."]);
});

test("US-019: db ready, intake ok, drift present → drift coach line", () => {
  const out = hintLines(hstate({}), driftN(2), sess(true, false));
  assert.deepEqual(out, ["Harness: 2 drift — sync markdown↔durable."]);
});

test("US-019: db ready, intake+drift ok, no trace → trace coach line", () => {
  const out = hintLines(hstate({}), driftN(0), sess(true, false));
  assert.deepEqual(out, ["Harness: record a trace when done."]);
});

test("US-019: all ready → undefined (cleared, no stale hint)", () => {
  assert.equal(hintLines(hstate({}), driftN(0), sess(true, true)), undefined);
});

console.log("=== US-020: installNotifyText hands off to next requirement ===");

type InstallNotifyText = (
  session: { intakeRecorded: boolean; traceRecorded: boolean },
  driftCount: number
) => string;
let installNotifyText!: InstallNotifyText;

test("installNotifyText is exported from index.ts", async () => {
  const mod = await import("../extensions/harness/index.ts");
  installNotifyText = mod.installNotifyText;
  assert.equal(typeof installNotifyText, "function");
});

test("US-020: post-install (intake not recorded) → hands off to intake step", () => {
  assert.equal(
    installNotifyText(sess(false, false), 0),
    "repository-harness installed — next: record an intake before editing"
  );
  // must NOT be the bare 'installed ✓' that left the gate feeling ineffective
  assert.ok(!/footer is live/.test(installNotifyText(sess(false, false), 0)));
});

test("US-020: post-install with drift → drift handoff", () => {
  assert.equal(
    installNotifyText(sess(true, false), 3),
    "repository-harness installed — next: 3 drift — sync markdown↔durable"
  );
});

test("US-020: post-install, everything ready → 'installed — ready'", () => {
  assert.equal(installNotifyText(sess(true, true), 0), "repository-harness installed — ready");
});

console.log("=== US-021: injection leads with next-action, drops vanity counts ===");

type InjectionMessage = (
  s: HarnessState,
  session: { intakeRecorded: boolean; traceRecorded: boolean },
  drift: DriftRecord[]
) => string;
let injectionMessage!: InjectionMessage;

test("injectionMessage is exported from index.ts", async () => {
  const mod = await import("../extensions/harness/index.ts");
  injectionMessage = mod.injectionMessage;
  assert.equal(typeof injectionMessage, "function");
});

test("US-021: harness not set up → quiet (footer/widget cover setup)", () => {
  assert.equal(injectionMessage(hstate({ cliInstalled: false }), sess(false, false), driftN(0)), "");
});

test("US-021: intake unmet → LEADS with next-action; no vanity counts; trace nag kept", () => {
  const out = injectionMessage(hstate({}), sess(false, false), driftN(0));
  assert.ok(out.startsWith("[harness] next: record an intake before editing."), out);
  // vanity counts are gone from the lead
  assert.ok(!/durable layer:|intakes ·|stories ·|traces ·/.test(out), out);
  // trace nag still present (actionable)
  assert.ok(/Done Definition requires a recorded trace/.test(out), out);
});

test("US-021: drift present, intake ok → drift next-action + drift nag", () => {
  const out = injectionMessage(hstate({}), sess(true, false), driftReal(2));
  assert.ok(out.startsWith("[harness] next: 2 drift — sync markdown↔durable."), out);
  assert.ok(/markdown↔durable drift detected/.test(out), out);
  assert.ok(!/durable layer:/.test(out), "vanity counts must be gone");
});

test("US-021: all ready → quiet (drops counts; footer already says ready)", () => {
  assert.equal(injectionMessage(hstate({}), sess(true, true), driftN(0)), "");
});

test("US-021 regression: NO line ever starts with '[harness] durable layer:'", () => {
  const sessions = [sess(false, false), sess(true, false), sess(true, true)];
  for (const s of sessions) {
    for (const d of [driftN(0), driftReal(2)]) {
      const out = injectionMessage(hstate({}), s, d);
      assert.ok(
        !/^\[harness\] durable layer:/.test(out),
        `vanity-count lead survived: ${out}`
      );
    }
  }
});

await run();
