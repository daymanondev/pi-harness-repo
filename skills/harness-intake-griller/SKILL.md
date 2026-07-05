---
name: harness-intake-griller
description: A relentless intake interview that stress-tests a feature idea against the repository-harness domain model — input type, risk flags, lane, affected product docs, story packet, validation — and records durable intake/story rows inline as the classification crystallises. Use before Symphony execution, before recording a harness intake, or whenever a feature request needs shaping into safe, classified work.
---

<what-to-do>

Run a relentless intake interview about the user's request until the work is
fully classified per `docs/FEATURE_INTAKE.md`. Walk the intake tree one branch
at a time, resolving each decision before moving to the next:

1. **Input type** — new_spec | spec_slice | change_request | new_initiative | maintenance_request | harness_improvement
2. **Affected surface** — which product docs, stories, decisions, code areas
3. **Risk flags** — go through all 10 flags; mark every one that applies
4. **Lane** — tiny | normal | high-risk (from flag count + hard gates)
5. **Story shape** — story packet, initiative notes, or direct patch
6. **Validation expectations** — unit / integration / e2e / platform / release

**Ask one question at a time.** Wait for an answer before asking the next.
**For every question, provide your recommended answer** based on what you
already know about the repo, then let the user confirm or correct.

If a question can be answered by exploring the codebase or querying the
durable layer, **do that instead of asking**. In particular:

- Run `scripts/bin/harness-cli query matrix` to see current proof status.
- Run `scripts/bin/harness-cli query stats` and `query backlog` to ground the
  discussion in live repo state.
- Run `scripts/bin/harness-cli query tools --status present` to see what
  validation capabilities are actually equipped (absent = clean skip, never a
  blocker).
- `rg` the codebase and `docs/product/*` to find the affected surface.

**Record durable rows inline, not at the end.** The moment the classification
crystallises, record the intake with `scripts/bin/harness-cli intake`. If the
lane is normal or high-risk, create the story packet next — do not batch.

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

If any of those is missing, stop the interview and tell the user to run
`/harness` (or `harness-cli init`) first — grilling an unmeasured repo
produces classifications that nothing will enforce.

### Harness file structure (the intake map)

```
/
├── AGENTS.md                      # stable agent shim — read first
├── docs/
│   ├── FEATURE_INTAKE.md          # THIS skill's source of truth
│   ├── GLOSSARY.md                # canonical vocabulary
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
flags, and the 6 hard gates. `docs/GLOSSARY.md` is authoritative for term
meanings. When the two disagree, surface it as friction
(`harness-cli backlog add`) and defer to FEATURE_INTAKE for classification.

## During the session

### Challenge against the lane vocabulary

The harness has a strict vocabulary. When the user says "it's a small change"
or "just a quick fix," do not accept the self-classification — translate it
into the harness vocabulary and check the risk checklist. "Small" is not a
lane; `tiny` / `normal` / `high-risk` are. "Quick" describes duration, not
risk. Force the user to defend the lane against the flag list.

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

### Stress-test risk flags with concrete scenarios

For each of the 10 risk flags that the user marks, invent a concrete scenario
that probes whether the flag truly applies or is overstated. For "Public
contracts," ask: "Does this change the HTTP response shape a client relies on,
or only an internal call site?" For "Existing behaviour," ask: "Is the
test-covered path you're changing actually exercised in production, or is it
dead code?"

The goal is to neither under-classify (skip a real flag → wrong lane → missed
proof) nor over-classify (flag everything → everything becomes high-risk → the
lane system loses meaning).

### Ground every claim in live durable state

Before recommending a lane, read the actual repo state. A claim like "there
are no tests around this area" is testable: `query matrix` for the story's
proof row, `rg` the test directory. If proof is weak, the **Weak proof** flag
applies and you should say so explicitly with the evidence.

### Record intake and story inline

The moment input type + lane are resolved, record the intake:

```bash
scripts/bin/harness-cli intake --type <type> --lane <lane> --summary "<one line>"
```

For `normal` and `high-risk` lanes, immediately create the story packet from
`docs/templates/story.md` (or `docs/templates/high-risk-story/` for
high-risk) and add the durable story row:

```bash
scripts/bin/harness-cli story add --id <US-NNN> --title "<title>" --lane <lane>
```

Capture the story id and link it from the intake. Do not let the interview end
with "we'll record the intake later" — that is exactly the shortcut the
harness exists to prevent.

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
Input type: change_request
Lane:       normal
Risk flags: Authorization, Public contracts
Docs:       docs/product/permissions.md, docs/product/account-settings.md
Story:      docs/stories/US-014-manager-updates-role.md
Validation: unit + integration + e2e
Decision:   none required (no hard gate beyond authorization, behaviour unchanged)
```

Plus the corresponding durable rows already recorded: an `intake` row, a
`story` row (for normal/high-risk), and optionally a `decision` row.

## When NOT to use this skill

- The repo does not have `repository-harness` installed (run `/harness` first).
- The request is a single trivial edit with no classification ambiguity —
  record a `tiny` intake directly and proceed; do not grill.
- The user explicitly says "just do it" or "skip intake" — respect that, but
  still record the intake row (the gate is the record, not the interview).

</supporting-info>
