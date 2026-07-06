# US-011 P4 dashboard — stats + backlog + tools tabs (the triplet)

## Status

implemented

## Lane

normal

## Intake

- **Input type:** `spec_slice`
- **Slice intake:** #15 · **Umbrella initiative:** #13 (P4 DASHBOARD)
- **Roadmap:** `docs/initiatives/P4-dashboard.md` (M3 — state & backlog
  visibility triplet)
- **blocked-by:** US-010 (needs the shell + shared fetch/parse spine — done).

## Risk flags

Walked all 10 (`docs/FEATURE_INTAKE.md`). **One applies:**

- **Existing behaviour** — US-011 replaces the dim placeholder text in
  tabs 2/3/4 of `extensions/harness/dashboard.ts` (currently
  `(stats|backlog|tools tab ships in US-011)`, asserted in `tests/p4.test.ts`)
  with real parsed content. Tested placeholder behaviour changes to real
  content.

Probed and **rejected** (documented so the next agent doesn't re-litigate):

- *External systems* — the tabs shell out to `harness-cli query
  stats` / `backlog --open` / `tools --json`, but that is the local
  companion CLI (same repo family), read-only, and US-010 already execs
  `query matrix --numeric` while P3 execs `harness-cli init/migrate` + the
  installer. Not a third-party provider.
- *Public contracts* — `/harness` is this extension's own command surface; no
  HTTP API or external client depends on the overlay's internal view. The
  `setStatus("harness", …)` powerline footer contract is unchanged.
- *Cross-platform* — P3 / US-010 are already cross-platform
  (`ctx.ui.custom` overlay + `pi.exec`); the three new queries add no new
  platform surface.
- *Weak proof* — the area touched is well-tested (US-010 = 16/16, p3 =
  33/33, p2 = 44/44).
- *Auth / Authorization / Data model / Audit-security / Multi-domain* — n/a
  (read-only throughout; no schema, no auth, single product area).

**0 hard gates.** 1 flag + real code impact → **normal**.

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

Approach B (deterministic wiring, no LLM) — same pattern as US-005 / P3 /
US-010.

| Layer | Expected proof | What the test asserts |
| --- | --- | --- |
| Unit | parsers + renderers | `parseStats()` / `parseBacklogOpen()` over captured fixed-column fixtures return the right counts/rows; `parseToolsJson()` over a captured JSON array returns the right tool rows; `renderDashboardLines(state, tab, …)` for each of stats/backlog/tools with stub `fg` renders the right tab body (counts / backlog rows / tool rows) and box-width alignment holds. |
| Integration | router → query → render | load REAL `index.ts`, mock ExtensionAPI capturing `pi.registerCommand`, drive `/harness` against a fixture repo whose detect() = installed+db-ok; assert each tab renders its query's parsed content, tab switch `2`/`3`/`4`/`1`, refresh `r` re-fetches the active tab, `Esc` closes, and a failing query degrades to a dim error row. |
| E2E | deferred | — |
| Platform | n/a | — |
| Release | n/a | — |

New/extended: `tests/p4.test.ts` (unit + Approach-B integration for the
triplet).

## Decision record

**None required.** No hard gate. The parser choices (fixed-column for
stats/backlog, native JSON for tools — both already decided in US-010 design
notes / roadmap open Q1), the per-cwd fetch behaviour (mirrors US-010 open Q2),
and the Approach-B validation are structural, easily reversed, and documented
above — they do not meet the ADR bar (hard-to-reverse + surprising + real
trade-off).

## Harness Delta

- New `spec_slice` intake #15 under umbrella initiative #13.
- Continues the P4 DASHBOARD initiative; unblocks US-012 (drift) only in that it
  keeps the dashboard spine moving (US-012 is **not** blocked-by US-011).
- Reuses the US-010 shell + shared fetch/parse spine.

## Evidence

- `npx tsc --noEmit` → exit 0 (clean).
- `npx tsx tests/p4.test.ts` → **35 passed, 0 failed** (matrix + stats +
  backlog + tools parsers; matrix/stats/backlog/tools tab renderers;
  error-row degradation per tab; box-width alignment at 76 + 60; Approach-B
  wiring: dashboard route fetches all four `query` subcommands, tab switch
  `2`/`3`/`4`/`1`, refresh loop `r` re-fetches + re-opens, `Esc` closes,
  failing matrix/stats/tools query degradation).
- `npx tsx tests/p3.test.ts` → **33 passed, 0 failed** (no regression — dashboard
  route + matrix assertions still green).
- `npx tsx tests/p2.test.ts` → **44 passed, 0 failed** (no regression).
- `lens_diagnostics --mode all` → 0 errors (warnings only: non-null `!`, test
  `console.log`, cyclomatic complexity — same conventions as US-010 / p3 / p2).
- Files: `extensions/harness/dashboard.ts` (new `parseStats` /
  `parseBacklogOpen` / `parseToolsJson` + `StatsCounts`/`BacklogRow`/`ToolRow`/
  `DashboardData` types + `renderStatsTab`/`renderBacklogTab`/`renderToolsTab`;
  `renderDashboardLines` now takes a `DashboardData` aggregate; timeline kept
  as the P5 placeholder), `extensions/harness/index.ts`
  (`fetchStatsCounts`/`fetchBacklogRows`/`fetchToolRows` + `fetchDashboardData`
  parallel fetch; dashboard loop passes `data`; component field `matrix`→`data`),
  `tests/p4.test.ts` (rewritten: triplet unit + Approach-B integration).
- Live smoke: the three parsers were validated against captured `query stats` /
  `query backlog --open` / `query tools --json` output from this repo.
- Note: `detect()` also runs a cached `query stats` for the footer counts — the
  dashboard's own stats fetch is separate (pre-existing footer-vs-dashboard
  pattern from US-010); refresh re-fetches all four tab queries per open.
