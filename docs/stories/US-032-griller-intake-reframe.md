# US-032 — Reframe griller intake: sketch → auto-classify → escalate genuine forks + disambiguate grill/kicker

## Status

implemented

## Lane

normal

## Product Contract

The `harness-intake-griller` skill must make four behaviors true:

1. **Behavior-sketch first.** Before any classification, the griller states a
   concrete behavior sketch of the slice — **tracer-bullet sentence + demo
   behavior + in/out scope** — **deriving it from the kicker's one-line
   contract when the slice has one** (do not redo the requirement-level grill;
   ADR-0012 grill-vs-record guard). For ad-hoc slices, elicit it. If the sketch
   is unambiguous, proceed without a confirm-round; if ambiguous, that
   ambiguity is the first genuine fork. The sketch becomes the story's
   one-line contract. The operator decides on *substance*, not classification
   vocabulary.

2. **Auto-classify mechanical fields.** From the sketch + live repo state
   (`query matrix`, `query stats`, `query backlog`, `rg` the codebase), the
   griller derives input type, lane, and the 10 risk flags **itself** and
   presents them as **one recommendation with a one-line reason per flag** —
   **not** as a sequential one-question-per-branch interrogation. This aligns
   the skill with `FEATURE_INTAKE.md`'s principle: *"The human does not need to
   classify risk. The harness does."*

3. **Escalate only genuine human-forks.** A question is asked iff **all three**
   hold: **not derivable** from repo state, **not in the sketch**, and
   **material** (changes type/lane/flags, story shape, or validation).
   Immaterial questions are deferred to implementation. Target: ~1–2 genuine
   forks per slice; zero is normal.

4. **Record by default; block only on forks.** Recording is the default action
   — if no classification-affecting fork was found, present the recommendation
   **and record in the same turn** (fix-rather-than-confirm, the
   `git commit --amend` model). Block only to resolve a genuine fork. This is
   the rule that keeps automatic things automatic — it must not convert
   classification into a new manual confirm-gate.

5. **Disambiguate grill/kicker naming (resolved: option d).** "grill" stays the
   griller's verb; "sharpen" names the kicker's requirement-level phase. Both
   skills carry a one-line "Which skill?" cross-ref header, and
   `docs/GLOSSARY.md` codifies the distinction (see Design Notes).

**Invariant.** **"Grilled" = a `spec_slice` intake is linked to the story.**
This story changes the *procedure* (sketch → auto-classify → forks), not that
durable signal. The dashboard grilled-badge (US-023), the detail-pane `next:`
router, and drift Gate B′ all key on it — kept intact.

This reframes and supersedes backlog #11 (over-asks on mechanical
classification + grill/kicker naming confusion) and #13 (no behavior-sketch
step before forks). #13's behavior-sketch is the *enabler* for #11's
auto-classify/escalate goal — once the slice's behavior is stated, input type,
lane, and flags become largely derivable, leaving only genuine forks for the
human. That is why they merge into one story rather than two colliding ones.

## Relevant Product Docs

- `skills/harness-intake-griller/SKILL.md` — rewritten (intake loop: sketch →
  auto-classify → fork-check → record-by-default; 3-part genuine-fork test;
  grilled invariant; "Which skill?" header)
- `skills/harness-intake-griller/INTAKE-FORMAT.md` — updated (new "How the
  griller applies this" section; flags as a recommended set, not walked;
  record-by-default + fork-log)
- `skills/harness-project-kicker/SKILL.md` — "Which skill?" cross-ref header
  added (reverse direction); no other change
- `docs/GLOSSARY.md` — new `Grill` + `Sharpen` terms (the option-d
  disambiguation)
- `docs/FEATURE_INTAKE.md` — **unchanged** (classification rules are
  out-of-scope; only the *procedure* changed)
- `docs/decisions/0012-kicker-grills-requirement-before-intake.md` —
  **unchanged** (option d keeps the kicker's "grill" wording; no new ADR — the
  naming decision fails the ADR "hard to reverse" bar, recorded here instead)

## Acceptance Criteria

- SKILL.md's intake loop **leads with a behavior-sketch step** (§1) that
  precedes auto-classify (§2), with its own completion criterion.
- A **3-part "genuine fork" test** is defined (not derivable + not in sketch +
  material) with concrete examples (genuine / derivable / immaterial).
- The 10 risk flags are **auto-derived and presented as one recommendation**
  (one-line reason per flag), not walked one-question-at-a-time.
- **Record-by-default**: the skill states that recording is the default action
  and blocks only on classification-affecting forks (fix-rather-than-confirm,
  not gate-on-confirm).
- **Grilled invariant** is stated: `grilled` = a `spec_slice` intake linked to
  the story; procedure changed, signal did not.
- `FEATURE_INTAKE.md`'s classification rules are **unchanged** (git: clean).
- `INTAKE-FORMAT.md` matches the new flow (sketch-first; flags as a recommended
  set; record-by-default).
- **Naming resolved (option d)**: both skills carry a "Which skill?" cross-ref
  header; `docs/GLOSSARY.md` has `Grill` + `Sharpen` terms. No rename, no ADR.
- Internal `.md` cross-ref links resolve on both skills.
- Structural self-audit (below) passes.

## Design Notes

- **#13 enables #11.** The behavior-sketch (#13) is what makes
   auto-classification (#11) possible: once the slice's behavior is stated,
   input type + lane + flags are largely derivable from repo state. This is the
   structural reason they merge.
- **Why normal, not tiny.** Touches a shipped skill's behavior (Existing
  behaviour flag) with no automated test coverage (Weak proof flag) → 2 flags
  → normal with stronger validation. Not high-risk: no hard gate, no
  classification-rule change, no data/auth surface.
