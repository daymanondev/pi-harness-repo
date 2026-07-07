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

// ─── shell command parsing (argv-based, not substring grep) ───────────────
//
// Earlier versions grepped the WHOLE bash string for `harness-cli` + a
// subcommand word. That over-matched: `echo "harness-cli trace"` or
// `grep trace harness-cli.md` were treated as real invocations. We now split
// the script on shell sequencing operators and inspect the LEADING token of
// each segment, so only actual commands count.

const SEGMENT_SPLIT = /\s*(?:&&|\|\||;|\||\n)\s*/;
const HARNESS_BIN_RE = /^harness-cli(?:\.real|\.exe)?$/;

/** Strip a leading `VAR=value` env assignment (possibly several). */
function stripEnvPrefix(s: string): string {
  let out = s;
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S+\s+/.test(out)) {
    out = out.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S+\s+/, "");
  }
  return out;
}

/** Basename of a path-like token (everything after the last `/`). */
function basenameOf(token: string): string {
  const i = token.lastIndexOf("/");
  return i >= 0 ? token.slice(i + 1) : token;
}

/**
 * Leading command token of one shell segment, after stripping leading
 * env-var assignments. Returns null for empty/comment segments.
 */
export function segmentLead(segment: string): string | null {
  let s = segment.trim();
  if (!s || s.startsWith("#")) return null;
  s = stripEnvPrefix(s);
  // first whitespace-delimited token, tolerating a leading quote
  const m = s.match(/^("?)([^\s"']+)\1/);
  return m ? m[2]! : null;
}

/**
 * Split a bash script into the leading command token of each segment
 * (separated by `&&`, `||`, `;`, `|`, or newlines). Exported for unit tests.
 */
export function parseCommandLeads(script: string): string[] {
  const leads: string[] = [];
  for (const seg of script.split(SEGMENT_SPLIT)) {
    const lead = segmentLead(seg);
    if (lead) leads.push(lead);
  }
  return leads;
}

/**
 * Does the script INVOKE harness-cli as a command (not merely mention it in
 * an echo/grep argument)? Tolerates path prefixes and `.real`/`.exe` suffixes.
 */
export function isHarnessCliCall(command: string | undefined): boolean {
  if (!command) return false;
  return parseCommandLeads(command).some((t) => HARNESS_BIN_RE.test(basenameOf(t)));
}

/** Iterate harness-cli-invoking segments of a script. */
function harnessCliSegments(command: string): string[] {
  return command
    .split(SEGMENT_SPLIT)
    .filter((seg) => {
      const lead = segmentLead(seg);
      return lead != null && HARNESS_BIN_RE.test(basenameOf(lead));
    });
}

/** Is this a `harness-cli ... intake ...` invocation (as a real command)? */
export function isHarnessIntakeCall(command: string | undefined): boolean {
  if (!command) return false;
  return harnessCliSegments(command).some((seg) => /\bintake\b/.test(seg));
}

/** Is this a `harness-cli ... trace ...` invocation (the "done" step)? */
export function isHarnessTraceCall(command: string | undefined): boolean {
  if (!command) return false;
  return harnessCliSegments(command).some((seg) => /\btrace\b/.test(seg));
}

/**
 * Does this tool_call mutate files (Gate A narrow scope)?
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

// ─── readiness (P6: next-required-action) ──────────────────────────────────
//
// The gate decisions above answer "block this tool_call?". `readiness()`
// answers the parallel user-facing question: "what is the ONE thing blocking
// me right now?" It is the single source of truth that the footer (US-018),
// hint widget (US-019), install-notify (US-020), and injection (US-021)
// consume. Pure contract — NO pi types, NO filesystem (mirrors the gates).
//
// Priority (OQ-1, resolved in US-018): setup (cli→db) > intake > drift > trace.
// When everything is met, `ready` is true and `nextAction` is null (OQ-3: the
// footer renders "ready", quiet — no vanity counts).

/** Per-session fields `readiness()` reads. (Broader view of IntakeGateSession.) */
export interface ReadinessSession {
  intakeRecorded: boolean;
  traceRecorded: boolean;
}

/** Ordered readiness checklist. Each `true` = that precondition is met. */
export interface ReadinessChecklist {
  cli: boolean;
  db: boolean;
  intake: boolean;
  /** `true` when there is NO markdown↔durable drift. */
  drift: boolean;
  trace: boolean;
}

export type ReadinessStep = keyof ReadinessChecklist;

export interface ReadinessResult {
  checklist: ReadinessChecklist;
  /** First unmet step in priority order, or null when ready. */
  firstUnmet: ReadinessStep | null;
  /** Short footer line for the first unmet step, or null when ready. */
  nextAction: string | null;
  ready: boolean;
}

/** Ordered priority (OQ-1): setup → intake → drift → trace. */
const READINESS_ORDER: ReadinessStep[] = ["cli", "db", "intake", "drift", "trace"];

/** Short, footer-appropriate action text for each unmet step. */
function nextActionFor(step: ReadinessStep, driftCount: number): string {
  switch (step) {
    case "cli":
      return "no harness — run /harness to install";
    case "db":
      return "db missing — run harness-cli init + migrate";
    case "intake":
      return "record an intake before editing";
    case "drift":
      return `${driftCount} drift — sync markdown↔durable`;
    case "trace":
      return "record a trace when done";
  }
}

/**
 * Compute the next-required-action from repo + session + drift state.
 * Pure: no pi types, no fs. The footer/widget/notify/injection all derive
 * their text from this. `driftCount` is `drift.length` from detectDrift().
 */
export function readiness(
  state: GateState,
  session: ReadinessSession,
  driftCount: number
): ReadinessResult {
  const checklist: ReadinessChecklist = {
    cli: state.cliInstalled,
    db: state.dbInitialized,
    intake: session.intakeRecorded,
    drift: driftCount === 0,
    trace: session.traceRecorded,
  };
  const firstUnmet = READINESS_ORDER.find((s) => !checklist[s]) ?? null;
  const nextAction =
    firstUnmet === null ? null : nextActionFor(firstUnmet, driftCount);
  return { checklist, firstUnmet, nextAction, ready: firstUnmet === null };
}
