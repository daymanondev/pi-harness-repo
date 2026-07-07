# Initiative: P6 — status surfaces show NEXT ACTION, not vanity counts

- **Umbrella intake:** #23 (new_initiative, lane normal)
- **Status:** M1–M4 implemented — US-018 (footer + `readiness()`), US-019 (hint widget), US-020 (install-notify), US-021 (injection). Residual: the `before_agent_start` trigger cannot distinguish chat turns from editing turns, so the trace/intake nags still fire on chat when a session owes them — see US-022 (Option C).
- **Touching:** P1 footer/widget surfaces + P2 gate *communication* (not logic)
- **Closes:** the "Gate A seems ineffective" confusion + the "footer counts are junk" complaint

> This is a **roadmap** — a map of milestones, not a to-do list. It names the
> product areas and hard constraints; the tracer-bullet slices (US-NNN) and
> their acceptance criteria live in the per-story packets, produced by the
> kicker's step 5. See ADR-0010 for the workflow model.

## Goal

The harness's always-on status surfaces — the **footer**, the **hint widget**,
the **install-notify**, and the **injection message** — currently show vanity
counts (`17 stories · 38 traces · 6 backlog`) or go silent at the wrong moment.
This initiative re-points all four at a single question the user actually has:
**"what is the one thing blocking me right now?"** When nothing blocks, the
surfaces go quiet. The story/trace/backlog counts relocate to the dashboard
Stats tab where they belong.

This dissolves two reported problems at once:

1. After `init`, the intake requirement is invisible until the first edit is
   blocked → "the gate seems ineffective" (it isn't; it was silent).
2. Footer counts are noise with no actionable signal → "junk".

## Hard constraints

- **Gate logic is frozen.** `decideGateA` / `gatePrecondition` / `gateIntake`
  stay **byte-identical**. This initiative changes *presentation and
  sequencing of messages*, never the block/pass decision. Existing `p2` gate
  tests must stay green untouched.
- **One source of truth.** A single pure helper `readiness(state, session)`
  (mirrors the purity contract of `gates.ts` — no pi types, no fs) computes the
  ordered checklist + the single next-required-action. All four surfaces
  consume it, so they can never disagree.
- **Counts are relocated, not deleted.** Story/trace/backlog numbers move to
  the dashboard Stats tab (US-011, already shipped). The footer stops carrying
  them.

## Milestones

1. **Footer → next-action** (tracer-bullet). The footer stops rendering counts
   and instead renders the one next-required-action derived from
   `readiness()`, or `ready` when clear. **This milestone also delivers
   `readiness()` itself** — it is the shared contract every later milestone
   consumes.

2. **Hint widget → persistent coach.** `hintLines` stops returning `undefined`
   (vanishing) once the DB is ready. It becomes a persistent below-editor
   "next step" line, sourced from `readiness()`.

3. **Install-notify handoff.** On successful install, instead of
   `"installed — footer is live ✓"`, the notify hands off to the *next*
   requirement ("DB ready — next: record an intake before editing"), closing
   the exact transition that caused the original confusion.

4. **Injection de-noise.** The `before_agent_start` injection stops leading
   with vanity counts; it leads with the next-required-action (and keeps only
   the actionable nags). This is the surface the agent itself reads.

## Open questions (deferred to slice design)

- **OQ-1 — Blocker priority.** When several preconditions are unmet at once
  (e.g. no intake *and* drift *and* no trace), which one surfaces first?
  Provisional order: `setup (no cli/db) → intake → drift → trace`. Confirm at
  the footer slice.
- **OQ-2 — Injection ownership.** Once the footer owns "next action", does the
  injection still emit its own next-action line, stay quiet, or keep only the
  trace nag? Decide at the injection slice.
- **OQ-3 — "ready" rendering.** Empty footer, `🪢 ready`, or a version string?
  Minor; decide at the footer slice.

## Exit criteria

- All four surfaces derive their text from `readiness()` (no surface computes
  its own status string independently).
- No surface except the dashboard shows story/trace/backlog counts.
- After a fresh `init` with no intake, the next action (record an intake) is
  visible in **both** the footer and the install-notify.
- `decideGateA` is byte-identical to pre-initiative (verified by `p2` tests
  green without modification).
- Regression tests pin: `harness-cli init`/`migrate` does **not** clear
  `intakeRecorded`; the footer shows a blocker line when `intakeRecorded`
  is false post-install.