- **Naming decision (resolved → option d, not the packet's original lean (a)).**
  Keep both names; codify the distinction. Reason: US-023 + `dashboard.ts`
  define `grilled` = *"a `spec_slice` intake linked to the story"* — the act of
  grilling *is* recording that intake. Renaming the griller (b) would break
  that vocabulary; renaming the kicker's grill→sharpen (a) is high-churn
  (ADR-0012 title, `GRILL-FORMAT.md` filename, US-007/8/9/013 refs) for low
  gain. Option (d) — a `Grill`/`Sharpen` GLOSSARY pair + a one-line cross-ref
  header on each skill — fixes the *conceptual* confusion (the real problem)
  with zero churn and preserves the US-023 signal. No ADR: the decision is
  easily reversible (docs edit), failing the "hard to reverse" bar; recorded
  here instead.
- **D3 refinement (record-by-default).** The packet's original "present for
  confirmation" risked becoming a new manual gate — contradicting the reframe's
  own principle. Resolved: record is the default; block only on genuine forks
  (fix-rather-than-confirm). This is the crux of "don't convert automatic into
  manual."
- **D7 kicker guard.** Slice sketch ≠ requirement sketch. When a slice comes
  from a kicked initiative, derive the sketch from the kicker's one-line
  contract; do not redo the requirement grill (stated in SKILL.md §1).
- **Fork log (optional).** Resolved genuine forks are captured in the intake's
  `--notes`, building a decision-pattern library over time. Low-cost because
  the intake is recorded anyway.
- **Scope guard.** The classification *rules* (flags, lanes, hard gates,
  thresholds) are unchanged — `HARNESS.md` puts rule changes behind human
  confirmation. This story changes the *procedure* only.
- **Dogfood integrity.** This packet was shaped by applying the reframe's
  spirit: relevance was verified by exploring repo state (read both skills,
  grepped for the absent `genuine fork` / `behavior sketch` / `auto-classify`
  concepts, checked ADR-0012 + US-023's grilled-badge definition) rather than
  asking one-question-per-branch, and only the genuine forks (the 4 design
  decisions) were escalated — resolved in one round each.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-032 --unit 0 --integration 1 --e2e 0 --platform 0`.

| Layer | Expected proof |
| --- | --- |
| Unit | None — markdown skill, no compiled assertions. |
| Integration | Structural self-audit (deterministic, no LLM): (a) sketch §1 precedes auto-classify §2; (b) 3-part genuine-fork test + examples present; (c) flags as one recommendation, not walked; (d) record-by-default stated; (e) grilled invariant stated; (f) `FEATURE_INTAKE.md` unchanged (git clean); (g) `INTAKE-FORMAT.md` matches; (h) "Which skill?" header on both skills + GLOSSARY `Grill`/`Sharpen`; (i) internal `.md` links resolve. |
| E2E | Deferred — the real validation is the next genuine fuzzy slice grill (caveat inherited from US-013 / ADR-0010). Not faked. |
| Platform | n/a |
| Release | n/a |

## Harness Delta

- New griller policy: "sketch the slice → auto-classify → fork-check → record
  by default (block only on genuine forks)" — replaces "walk 6 branches
  one-question-at-a-time."
- New `Grill` / `Sharpen` GLOSSARY terms + "Which skill?" cross-ref headers on
  both skills (option-d naming disambiguation; no rename, no ADR).
- Stated invariant: `grilled` = `spec_slice` intake linked to the story
  (procedure changed, durable signal unchanged — protects US-023 / Gate B′).
- Supersedes backlog #11 + #13 (closed as implemented, outcomes point here via
  backlog #15).

## Evidence

Structural self-audit — all pass (deterministic, no LLM):

- (a) `### 1. Sketch the slice` (L20) precedes `### 2. Auto-classify` (L40) →
  `### 3. Fork check` (L80) → `### 4. Record by default` (L103) in
  `skills/harness-intake-griller/SKILL.md`.
- (b) 3-part test present (Not derivable / Not in the sketch / Material) with 3
  examples (genuine / derivable / immaterial); "genuine fork" mentioned 7×.
- (c) "do not walk … one-question-per-branch interrogation" present; flags
  presented as one recommendation with a one-line reason per flag.
- (d) "Recording is the default. Do not block on a confirm-round." present
  (§4); fix-rather-than-confirm stated.
- (e) grilled invariant (§"Invariant"): `grilled` = `spec_slice` intake linked.
- (f) `docs/FEATURE_INTAKE.md` — git status clean (unchanged).
- (g) `INTAKE-FORMAT.md` — "How the griller applies this" section + flags as
  recommended set + record-by-default + fork-log + invariant all present.
- (h) "Which skill?" header on both `harness-intake-griller/SKILL.md` and
  `harness-project-kicker/SKILL.md`; `docs/GLOSSARY.md` has `## Grill` (L27) +
  `## Sharpen` (L35).
- (i) internal `.md` cross-ref links resolve on both skills (verified).

Change set (git): `docs/GLOSSARY.md`, `skills/harness-intake-griller/{SKILL,INTAKE-FORMAT}.md`,
`skills/harness-project-kicker/SKILL.md` modified; this packet new. All four
markdown files pass markdownlint clean (auto-fixed on write).

E2E deferred: a markdown skill's behaviour cannot be proven by an automated
run, only by the next genuine fuzzy slice grill (caveat inherited from
US-013 / ADR-0010). The structural audit is the strongest deterministic proof
available. Intake #41; backlog #15 (closed with outcome); supersedes #11 + #13.
