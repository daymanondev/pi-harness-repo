# KICK-FORMAT — decomposition heuristics

Loaded by step 5 of `harness-project-kicker`. This is **reference**, not steps:
consult the rule you need, ignore the rest.

## What a slice is

A slice is a **tracer-bullet vertical cut**: one thin path that travels
end-to-end through every layer the final feature touches — schema, API, UI,
tests, docs — and is demoable on its own when complete. Borrowed from
mattpocock `to-issues`.

A slice is **not** a horizontal slab. These are anti-patterns (reject them):

- "the schema" alone
- "the API layer" alone
- "the UI" alone
- "set up the tooling" with no behavior attached

Each of those is a layer, not a slice. A slice cuts *through* the layers.

## The size test

A slice passes when **all three** hold:

1. **Demoable alone** — completing it shows a real behavior, not scaffolding.
2. **Within the lane budget** — its harness context fits the lane's token budget
   from `CONTEXT_RULES.md` (Normal ≈ 5K). If a slice would blow the budget, it
   is two slices.
3. **One contract** — it can be stated in a single end-to-end sentence. If you
   need "and also…" to describe it, split.

## The slice contract

One line, end-to-end behavior, no file paths:

> *US-NNN — when the agent starts in a harness repo with no intake, it shows a
> detect footer and a one-line hint (no blocking).*

Prefer the behavior over the mechanism. File paths and code go stale; behavior
does not.

## Dependency handling

Record a `blocked-by` only when slice B genuinely cannot start without slice A
landing first (shared schema, shared type, shared contract). Do **not** add a
dependency just because B feels like it should come after A — sequence that in
step 6 instead.

Avoid cycles. If two slices seem mutually dependent, they are probably one
slice.

## Linking slices to the initiative intake

Every slice the kicker creates **must** be linked to its umbrella
`new_initiative` intake via the `parent_intake_id` column (migration 009). This
is the durable slice→initiative link the dashboard groups on — without it, a
slice is an orphan with no visible initiative.

The prebuilt CLI has no flag for `parent_intake_id` (ADR-0005), so set it with
`query sql` immediately after `story add`:

```
harness-cli story add --id US-NNN --title "<slice contract>" --lane <lane>
harness-cli query sql "UPDATE story SET parent_intake_id=<INTAKE_ID> WHERE id='US-NNN'"
```

Verify the linkage:

```
harness-cli query sql "SELECT id, parent_intake_id FROM story WHERE parent_intake_id=<INTAKE_ID> ORDER BY id"
```

## The quiz (step 5)

Put the proposed list in front of the user and ask exactly three questions:

- **Granularity** — too coarse, too fine, or right?
- **Dependencies** — are the `blocked-by` edges correct?
- **Merge/split** — should any slices be combined or split further?

Iterate until the user approves. Do not skip the quiz — it is the defence
against oversized slices, which is the whole point of this skill.

## Worked example (the shape a run produces)

Input (deliberately **fuzzy**, the kind that exposes the gap): *"I want the pi
agent to really know about repository-harness — detect it, install it, show me
what's going on, maybe a timeline, all behind one command."*

- **Step 1** — this is a product area, not one behaviour → continue. Obvious
  risk flags: none at a glance (revisit in step 2).
- **Step 2** — sharpen (`SHARPEN-FORMAT.md`):
  - Shape: ~4 independent areas — detection, install, visualization, timeline.
  - Tracer-bullet: detect installed harness at session_start, show a footer
    (detect → footer → test).
  - Scope: in = detect/install/visualize; out = authoring harness policy,
    mobile shell. Timeline = phase 2.
  - Fuzz: "really know" → session-aware live state; "what's going on" →
    matrix/stats/backlog; "maybe timeline" → optional, deferred.
  - Risk surface: touches durable-layer reads (no writes) — no hard gate.
- **Step 3** — one intake, summary sourced from the sharpen:
  `intake --type new_initiative --lane normal --summary "Four-area initiative:
  detect, install, visualize, timeline… tracer-bullet = detect+footer…"` → #N.
- **Step 4** — initiative notes name milestones only: *detect*, *install
  wizard*, *dashboard*, *timeline (phase 2)*. Open question: installer source
  pinning.
- **Step 5** — slices (one-line contracts, from the size test above); quiz the
  user → approve.
- **Step 6** — N `planned` stories, each linked to intake #N via
  `parent_intake_id`; the loop is described; the first tracer-bullet (detect+
  footer) is handed off to be classified + implemented. **Stop. No code written
  by the kicker.**

The real validation is the next genuine initiative kickoff — this example only
fixes the expected shape.
