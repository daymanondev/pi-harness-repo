// gates.ts — pure enforcement-gate logic (DESIGN.md §9.2).
//
// Pure contract: NO pi types, NO pi runtime, NO filesystem. Everything that
// depends on state is passed in. This keeps the gate decisions unit-testable
// in isolation. The wiring (when to call these, from which pi event) lives in
// index.ts.
//
// Resolved open questions (DESIGN.md §13.5 / §13.6):
//   §13.5 — Hard-block, no /harness bypass in P2. Read-only tools (read, grep,
//           glob, ls, ...) and harness-cli calls are never intercepted, so the
//           agent is never trapped away from investigating. The only way past
//           Gate A is to record an intake — which is the desired behaviour.
//   §13.6 — Narrow scope. Gate A intercepts `write` and `edit` only. `bash` is
//           NOT gated by Gate A (classifying mutating bash is fragile, and the
//           field-evidence failure mode — writing code — is caught by
//           write/edit). Gate C still nags on failed bash. Broadening to bash
//           remains a future option.

/** A gate verdict. `block:false` lets the call through; `block:true` rejects. */
export type GateDecision =
  | { block: false }
  | { block: true; reason: string };

/** Minimal view of HarnessState the gates need. */
export interface GateState {
  cliInstalled: boolean;
  dbInitialized: boolean;
}

/** Minimal view of per-cwd session state the intake gate needs. */
export interface IntakeGateSession {
  intakeRecorded: boolean;
}

/** Minimal view of a tool_call input the gates inspect. */
export interface ToolInput {
  /** bash input.command; absent for write/edit. */
  command?: string;
  /** write/edit input.path; absent for bash. */
  path?: string;
}

// ─── tool classification ───────────────────────────────────────────────────

/** Tools that mutate files and are therefore subject to Gate A (narrow scope). */
const MUTATION_TOOLS = new Set(["write", "edit"]);

/**
 * Does a bash command string invoke the harness CLI (read/query/init/intake/
 * trace/...)? Used to exempt harness-cli itself from gating and to detect
 * intake/trace calls in tool_result.
 *
 * Matches:  ./scripts/bin/harness-cli ...  |  harness-cli ...   (with .real/.exe too)
 * Does NOT match: `harness-cli-notes.txt` (a different token).
 */
export function isHarnessCliCall(command: string | undefined): boolean {
  if (!command) return false;
  // Word-boundary match on the binary basename, tolerating path prefixes,
  // the observer's `.real` suffix, and the Windows `.exe` suffix.
  // The binary is always followed by whitespace, a `.real`/`.exe` suffix, or
  // end-of-string. We require that so `harness-cli-notes.txt` does NOT match
  // (a `-word` tail means it is a different token).
  return /(^|[\s/])harness-cli(?:\.real|\.exe)?(?:\s|$)/.test(command);
}

/** Is this a `harness-cli ... intake ...` invocation? */
export function isHarnessIntakeCall(command: string | undefined): boolean {
  return (
    isHarnessCliCall(command) &&
    /\bintake\b/.test(command ?? "")
  );
}

/** Is this a `harness-cli ... trace ...` invocation (the "done" step)? */
export function isHarnessTraceCall(command: string | undefined): boolean {
  return (
    isHarnessCliCall(command) &&
    /\btrace\b/.test(command ?? "")
  );
}

/**
 * Does a bash command string invoke the harness CLI (read/query/init/intake/
 * trace/...)? Used to exempt harness-cli itself from gating and to detect
 * intake/trace calls in tool_result.
 *
 * Matches:  ./scripts/bin/harness-cli ...  |  harness-cli ...   (with .real/.exe too)
 * Does NOT match: `harness-cli-notes.txt` (a different token).
 */
export function isMutationToolCall(toolName: string): boolean {
  return MUTATION_TOOLS.has(toolName);
}

// ─── reason strings (a guide, not a wall — always carry the command) ────────

const INTAKE_USAGE =
  "scripts/bin/harness-cli intake --type " +
  "<new_spec|spec_slice|change_request|new_initiative|maintenance_request|harness_improvement> " +
  "--lane <tiny|normal|high-risk> --summary \"...\" [--flags \"...\"]";

export const REASON_PRECONDITION = `Repository-harness flow gate (A′): the database is not initialized, so the harness Task Loop cannot run. Do not start implementation. Run:
  scripts/bin/harness-cli init
  scripts/bin/harness-cli migrate
  scripts/bin/harness-cli query matrix     # confirm exit 0
THEN record an intake before editing (see below).`;

export const REASON_INTAKE = (extra = "") => `Repository-harness flow gate (A): record an intake BEFORE implementing. Run:
  ${INTAKE_USAGE}
then re-issue this ${extra ? extra + " " : ""}edit. (No intake has been recorded this session; \`harness-cli query intakes\` shows none newer than the intake grace window.)`;

// ─── gate decisions ────────────────────────────────────────────────────────

/**
 * Gate A′ — precondition: block ALL mutation tools when the db is missing.
 * Routes the agent to init+migrate, never to editing.
 */
export function gatePrecondition(
  state: GateState
): GateDecision {
  if (!state.cliInstalled || !state.dbInitialized) {
    return { block: true, reason: REASON_PRECONDITION };
  }
  return { block: false };
}

/**
 * Gate A — intake: block write/edit until an intake has been recorded.
 * Caller must first confirm the precondition passes (cli+db present) and that
 * the tool is a mutation tool (write/edit). Returns block:false otherwise.
 */
export function gateIntake(
  state: GateState,
  session: IntakeGateSession
): GateDecision {
  if (!state.cliInstalled || !state.dbInitialized) return { block: false };
  if (session.intakeRecorded) return { block: false };
  return { block: true, reason: REASON_INTAKE() };
}

/**
 * Top-level Gate A/A′ decision for a tool_call. Encodes the full precedence:
 *   1. not a harness repo            → pass (don't gate non-harness repos)
 *   2. bash                          → pass (narrow scope; bash exempt)
 *   3. harness-cli call              → pass (never block harness-cli itself)
 *   4. db missing                    → block A′ (all mutation tools)
 *   5. write/edit + no intake        → block A
 *   6. otherwise (read/grep/...)     → pass
 *
 * NOTE: Gate B′ (drift) is a separate decision in drift.ts because it inspects
 * the drift record list, not tool shape.
 */
export function decideGateA(
  toolName: string,
  input: ToolInput,
  state: GateState,
  session: IntakeGateSession
): GateDecision {
  // (1) only gate real harness repos
  if (!state.cliInstalled) return { block: false };
  // (2)(3) bash + harness-cli calls pass (narrow scope)
  if (toolName === "bash") {
    if (isHarnessCliCall(input.command)) return { block: false };
    return { block: false }; // bash exempt from Gate A (§13.6 narrow)
  }
  // (4) precondition: db missing → block even would-be writes
  if (!state.dbInitialized) {
    if (isMutationToolCall(toolName)) return gatePrecondition(state);
    return { block: false };
  }
  // (5) intake gate on write/edit
  if (isMutationToolCall(toolName) && !session.intakeRecorded) {
    return gateIntake(state, session);
  }
  // (6) everything else (read/grep/glob/ls/...) passes
  return { block: false };
}
