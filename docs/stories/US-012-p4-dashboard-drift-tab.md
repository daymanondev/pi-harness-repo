# US-012 P4 dashboard — Drift tab (markdown↔durable cross-check)

## Status

planned

## Lane

normal

## Product Contract

Add a **Drift** tab that reads markdown story status and the durable
`harness.db` rows, compares them via a pure drift function, and renders
mismatches (status_mismatch / orphan_markdown / orphan_durable /
missing_evidence) with fix hints. Closes backlog #2 — drift becomes visible
inside one session instead of accumulating silently.

Umbrella intake: #13. Roadmap: `docs/initiatives/P4-dashboard.md` (M4).

**blocked-by:** US-010 (needs the shell). **Not** blocked-by US-011 — drift is
independent of the read-only query triplet.

## Relevant Product Docs

- `pi-harness-design/DESIGN.md` §7 (Drift tab), §11, §9.2 Gate B′
- `docs/initiatives/P4-dashboard.md`
- P2 Gate B′ implementation (the existing drift check to reuse/generalize)

## Acceptance Criteria

- A pure `drift()` function over a fixture with a seeded mismatch returns the
  mismatch kind + a fix hint.
- The Drift tab renders current drift (or "no drift" when clean).
- On the live repo it surfaces the same class of drift Gate B′ blocks on.
- backlog #2 is marked `implemented` when this lands.

## Design Notes

- **Resolve open Q3 here:** decide which markdown fields and which durable
  tables are authoritative, and whether to extract Gate B′'s comparison into a
  shared pure function (preferred — single source of truth for drift logic).

## Validation

To be filled by `harness-intake-griller` when this slice is reached.

| Layer | Expected proof |
| --- | --- |
| Unit | pure `drift()` over seeded mismatches |
| Integration | tab against a fixture repo with known drift |
| E2E | (deferred) |
| Platform | (n/a) |
| Release | (n/a) |

## Harness Delta

- New planned story under umbrella intake #13 (P4 DASHBOARD initiative).
- Closes backlog #2.
- blocked-by US-010.

## Evidence

_To be added after implementation._
