# Initiative 0001 — Realign griller/kicker/dashboard to upstream repository-harness theory

- **Intake:** #44 (`new_initiative`, normal lane, flags: `agent_workflow`, `harness_improvement`)
- **Status:** in progress
- **Date:** 2026-07-08

## Goal

Realign the pi-harness griller/kicker/dashboard layer to the **upstream
repository-harness theory**, removing the per-slice grill gate that drifted
from the author's model. The harness classifies work automatically (one intake
per work item); the grill becomes a lightweight clarification tool; the
dashboard shows initiatives → slices and lets the operator click any story or
backlog item to run it.

## Context — where we drifted

`harness-intake-griller`, `harness-project-kicker`, and the US-023
"grilled-badge" are **pi-harness additions** — they do not exist in upstream
`hoangnb24/repository-harness` (verified: none of the upstream
README/HARNESS/FEATURE_INTAKE/ARCHITECTURE/schema mention grill, kicker, or a
grilled badge). Upstream's model is:

- **Intake** = classify one work item, automatically ("the harness does").
  Evolution = a **new** `change_request` intake (append), never amend.
- **Story** = work packet + proof status.
- **Initiative** = **notes + candidate stories** (not a parent story, not a
  two-tier intake ceremony). HARNESS.md: *"Large product areas should use
  scoped initiative notes."*
- **Loop** (HARNESS.md): classify → story/initiative notes → validation →
  implement → trace. **No grill step.**

The per-slice `spec_slice` "grill" + the immutable "grilled ●/○" badge forced a
second intake ceremony upstream never had, and produced the immutability /
re-intake trap (a diverged or stale classification can never be reconciled
because `intake` is record-only and `story update` has no `--lane`).

## Upstream sync verified (2026-07-08)

`docs/{HARNESS,FEATURE_INTAKE,ARCHITECTURE,CONTEXT_RULES,TOOL_REGISTRY,IMPROVEMENT_PROTOCOL,TRACE_SPEC}.md`
are **byte-identical** to upstream `main`. `scripts/schema/001..008` match
upstream. The prebuilt CLI is vendored (ADR-0005). Only `README.md` differs —
that is our pi-harness product surface, not drift. **Core is current.**

## Affected docs / artifacts

- `docs/decisions/0010-initiative-slices-workflow-model.md` (per-slice-grill parts superseded by ADR-0015)
- `docs/decisions/0012-kicker-grills-requirement-before-intake.md` (grill phase renamed sharpen; substance kept)
- `docs/decisions/0015-*.md` (new — the supersession)
- `docs/stories/US-023-*.md` (grilled-badge → classified/ready)
- `docs/GLOSSARY.md` (grill/sharpen terms)
- `skills/harness-intake-griller/*` (→ clarification tool)
- `skills/harness-project-kicker/*` (grill phase → sharpen)
- `extensions/harness/dashboard.ts` (+ call sites) (badge + hierarchy view)
- `scripts/schema/009-story-parent-intake.sql` (new — slice→initiative link)

## Candidate stories

| Story | Slice | Lane |
| --- | --- | --- |
| US-033 | Slice→initiative durable link (`parent_intake_id` migration 009 + query-sql wiring) | normal |
| US-034 | Rework griller → clarification tool (not per-slice intake gate) | normal |
| US-035 | Rework kicker → initiative shaper; rename grill→sharpen | normal |
| US-036 | Dashboard: classified/ready badge + initiative→slices hierarchy + click-to-run | normal |
| US-037 | ADR-0015 superseding per-slice-grill gate of 0010/0012 | tiny |
| US-038 | Settings panel + skill audit (keep/delete; ensure correct) | normal |

All six slices are linked to intake #44 via `story.parent_intake_id` (migration
009). The dashboard's new initiatives view groups stories by this column.

## Validation shape

- `tsc` clean (no type errors in `extensions/harness`).
- `harness-cli audit` (drift) clean — no new `orphan_durable` / status drift.
- Dashboard renders: matrix shows `classified` badge (any intake linked);
  initiatives tab shows intake #44 → US-033..US-038.
- `[s]` dispatch still routes (classified→implement, unclassified→classify).
- Both skills reference correct paths; `pi.skills` resolves.

## Exit criteria

- US-033..US-038 implemented + committed.
- ADR-0015 accepted; ADR-0010/0012 marked superseded-in-part.
- Dashboard verified rendering + dispatch.
- No regression to existing US-001..US-032 behavior.
