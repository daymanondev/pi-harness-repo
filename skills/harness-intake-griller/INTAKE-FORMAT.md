# Intake Format

How the **automatic intake classification** works. This is a quick reference
for `docs/FEATURE_INTAKE.md`; when the two disagree, FEATURE_INTAKE.md is
authoritative (record the drift with `harness-cli backlog add`).

## Classification is automatic, not a grill ceremony

Per `docs/FEATURE_INTAKE.md`: *"The human does not need to classify risk. The
harness does."* Every work item gets **one** intake, classified automatically
from the work's sketch + live repo state. `harness-intake-griller` may
**clarify** an ambiguous story first and feed the sharpened sketch into this
classification — but classification is not a manual gate, and a per-slice
`spec_slice` intake is no longer a mandatory "grilled" readiness signal.

Evolution is **append-only**: when accepted behavior changes later, record a
**new** `change_request` intake. Never amend an old one — `intake` is
record-only by design, so append (not amend) is how a story's classification
stays current.

## Input types

| Type | Use when | Typical artifact |
| --- | --- | --- |
| `new_spec` | Turning a user-provided project spec into harness-ready docs | Product docs, candidate epics, decisions |
| `spec_slice` | Implementing selected behaviour from an accepted initiative | Story packet |
| `change_request` | Changing, fixing, or refining accepted behavior | Story packet or direct patch |
| `new_initiative` | Adding a larger product area needing multiple stories | Initiative notes + story packets |
| `maintenance_request` | Changing technical, operational, or dependency behaviour | Story packet, validation report, or decision |
| `harness_improvement` | Improving how humans and agents collaborate | Direct docs update or `backlog add` |

## Lanes

- **tiny** — low-risk docs, copy, names, narrow edits, or bounded initial
  setup. Record the intake row, then patch directly. No story packet.
- **normal** — story-sized behaviour with bounded blast radius. One story file
  from `docs/templates/story.md`.
- **high-risk** — touches security, data, scope, contracts, or multiple
  roles/platforms. Story folder from `docs/templates/high-risk-story/`. Ask for
  human confirmation if direction is ambiguous.

## Risk flags (a recommended set, derived — not a walked gate)

Scan the work's end-to-end path against all 10 flags and `rg` the codebase to
test each; present the set that applies as part of **one** consolidated
recommendation. Flags are **advisory input to the automatic lane choice**, not
a ceremony the operator must walk flag-by-flag.

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

Hard gates (force high-risk): Auth · Authorization · Data loss or migration ·
Audit/security · External provider behaviour · Removing or weakening
validation.

## Recording the intake (the harness's per-work-item step)

Recording is the harness's normal step for **every** work item — not a grill
gate. Record inline once classification is derived:

```bash
scripts/bin/harness-cli intake \
  --type <type> --lane <lane> \
  --summary "<one-line, ≥10 chars>" \
  --flags "<comma-separated flags>" --docs "<paths>" --story <US-NNN> \
  --notes "<resolved ambiguities + why>"
```

For normal/high-risk, add the story row:

```bash
scripts/bin/harness-cli story add --id <US-NNN> --title "<one-line contract>" --lane <lane>
```

A slice from a kicked initiative is linked to its initiative intake via
`story.parent_intake_id` (migration 009; set by the kicker). The dashboard's
readiness signal is **classified** = any intake linked to the story (US-036) —
not a per-slice `spec_slice` gate.
