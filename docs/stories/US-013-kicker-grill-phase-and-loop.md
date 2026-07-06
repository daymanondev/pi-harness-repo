# US-013 — Kicker grills the requirement before umbrella intake + drives the per-slice loop

## Status

implemented

## Lane

normal

## Product Contract

The `harness-project-kicker` skill must make two behaviors true:

1. **Grill before umbrella.** Before recording the `new_initiative` intake, the
   kicker runs a relentless requirement-level interview (one question at a time,
   recommend-then-confirm) that resolves scope, feature count, the core
   value / tracer-bullet, ambiguity, and which of the 10 risk flags touch the
   requirement anywhere. The umbrella intake summary that gets recorded is
   therefore *verified*, not the agent's unverified guess.
2. **Drive the per-slice loop.** Step 5 no longer hands only slice 1 to the
   griller and stops. It sets up and describes the driven loop explicitly:
   each slice → `harness-intake-griller` (intake `spec_slice` + packet) →
   execute → trace → next slice. The kicker may intake the first 1–2 tracer-
   bullet slices at kickoff to validate the decomposition; the rest stay
   just-in-time (per ADR-0010 — **not** "intake everything upfront").

This closes the root gap that produced the original monolithic
`pi-harness-design/DESIGN.md`: a fuzzy kickoff requirement was never grilled
before decomposition.

## Relevant Product Docs

- `skills/harness-project-kicker/SKILL.md` — rewritten (add grill phase as step 2; renumber umbrella to step 3; drive loop as step 6)
- `skills/harness-project-kicker/GRILL-FORMAT.md` — NEW companion (parallel to `harness-intake-griller/INTAKE-FORMAT.md`)
- `skills/harness-project-kicker/KICK-FORMAT.md` — unchanged (decomposition heuristics for step 4 still hold)
- `docs/decisions/0012-kicker-grills-requirement-before-intake.md` — NEW, partially supersedes 0010
- `docs/decisions/0010-initiative-slices-workflow-model.md` — referenced / partially superseded (kept for historical context)

## Acceptance Criteria

- SKILL.md has a dedicated **grill-requirement** step that runs *before* the
  "record the umbrella intake" step, with its own completion criterion.
- The grill step references `GRILL-FORMAT.md` (progressive disclosure), and that
  file exists and covers: the requirement-level interview branches, the
  recommend-then-confirm rule, and the "sharpen fuzzy scope" heuristic.
- The umbrella-intake step's summary is sourced from the grill output, not the
  agent's first guess.
- Step 6 (the final step) describes the driven per-slice loop (slice → griller
  → intake `spec_slice` → packet → execute → trace → next) and explicitly
  permits intaking 1–2 tracer-bullet slices at kickoff while deferring the rest
  just-in-time — it does **not** hand off slice 1 and vanish.
- The "leading word" framing is corrected: at kickoff the leading word is the
  **requirement** (understand first), not the **slice** (slice comes after
  understanding).
- Decision 0012 exists, carries Status/Context/Decision/Consequences, links
  0010 as partially superseded, and is added as a durable row.
- The worked example is updated so the input is *fuzzy* (not the clean
  "offline mode" contrivance that masked the gap).

## Design Notes

- **Why not `new_initiative`:** this is a bounded improvement to one existing
  skill (intake #16 = `harness_improvement`), not a new product area.
  Decomposition into slices is a kicker concern for initiatives; this story is
  itself one slice that passes the KICK-FORMAT size test 3/3.
- **Why not update 0010 in place:** 0010 records the historical context that
  produced the DESIGN.md monolith. A 0012 partial-supersede preserves that
  context while recording the model extension (grill phase).
- **Dogfood integrity:** this very story was shaped by running
  `harness-intake-griller` on the fix request — the same interviewing style the
  fixed kicker will require at the requirement level.
- **Scope guard:** the grill phase must NOT become "intake every feature
  upfront." That is the monolithic-spec anti-pattern ADR-0010 rejects. The grill
  *understands*; the per-slice griller *records*, just-in-time.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-013 --unit 0 --integration 1 --e2e 0 --platform 0`.

| Layer | Expected proof |
| --- | --- |
| Unit | None — markdown skill, no compiled assertions. (Optional: frontmatter parse + internal `.md` link resolution if a cheap check is added.) |
| Integration | Structural self-audit (deterministic, no LLM): assert (a) a grill-requirement step precedes the umbrella-intake step in SKILL.md; (b) step 5 names the per-slice loop and the just-in-time rule; (c) GRILL-FORMAT.md exists; (d) 0012 exists and links 0010; (e) the worked example uses a fuzzy input. |
| E2E | Deferred — the real validation is the next genuine project kickoff (honest caveat inherited from US-009 / ADR-0010). Not faked. |
| Platform | n/a |
| Release | n/a |

## Harness Delta

- New policy: "a kicker grills the requirement before recording the umbrella
  intake" — recorded as decision 0012 (partial supersede of 0010).
- New skill companion: `GRILL-FORMAT.md`, establishing the progressive-
  disclosure pattern (SKILL = steps; GRILL-FORMAT = requirement-interview
  reference; KICK-FORMAT = decomposition reference).
- Correction to the kicker's "leading word": requirement, not slice.

## Evidence

Structural self-audit — 17/17 pass (deterministic, no LLM):

- (a) grill step `### 2. Grill the requirement` (L60) precedes umbrella step
  `### 3. Record the umbrella intake` (L87).
- (b) step 6 `### 6. Sequence and drive the per-slice loop` names the full loop
  (slice N → griller → execute → trace → slice N+1), states the just-in-time
  rule, and rejects the monolithic-spec anti-pattern.
- (c) `GRILL-FORMAT.md` exists and is loaded by step 2; `KICK-FORMAT.md`
  unchanged.
- (d) decision `0012` exists, links `0010` as partial-supersede, and has a
  durable row (`query decisions`).
- (e) worked example input is marked fuzzy.
- (f) leading word is `requirement` (no stale `slice` heading).
- (g) grill-vs-record guard section present (scope discipline).

One first-run false-negative (b2 regex expected a single-line loop; the loop
is a multi-line block) was corrected — content was right, assertion was wrong.

E2E deferred: a markdown skill's behaviour cannot be proven by an automated
run, only by the next genuine fuzzy kickoff (caveat inherited from US-009 /
ADR-0010). The structural audit is the strongest deterministic proof available.
