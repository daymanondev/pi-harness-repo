---
name: harness-intake-griller
description: Slice-level intake classifier — sketch the slice's behavior, auto-classify (input type, risk flags, lane, story shape, validation) from the sketch + live repo state, escalate only genuine human-forks, and record durable intake/story rows inline. Use before implementing a slice, before recording a harness intake, or whenever a feature request needs shaping into safe, classified work.
---

> **Which skill?** This is the **slice-level** classifier: it turns *one*
> story-sized slice into a classified, recorded intake. For **requirement-level**
> understanding — shaping a whole new initiative *before* any slice exists — use
> [`harness-project-kicker`](../harness-project-kicker/SKILL.md). Per
> `docs/GLOSSARY.md`: **grill** = classify + record a slice (produces a
> `spec_slice` intake, the dashboard "grilled" signal); **sharpen** = understand
> a requirement (kicker-only, no durable row).

<what-to-do>

Turn the user's slice into a classified, recorded intake with the **minimum
human ceremony**. The harness classifies risk — the human supplies substance
and resolves only genuine forks. Run this loop:

### 1. Sketch the slice (substance first)

State a concrete behavior sketch of the slice:

- **Tracer-bullet** — the thinnest end-to-end path this slice delivers (one
  sentence), and the demo it would show.
- **In / out of scope** — one line each.

**Derive, don't re-ask.** If the slice came from `harness-project-kicker`, a
one-line contract already exists — derive the sketch from it and do **not** redo
the requirement-level grill (that already happened at the kicker, per
ADR-0012; the grill-vs-record guard applies). If the slice is ad-hoc (no kicker
parent), elicit the sketch from the user.

The sketch is the **one substantive human input** that seeds everything
automatic. If it is unambiguous, proceed without a confirm-round. If it is
genuinely ambiguous, that ambiguity is your **first genuine fork** (step 3) —
raise it there, not now. The sketch also becomes the story's **one-line
contract** (mirrors `harness-project-kicker/KICK-FORMAT.md`).

### 2. Auto-classify (the harness does this, not the human)

From the sketch + live repo state, **derive** the whole classification yourself
and present it as **one recommendation**. Do **not** walk the branches as a
one-question-per-branch interrogation — that is the ceremony this skill
replaces, and it contradicts `docs/FEATURE_INTAKE.md`'s principle: *"The human
does not need to classify risk. The harness does."*

Derive, in one pass:

- **Input type** — `spec_slice` (slice of an accepted initiative) |
  `change_request` (bounded behavior change) | `maintenance_request`
  (dep/ops/data-model) | `harness_improvement` (process/skill/docs) | `new_spec`
  | `new_initiative` (→ redirect to `harness-project-kicker`; this skill is
  slice-level).
- **Risk flags** — scan the sketch's end-to-end path against all 10 flags;
  `rg` the codebase + `docs/product/*` to test each (does it touch auth files?
  schema? an external SDK? a shipped behavior?).
- **Lane** — from flag count + hard gates (the `FEATURE_INTAKE.md` rule).
- **Story shape** — packet (`docs/templates/story.md`) for normal/high-risk;
  direct patch for tiny.
- **Validation** — derive from lane + equipped tools
  (`harness-cli query tools --status present`; absent = clean skip, never a
  blocker).

Ground every claim in live state before stating it:

- `scripts/bin/harness-cli query matrix` — current proof status.
- `scripts/bin/harness-cli query stats` and `query backlog` — live repo state.
- `rg` the codebase and `docs/product/*` — the affected surface.

Present the recommendation with a **one-line reason per flag that applies**
(and explicitly note cleared hard gates), e.g.:

```text
Flags:      Existing behaviour (griller skill is shipped), Weak proof (no tests — rg tests/ empty)
Hard gates: none
Lane:       normal   Shape: packet   Validation: structural self-audit
```

### 3. Fork check — escalate only genuine human-forks

A question is a **genuine fork** iff **all three** are true:

1. **Not derivable** — you grepped/queried and the answer is not in repo state.
2. **Not in the sketch** — the operator has not already stated it.
3. **Material** — the answer changes the classification (type/lane/flags), the
   story shape, or the validation. If it changes none, it is noise — defer it
   to implementation; do not ask during intake.

