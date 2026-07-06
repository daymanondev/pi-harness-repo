# KICK-FORMAT — decomposition heuristics

Loaded by step 4 of `harness-project-kicker`. This is **reference**, not steps:
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
step 5 instead.

Avoid cycles. If two slices seem mutually dependent, they are probably one
slice.

## The quiz (step 4)

Put the proposed list in front of the user and ask exactly three questions:

- **Granularity** — too coarse, too fine, or right?
- **Dependencies** — are the `blocked-by` edges correct?
- **Merge/split** — should any slices be combined or split further?

Iterate until the user approves. Do not skip the quiz — it is the defence
against oversized slices, which is the whole point of this skill.
