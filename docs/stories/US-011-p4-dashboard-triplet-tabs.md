# US-011 P4 dashboard — stats + backlog + tools tabs (the triplet)

## Status

planned

## Lane

normal

## Product Contract

Add three read-only tabs to the DASHBOARD established in US-010: **stats**
(`query stats`), **backlog** (`query backlog --open`), and **tools**
(`query tools --json`). Each tab is a pure renderer reusing the fetch/parse
spine built in US-010. Tab chrome now navigates `1`–`4` for real.

Umbrella intake: #13. Roadmap: `docs/initiatives/P4-dashboard.md` (M3).

**blocked-by:** US-010 (needs the shell + shared fetch/parse spine).

## Relevant Product Docs

- `pi-harness-design/DESIGN.md` §7 (data sources per tab)
- `docs/initiatives/P4-dashboard.md`

## Acceptance Criteria

- Tab `2` renders counts from `query stats` (intakes/stories/decisions/backlog/traces).
- Tab `3` renders open backlog rows from `query backlog --open`.
- Tab `4` renders equipped/missing tools from `query tools --json` (native JSON parse).
- stats/backlog parse the fixed-column tables (no `--json` flag exists for them).
- A failing query in any tab degrades to a dim error row, never throws.

## Design Notes

- Commands: `query stats`, `query backlog --open`, `query tools --json`.
- `query stats` / `query backlog` / `query matrix` have **no `--json`** — parse
  fixed-column tables (open Q1: parse-table chosen for v1; pushing `--json`
  upstream is a later improvement).
- `query tools --json` is native JSON — preferred/structured.

## Validation

To be filled by `harness-intake-griller` when this slice is reached.

| Layer | Expected proof |
| --- | --- |
| Unit | table parsers + renderers |
| Integration | each tab against fixture query output |
| E2E | (deferred) |
| Platform | (n/a) |
| Release | (n/a) |

## Harness Delta

- New planned story under umbrella intake #13 (P4 DASHBOARD initiative).
- blocked-by US-010.

## Evidence

_To be added after implementation._
