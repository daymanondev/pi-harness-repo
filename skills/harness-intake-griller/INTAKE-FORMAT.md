# Intake Format

This is the griller's quick reference for `docs/FEATURE_INTAKE.md`. When the
two disagree, FEATURE_INTAKE.md is authoritative; record the drift with
`harness-cli backlog add`.

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

## Risk flags (mark each that applies)

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

## Recording the intake

```bash
scripts/bin/harness-cli intake \
  --type <type> --lane <lane> \
  --summary "<one-line, ≥10 chars>"
```

Then for normal/high-risk:

```bash
scripts/bin/harness-cli story add --id <US-NNN> --title "<title>" --lane <lane>
```