Examples (the skill's job is to tell these apart):

- **Genuine fork** — "The slice says 'add a role check to /admin' but I can't
  tell from the code whether /admin already has session middleware." → material
  (Auth hard gate → high-risk), not derivable. **Ask.**
- **Not a fork (derivable)** — "Are there tests for this?" → `query matrix` /
  `rg tests`. Derive it and state "Weak proof flag applies." **Don't ask.**
- **Not a fork (immaterial)** — "What should the function be named?" → changes
  no classification/shape. **Don't ask during intake.**

Target: ~1–2 genuine forks per slice. Finding zero is normal and good — record
and proceed.

### 4. Record by default; block only on forks

**Recording is the default. Do not block on a confirm-round.** This is the rule
that keeps automatic things automatic — do not convert classification into a
new manual gate.

- If step 3 found **forks that affect classification/shape**: resolve them
  first (one focused question each), re-derive the classification, then record.
- If step 3 found **no classification-affecting forks**: present the
  recommendation **and record in the same turn**. The user sees it and can say
  "correct" — fix-rather-than-confirm (the `git commit --amend` model), not
  gate-on-confirm.

Record the intake inline (never batched):

```bash
scripts/bin/harness-cli intake --type <type> --lane <lane> \
  --summary "<one-line, ≥10 chars>" \
  --flags "<comma-separated flags>" --docs "<paths>" --story <US-NNN> \
  --notes "<any genuine forks resolved + why>"
```

For `normal`/`high-risk`, immediately add the story row and write the packet
from `docs/templates/story.md` (or `docs/templates/high-risk-story/`):

```bash
scripts/bin/harness-cli story add --id <US-NNN> --title "<one-line contract>" --lane <lane>
```

**Fork log (optional, low-cost).** If you resolved genuine forks, capture them
and the chosen resolution in `--notes`. Over time this builds a decision-pattern
library that sharpens future auto-classification.

### Invariant — what "grilled" means

**"Grilled" = a `spec_slice` intake is linked to the story.** This procedure
changes *how* you get there (sketch → auto-classify → forks), not the durable
signal. The dashboard grilled-badge (US-023), the detail-pane `next:` router,
and drift Gate B′ all key on that signal — keep it intact. The act of grilling
*is* recording the `spec_slice` intake.

</what-to-do>

<supporting-info>

## Domain awareness

This skill is for repos that already have `repository-harness` installed.
Detect it the same way the pi-harness extension does:

```
scripts/bin/harness-cli --version        # CLI present?
harness.db                                # durable layer initialised?
<!-- HARNESS:BEGIN --> in AGENTS.md      # shim present?
```

If any of those is missing, stop and tell the user to run `/harness` (or
`harness-cli init`) first — grilling an unmeasured repo produces
classifications that nothing will enforce.

### Harness file structure (the intake map)

```
/
├── AGENTS.md                      # stable agent shim — read first
├── docs/
│   ├── FEATURE_INTAKE.md          # THIS skill's source of truth (rules)
│   ├── GLOSSARY.md                # canonical vocabulary (grill vs sharpen)
│   ├── ARCHITECTURE.md            # boundary + layering rules
│   ├── TEST_MATRIX.md             # behaviour → proof control panel
│   ├── product/                   # current product contract
│   ├── stories/                   # story packets + history
│   ├── decisions/                 # durable decision records (NNNN-slug.md)
│   └── templates/                 # story / decision / validation templates
├── scripts/bin/harness-cli        # durable-layer operator
└── harness.db                     # operational state (gitignored)
```

`docs/FEATURE_INTAKE.md` is authoritative for input types, lanes, the 10 risk
flags, and the 6 hard gates — the *rules*. This skill is authoritative for the
*procedure* used to apply them (sketch → auto-classify → forks). When the two
disagree, surface it as friction (`harness-cli backlog add`) and defer to
FEATURE_INTAKE for the rules.

## During the session

### Challenge against the lane vocabulary

The harness has a strict vocabulary. When the user says "it's a small change"
or "just a quick fix," do not accept the self-classification — translate it
into the harness vocabulary and check the risk checklist. "Small" is not a
lane; `tiny` / `normal` / `high-risk` are. "Quick" describes duration, not
risk. You still *defend* the derived lane against the flag list — you just do
the deriving yourself and present the result, rather than interrogating the
user flag-by-flag.

If the work touches any **hard gate** (auth, authorization, data loss/migration,
audit/security, external provider behaviour, removing validation), the lane is
**high-risk** unless the user explicitly narrows scope. No exceptions.

### Sharpen fuzzy classification

When the user describes the work vaguely, propose the precise intake type and
lane, with reasoning. Examples:

- "Add a field to the user profile" → is this `change_request` (bounded
  behaviour change) or `maintenance_request` (data-model change)? If it needs a
  migration, it hits the Data model risk flag and probably the hard gate.
- "Refactor the auth code" → touches a hard gate. `high-risk`,
  `change_request`, and a durable decision record is required if behaviour or
  boundary changes.

### Stress-test flags with concrete scenarios

During auto-classify (step 2), for each flag you mark, invent a concrete
scenario that probes whether it truly applies or is overstated. For "Public
contracts": "Does this change the HTTP response shape a client relies on, or
only an internal call site?" For "Existing behaviour": "Is the test-covered
path actually exercised in production, or dead code?" The one-line reason per
flag (step 2's output) is where this stress-test lands.

The goal is to neither under-classify (skip a real flag → wrong lane → missed
proof) nor over-classify (flag everything → everything becomes high-risk → the
lane system loses meaning).

### Ground every claim in live durable state

Before stating a flag or lane, read the actual repo state. A claim like "there
are no tests around this area" is testable: `query matrix` for the story's
proof row, `rg` the test directory. If proof is weak, the **Weak proof** flag
applies — say so explicitly with the evidence, in the one-line reason.

### Record intake and story inline

Recording is step 4's default action, not a separate "when classification
crystallises" moment. Do not let the session end with "we'll record the intake
later" — that is exactly the shortcut the harness exists to prevent. The gate
is the record, not the interview.

### Offer durable decision records sparingly

Only offer to create a decision record when **all three** are true (same bar
as an ADR):

1. **Hard to reverse** — changing the decision later costs real work.
2. **Surprising without context** — a future agent will wonder why this path
   was taken.
3. **Real trade-off** — genuine alternatives existed and one was picked for
   specific reasons.

For high-risk work that changes behaviour, architecture, authorization, data
ownership, API shape, or validation requirements, a durable decision record is
**required**, not optional. Use the format in [DECISION-FORMAT.md](./DECISION-FORMAT.md)
and add both the markdown file under `docs/decisions/` and the durable row:

```bash
scripts/bin/harness-cli decision add --id <NNNN-slug> --title "<title>" --doc docs/decisions/<NNNN-slug>.md
```

Decision text inside a trace does **not** satisfy this requirement.

## Intake output

A finished grilling session produces:

```text
Sketch:     when X, the agent does Y end-to-end (demo: Z)
Input type: change_request
Lane:       normal
Risk flags: Authorization, Public contracts  (with a one-line reason each)
Forks:      1 — does /admin already have session middleware? → user: no
Story:      docs/stories/US-014-manager-updates-role.md
Validation: unit + integration + e2e
Decision:   none required (no hard gate beyond authorization, behaviour unchanged)
```

Plus the corresponding durable rows already recorded: an `intake` row (with
forks captured in `--notes`), a `story` row (for normal/high-risk), and
optionally a `decision` row.

## When NOT to use this skill

- The repo does not have `repository-harness` installed (run `/harness` first).
- The request is a single trivial edit with no classification ambiguity —
  record a `tiny` intake directly and proceed; do not grill.
- The user explicitly says "just do it" or "skip intake" — respect that, but
  still record the intake row (the gate is the record, not the interview).
- The request is a whole new initiative, not one slice — redirect to
  `harness-project-kicker` (this skill is slice-level).

</supporting-info>
