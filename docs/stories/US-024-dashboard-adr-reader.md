# US-024 Dashboard ADR Reader: Render decisions/*.md Body + Verify Age (Part C)

## Status

implemented

## Lane

normal

**Slice intake:** #34 (spec_slice, normal) · **Umbrella initiative:** #29
(control-surface, backlog #5). **Sibling:** US-023 (intake #30).

## Product Contract

The dashboard answers the operator's third control-surface question — *I can see
a decision is stale, but what does it actually say, and what do I do?* Today
`query decisions` returns only metadata (`id, title, status, last_verified_at,
last_verified_result`); the ADR body (context / decision / alternatives /
consequences) lives only in `docs/decisions/NNNN-*.md`, which the dashboard never
reads. This slice closes that gap (Part C):

- A **decisions view** in the dashboard lists ADRs (from `query decisions`) and,
  on drill, renders the body parsed from `docs/decisions/<id>.md` — the standard
  ADR sections (Status / Context / Decision / Alternatives / Consequences per
  `docs/templates/decision.md`).
- Each ADR shows **`last_verified_at` age**; if stale or never-verified, the view
  offers **re-verify as advisory text** (`run harness-cli decision verify <id>`),
  exactly mirroring US-023's `next:` advisory line.
- The dashboard stays **read-only / advisory** (US-014 Command-Query invariant,
  same as US-023): it prints the recommended action; the operator runs it. No
  durable writes originate from the dashboard. No Rust change — bodies are read
  as markdown (the durable layer is metadata-only by design, ADR-0004).

## Relevant Product Docs

- `docs/decisions/*.md` — ADR bodies (read-only input; 0001..0013 today)
- `docs/templates/decision.md` — section headings the parser must handle
- `scripts/bin/harness-cli query decisions` — metadata + `last_verified_at` age
- `extensions/harness/dashboard.ts` — `DASHBOARD_TABS`, US-014 drill-down detail
  panes, US-023 `nextActionFor` advisory pattern (reused)
- `extensions/harness/index.ts` — the multi-query `Promise.all` data fetch (add
  a `query decisions` fetch + markdown reads here)
- `docs/stories/US-023-*.md` — grilled-badge + advisory-routing contract (this
  slice extends *content*, does not relax the read-only invariant)
- Backlog #5 + umbrella intake #29 (control-surface initiative)

## Acceptance Criteria

1. **Decisions view**: a new dashboard surface lists ADRs (id / title / status /
   age from `query decisions`) and drills into a detail pane rendering the body
   parsed from `docs/decisions/<id>.md`. List + detail both degrade cleanly on
   a missing/unreadable file or a failing query (dim error row, never throws —
   same resilient pattern as the other tabs).
2. **Pure ADR parser**: a pure `parseAdr(md): { …sections }` (or section map) in
   `dashboard.ts` (no pi runtime) parses the template headings. It is the single
   source of truth for body rendering; the renderer only formats its output.
3. **Age + advisory re-verify**: the detail view shows `last_verified_at` age and,
   when stale/missing, an advisory `re-verify: run harness-cli decision verify
   <id>` line. Advisory text only — mirrors US-023's `next:` line.
4. **Read-only preserved**: no `decision add/verify`, `intake`, `story`,
   `trace`, or `backlog` write calls in the render path. Verify by inspection
   (US-014 Command-Query boundary held).
5. **Regressions**: tab-switch keys, `r` refresh, `↑/↓`/`j`/`k` cursor, `Enter`
   drill, `Esc` back/close, and the US-023 grilled-badge + `next:` routing all
   stay byte-identical. New view is purely additive to the tab model.
6. **Purity + tests**: `parseAdr` and the reader render are pure and covered by
   unit tests in `tests/p4.test.ts` (section extraction incl. missing-section +
   garbage-input cases; list/detail render for present/missing/stale ADR).
   `npx tsc --noEmit` clean.

## Design Notes

- **Why read markdown, not extend `query decisions`:** the durable layer is
  metadata-only by design (ADR-0004 — operational records, not doc bodies).
  Extending the Rust query to return bodies would bloat the durable contract and
  couple render to Rust; reading `docs/decisions/*.md` directly keeps body
  rendering a pure dashboard concern. Reversible and unsurprising → **not
  ADR-worthy** (fails the hard-to-reverse / surprising / real-trade-off bar).
- **Reuses US-023's advisory pattern:** age/staleness → advisory re-verify text,
  structurally identical to `nextActionFor`'s grill/implement prompt. The
  dashboard *routes*, the operator runs it — no ADR-0014 launch-surface change.
- **OQ-1 RESOLVED: new tab (key `6`).** Added `decisions` as a 7th tab +
  ListTab (cursor + drill). Chose new-tab over drill-from-stats-count because
  stats is a non-list tab; converting it would risk AC5. Key `6` keeps `1-5`/`t`
  mechanics byte-identical (only the footer hint label `[1-5,t]`→`[1-6,t]` and
  one tab-strip assertion updated). Fetch sorts newest-first so the cursor index
  matches the drill index (US-014 invariant).
- **Parser resilience:** ADRs in-repo occasionally deviate from the template
  (e.g. merged/renamed sections). `parseAdr` must return whatever sections it
  finds and a safe fallback for the rest — never throw on a malformed file.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id <id> --unit 1 --integration 1 --e2e 0 --platform 0`.

Verify command: `npx tsx tests/p4.test.ts && npx tsc --noEmit`.

| Layer | Expected proof |
| --- | --- |
| Unit | `parseAdr` section extraction (incl. missing-section + garbage) + reader list/detail render (present / missing-file / stale) |
| Integration | dashboard fetch (`query decisions` + markdown reads) → render → drill/switch wiring, incl. failing-query degradation |
| E2E | — |
| Platform | — |
| Release | — |

## Harness Delta

- Completes the dashboard's third control-surface affordance (after US-023's
  grilled-badge + next-action): the operator can now *read* a decision and see
  whether it is trusted, without leaving the overlay.
- Reusable pure `parseAdr` + the advisory "age → re-verify" line establish the
  pattern future reader slices (e.g. a backlog-item or trace reader) can follow.

## Evidence

tsc clean (`npx tsc --noEmit`, exit 0 — extensions + tests). `tests/p4.test.ts`
80 passed / 0 failed (+14 US-024 cases: `parseDecisionMeta` pipe-delimited +
garbage; `parseAdrBody` full-section + missing-section + empty; `needsReverify`
- `formatAdrAge`; nav `'6'` tab switch + decisions cursor/Enter-drill; decisions
list render; empty + error degradation; detail title/status/age/advisory/excerpts;
markdown-only ADR status fallback; wiring read/sort-newest-first/skip-README).
Regression: p2 46, p3 33, p5 31, p6 36 — all 0 failed. Lens diagnostics 0
errors. Read-only invariant verified (AC4): no `intake`/`story`/`trace`/
`backlog`/`decision add|verify` write calls in the render path — `decision
verify <id>` appears only as printed advisory text; `fetchDecisions` uses a
read-only `query sql` + file reads. `story verify US-024` → pass.
