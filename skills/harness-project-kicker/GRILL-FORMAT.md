# GRILL-FORMAT — requirement-level interview reference

Loaded by the grill step of `harness-project-kicker`. This is **reference, not
steps**: consult the branch you need, ignore the rest. It is the requirement-
level analogue of `harness-intake-griller/INTAKE-FORMAT.md`, which does the
same job at slice granularity.

## Why this exists

A kickoff requirement is usually fuzzy: one sentence that actually contains
many features, or a goal stated as a mechanism. The umbrella intake, the
roadmap, and every slice inherit whatever understanding you reach here. If you
skip this and jump to decomposition, the umbrella summary is your guess and
the slices are a guess about a guess. Grill first.

## The interview branches

Walk these in order, but treat the order as a default, not a cage — if an
answer reshapes an earlier branch, go back. Resolve each branch before the
umbrella intake is recorded.

### 1. Shape — what landed on the table?

- Is this **one behaviour** or an **initiative** (a product area needing many
  stories)?
- If an initiative: roughly how many independent features / product areas are
  buried in it? Name them out loud.
- Is the requirement a **goal** ("offline works") or a **mechanism** ("add a
  service worker")? Goals decompose freely; mechanisms may already over-constrain.

**Done when:** you can say "this is N features" (or "one behaviour → redirect
to the griller, this is not a kicker job") and name each.

### 2. Core value / tracer-bullet

- What is the **thinnest end-to-end path** that, if it lands, proves the idea?
  (Detect → footer → test. Login → session → protected route.)
- What would a demo of just that path show?
- What is the **one** behaviour without which the initiative has no point?

**Done when:** a one-sentence tracer-bullet exists that a skeptic would agree
proves the core value.

### 3. Scope — in and out

- What is explicitly **in scope** for this initiative?
- What is **out of scope** (named, so it does not creep back in)?
- What is "phase 2" / "later" — deferred, not forgotten?

**Done when:** three lists exist and the user has confirmed the out-of-scope
list (that is the one most likely to be wrong).

### 4. Fuzz and ambiguity

- Which parts of the requirement are **vague**? ("nice UX", "fast", "secure",
  "like the other one")
- Which terms does the user use differently from `docs/GLOSSARY.md`?
- What **assumptions** are you about to make that you should surface as a
  question instead?

**Done when:** every fuzzy term is either sharpened to something checkable, or
recorded as an open question in the roadmap.

### 5. Risk surface — the 10 flags, anywhere

Go through the flag list. The question here is **coarser** than the griller's:
"does this flag touch the requirement **anywhere**?" — not "does it touch this
slice?" (that is the griller's job per slice). Mark any flag that appears
anywhere; it becomes an early lane signal and a thing to watch during
decomposition.

`Auth` · `Authorization` · `Data model` · `Audit/security` · `External systems`
· `Public contracts` · `Cross-platform` · `Existing behaviour` · `Weak proof`
· `Multi-domain`

Hard gates (auth, authorization, data loss/migration, audit/security, external
provider behaviour, removing validation) force the umbrella toward `high-risk`
unless the user narrows scope during this grill.

**Done when:** every flag is marked or explicitly cleared, with a one-line
reason for each that applies.

## The rules (same as the griller, raised one tier)

- **One question at a time.** Wait for an answer before the next.
- **Recommend, then confirm.** For every question, give your recommended
  answer based on what you already know about the repo, then let the user
  confirm or correct.
- **Explore before you ask.** If a question is answerable by reading the
  codebase or querying the durable layer, do that instead. Ground yourself:
  - `scripts/bin/harness-cli query matrix` — current proof status.
  - `scripts/bin/harness-cli query stats` and `query backlog` — live repo state.
  - `scripts/bin/harness-cli query tools --status present` — what validation is
    actually equipped (absent = clean skip).
  - `rg` the codebase and `docs/product/*` for the affected surface.
- **Record nothing per-feature here.** This phase produces **understanding**,
  not durable rows. The only durable row it produces is the single umbrella
  intake, and only after the grill completes.

## Sharpening heuristics

- **Turn goals into behaviours.** "Make it fast" → "p95 under 200ms on the
  cold-start path" (checkable) or an open question (deferred).
- **Turn mechanisms into goals, then let decomposition pick the mechanism.**
  "Add Redis" → "cache the expensive read" → maybe Redis, maybe not.
- **Surface the hidden feature count.** A sentence like "auth with SSO and
  roles and audit" is three features. Say so.
- **Stress-test each risk flag with a scenario.** For "Public contracts": does
  this change a shape a client relies on, or only an internal call site? For
  "Existing behaviour": is the test-covered path actually exercised, or dead
  code? The goal is to neither under- nor over-classify.
- **Borrow the griller's lane vocabulary.** "Small" is not a lane; `tiny` /
  `normal` / `high-risk` are. Translate the user's self-classification and
  defend it against the flag list.

## Output — a sharpened requirement

When the grill is done you hold:

```text
Shape:       initiative, ~N features (named)
Tracer-bullet: <one sentence>
In scope:    <list>
Out of scope:<list, user-confirmed>
Open questions: <list, deferred to roadmap>
Risk surface:<flags that touch anywhere, with a reason each>
Umbrella lane signal: <tiny | normal | high-risk, provisional>
```

**This** is what the next step turns into the one umbrella `new_initiative`
intake summary. Not the agent's first guess — the grill's verified output.

## What this phase does NOT do

- It does **not** decompose into slices (that is step 4, `KICK-FORMAT.md`).
- It does **not** record per-feature intakes (that is the monolithic-spec
  anti-pattern; each slice is intaken just-in-time by the griller).
- It does **not** choose the final lane for each slice (that is the griller's
  job, per slice, when it starts).
- It does **not** write the roadmap (that is step 3) — it only feeds it.
