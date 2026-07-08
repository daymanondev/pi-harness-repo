# Intake Format

This is the griller's quick reference for `docs/FEATURE_INTAKE.md`. When the
two disagree, FEATURE_INTAKE.md is authoritative; record the drift with
`harness-cli backlog add`.

## How the griller applies this (procedure, not interrogation)

The reference tables below are the *rules*. The griller applies them with the
**sketch → auto-classify → fork-check → record** loop — it does **not** walk the
tables as a one-question-per-branch interview:

1. **Sketch** the slice (tracer-bullet + in/out scope). Derive from the
   kicker's one-line contract if the slice has one; elicit otherwise.
2. **Auto-classify** input type + flags + lane + shape + validation from the
   sketch + live repo state; present as **one recommendation** with a
   one-line reason per flag.
3. **Fork-check** — escalate only genuine forks (not derivable, not in the
   sketch, and material to classification/shape/validation).
4. **Record by default** — if no classification-affecting fork, present **and**
   record in the same turn (fix-rather-than-confirm). Block only on forks.

`FEATURE_INTAKE.md`'s principle stands: *the human does not classify risk; the
harness does.*

## Input types

| Type | Use when | Typical artifact |
| --- | --- | --- |
| `new_spec` | Turning a user-provided project spec into harness-ready docs | Product docs, candidate epics, decisions |
| `spec_slice` | Implementing selected behaviour from an accepted spec | Story packet |
| `change_request` | Changing, fixing, or refining accepted behaviour | Story packet or direct patch |
| `new_initiative` | Adding a larger product area needing multiple stories | Initiative notes + story packets |
| `maintenance_request` | Changing technical, operational, or dependency behaviour | Story packet, validation report, or decision |
| `harness_improvement` | Improving how humans and agents collaborate | Direct docs update or `backlog add` |

## Lanes

- **tiny** — low-risk docs, copy, names, narrow edits, or initial setup limited
  to declared deps / health endpoint / dev-only DB connection. Record the
  intake row, then patch directly. No story packet.
- **normal** — story-sized behaviour with bounded blast radius. Create one
  story file from `docs/templates/story.md`.
- **high-risk** — touches security, data, scope, contracts, or multiple
  roles/platforms. Create a story folder from `docs/templates/high-risk-story/`
  (`execplan.md`, `overview.md`, `design.md`, `validation.md`). Ask for human
  confirmation before implementation if direction is ambiguous.

## Risk flags (auto-derived as a recommended set, not walked)

The griller scans the sketch's end-to-end path against all 10 flags and `rg`s
the codebase to test each, then presents the set that applies as part of its
**one** consolidated recommendation — it does **not** ask one question per
flag.

`Auth` · `Authorization` · `Data model` · `Audit/security` · `External systems`
· `Public contracts` · `Cross-platform` · `Existing behaviour` · `Weak proof`
· `Multi-domain`

## Classification rule

```text
0–1 flags   → tiny or normal (by code impact)
2–3 flags   → normal with stronger validation
4+ flags    → high-risk
Any hard gate → high-risk (unless human explicitly narrows scope)
```

## Hard gates (force high-risk)

Auth · Authorization · Data loss or migration · Audit/security · External
provider behaviour · Removing or weakening validation requirements.

## Recording the intake (default action — do not gate on a confirm-round)

Record inline the moment auto-classify + fork-check are done. If a genuine
fork changed the classification, resolve it first, re-derive, then record.
Capture any resolved forks in `--notes` (the fork log).

```bash
scripts/bin/harness-cli intake \
  --type <type> --lane <lane> \
  --summary "<one-line, ≥10 chars>" \
  --flags "<comma-separated flags>" --docs "<paths>" --story <US-NNN> \
  --notes "<genuine forks resolved + why>"
```

Then for normal/high-risk:

```bash
scripts/bin/harness-cli story add --id <US-NNN> --title "<one-line contract>" --lane <lane>
```

**Invariant:** "grilled" = a `spec_slice` intake is linked to the story — the
procedure changed, this durable signal did not (drives the US-023 grilled-badge
- Gate B′).
