// session.ts — per-cwd session state for the gates (DESIGN.md §9.2).
//
// The gates need a little mutable, per-cwd state that does NOT belong in the
// cached HarnessState (which mirrors on-disk repo state): whether an intake /
// trace has been recorded THIS session, plus the baselines to diff against.
//
// Seeding (DESIGN.md §9.2 + handoff enhancement):
//   - At session_start we snapshot the durable intake/trace counts as the
//     baseline, and we look at the newest intake timestamp. If an intake was
//     recorded within INTAKE_GRACE_MS, we treat the gate as already cleared —
//     this supports cross-session, same-day handoffs (e.g. intake recorded in
//     the previous session, implementation continues in this one) without
//     forcing a duplicate intake. Traces have NO grace window: the trace gate
//     is strictly "this session", because traces are per-task.

/** Grace window for the intake gate (cross-session handoff). 6 hours. */
export const INTAKE_GRACE_MS = 6 * 60 * 60 * 1000;

export interface SessionState {
  cwd: string;
  sessionStartedAt: number;
  baselineIntakeCount: number;
  baselineTraceCount: number;
  /** Cleared by: intake tool_result (exit 0), count increase, or grace window. */
  intakeRecorded: boolean;
  /** Cleared by: trace tool_result (exit 0) or count increase this session. */
  traceRecorded: boolean;
  /** Newest intake created_at (ms epoch) seen at seed time, or 0. */
  newestIntakeAt: number;
}

const sessions = new Map<string, SessionState>();

/** Get or create the session state for a cwd. */
export function getSession(cwd: string): SessionState {
  let s = sessions.get(cwd);
  if (!s) {
    s = {
      cwd,
      sessionStartedAt: Date.now(),
      baselineIntakeCount: 0,
      baselineTraceCount: 0,
      intakeRecorded: false,
      traceRecorded: false,
      newestIntakeAt: 0,
    };
    sessions.set(cwd, s);
  }
  return s;
}

/**
 * Seed the baselines + intake grace flag from durable counts.
 * Called once at session_start after detection.
 *
 * @param newestIntakeAtMs  timestamp (ms) of the most recent intake, or 0/now
 *   if intakes are empty. When within INTAKE_GRACE_MS of now, the intake gate
 *   starts cleared.
 */
export function seedSession(
  cwd: string,
  intakeCount: number,
  traceCount: number,
  newestIntakeAtMs: number
): SessionState {
  const s = getSession(cwd);
  s.sessionStartedAt = Date.now();
  s.baselineIntakeCount = intakeCount;
  s.baselineTraceCount = traceCount;
  s.newestIntakeAt = newestIntakeAtMs;
  s.traceRecorded = false;
  // grace window: an intake recorded within the window counts as "current work"
  const now = Date.now();
  s.intakeRecorded =
    newestIntakeAtMs > 0 && now - newestIntakeAtMs < INTAKE_GRACE_MS;
  return s;
}

/** Re-evaluate the gates against fresh durable counts (call each before_agent_start). */
export function refreshFromCounts(
  cwd: string,
  intakeCount: number,
  traceCount: number
): SessionState {
  const s = getSession(cwd);
  if (intakeCount > s.baselineIntakeCount) s.intakeRecorded = true;
  if (traceCount > s.baselineTraceCount) s.traceRecorded = true;
  return s;
}

/** Drop a session entry (test/diagnostic hook). */
export function clearSession(cwd?: string): void {
  if (cwd) sessions.delete(cwd);
  else sessions.clear();
}
