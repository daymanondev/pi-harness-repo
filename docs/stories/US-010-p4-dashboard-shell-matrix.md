# US-010 P4 tracer bullet — DASHBOARD route + proof-matrix tab

## Status

implemented

## Lane

normal

## Intake

- **Input type:** `spec_slice`
- **Slice intake:** #14 · **Umbrella initiative:** #13 (P4 DASHBOARD)
- **Roadmap:** `docs/initiatives/P4-dashboard.md` (M1 shell + first tab of M2)
- **blocked-by:** none (first slice; handed off from `harness-project-kicker`)

## Risk flags

Walked all 10 (`docs/FEATURE_INTAKE.md`). **One applies:**

- **Existing behaviour** — US-010 changes a shipped, tested route. `routeView()`
  in `extensions/harness/overlay.ts:97` currently returns `"status"` when
  installed+db-ok; this slice repoints it to a new `"dashboard"` view and
  retires `renderStatusLines` (covered by `tests/p3.test.ts:231`
  "status view renders counts + P4 hint", which this slice updates).

Probed and **rejected** (documented so the next agent doesn't re-litigate):

- *External systems* — the dashboard shells out to `harness-cli query matrix
  --numeric`, but that is a local companion CLI (same repo family), read-only,
  and P3 already execs `harness-cli init/migrate` + the installer. Not a
  third-party provider.
- *Public contracts* — `/harness` is this extension's own command surface; no
  HTTP API or external client depends on the overlay's internal view. The
  `setStatus("harness", …)` powerline footer contract is unchanged.
- *Cross-platform* — P3 is already cross-platform (`ctx.ui.custom` overlay +
  `pi.exec`); the matrix query adds no new platform surface.
- *Weak proof* — the area touched is well-tested (P3 = 34/34).
- *Auth / Authorization / Data model / Audit-security / Multi-domain* — n/a.

**0 hard gates.** 1 flag + real code impact → **normal**.

## Product Contract

When `detect()` reports `cliInstalled && dbInitialized`, `/harness` opens a
**DASHBOARD** overlay (replacing the P3 STATUS placeholder). The dashboard has
tab chrome (`1`–`4` / `t` labels, only `1` active in this slice — `2`/`3`/`4`/`t`
render as dim placeholders), `r` to refresh, `Esc` to close. Tab `1` renders the
**proof matrix**: rows from `query matrix --numeric`, each with status + numeric
proof columns, color-coded by proof strength (`success`/`warning`/`dim`).

Confirmed design decisions (griller):

1. **New file** `extensions/harness/dashboard.ts` for the DASHBOARD renderer +
   matrix parser. `overlay.ts` stays the install-wizard module.
2. **Retire** `renderStatusLines` — it was always a "ships in P4" placeholder;
   `routeView` returns `"dashboard"` instead of `"status"`, and `render()`
   dispatches to the dashboard renderer.
3. **Validation = unit + integration (Approach B)**, no e2e/platform/release —
   matches P3.

## Relevant surface (affected files / symbols)

- `extensions/harness/overlay.ts` — `HarnessView` type (`"status"` → `"dashboard"`),
  `routeView()` (line 97, return `"dashboard"`), **delete** `renderStatusLines`
  (line 348). The `box()`/`padRight`/`truncateAnsi` helpers stay (reused by
  dashboard.ts via export).
- `extensions/harness/dashboard.ts` — **new**. `renderDashboardLines(state, …)`
  - `parseMatrixNumeric(stdout)` pure functions; tab-state type for the active
  tab. Imports only `./detect.js` types (same purity contract as overlay.ts).
- `extensions/harness/index.ts` — `HarnessOverlayComponent.render()` (line 274)
  dispatches dashboard; `handleInput()` (line 258) gains `1`–`4`/`t`/`r` keys;
  `handleHarnessCommand()` (line 361) fetches `query matrix --numeric` via
  `exec` at open time against `this.state.cwd`.
- `tests/p3.test.ts:231` — update the "status view" test → "dashboard view"
  (matrix tab renders proof rows). Plus new `tests/p4.test.ts`.

## Acceptance Criteria

- In an installed + db-ok repo, `/harness` opens DASHBOARD (not INSTALL, not
  STATUS).
- Tab `1` renders story rows from `query matrix --numeric` with status + proof
  columns, color-coded by proof strength.
- Tab chrome shows `1`–`4` + `t`; `2`/`3`/`4`/`t` are dim placeholders in this
  slice.
- `r` re-fetches the matrix; `Esc` closes.
- A failing `query matrix` renders a dim error row in the tab and never throws
  out of the overlay.
- `renderStatusLines` is deleted; no orphaned `"status"` branch remains.
- `tsc` clean; `tests/p3.test.ts` + `tests/p4.test.ts` green.

## Design Notes

- **Commands:** `query matrix --numeric` (verified present — returns numeric
  proof cols `1/1/0/0`; resolves roadmap open Q4).
- **Parser:** `query matrix`/`stats`/`backlog` have **no `--json`** (verified);
  parse the fixed-column table. Open Q1 (push `--json` upstream?) → **deferred**:
  parse-table is reversible; revisit only if parsing proves fragile. Record the
  choice here, not as an ADR.
- **cwd / multi-repo (open Q2):** the extension already caches per-cwd
  (`driftCache.set(cwd,…)`, `detectDrift(cwd,…)` in `index.ts`). The dashboard
  fetches against `this.state.cwd` at open time → **mirrors existing per-cwd
  behavior**. No new decision, no ADR.
- **Purity split:** pure renderers/parser in `dashboard.ts` (unit-testable with
  a stub `fg`, exactly like `renderInstallLines`); impure lifecycle (command
  routing, `pi.exec`, cache-bust, footer flip) in `index.ts`. Mirrors P3 / ADR-0011.
- **Theming:** inject `fg(color, text)` — same `FgFn` shape overlay.ts uses.

## Validation

Approach B (deterministic wiring, no LLM) — same pattern as P2 US-005 / P3.

| Layer | Expected proof | What the test asserts |
| --- | --- | --- |
| Unit | renderer + parser | `parseMatrixNumeric()` over a captured `query matrix --numeric` fixture returns the right rows; `renderDashboardLines()` with stub `fg` renders title + colored proof rows + tab chrome; box-width alignment holds. |
| Integration | router → query → render | load REAL `index.ts`, mock ExtensionAPI capturing `pi.registerCommand`, drive `/harness` against a fixture repo whose detect() = installed+db-ok; assert dashboard route, matrix tab content, `r` refresh re-execs, `Esc` closes, failing-query degradation. |
| E2E | deferred | — |
| Platform | n/a | — |
| Release | n/a | — |

New file: `tests/p4.test.ts` (unit + Approach-B integration). Update
`tests/p3.test.ts:231` for the retired status view.

## Decision record

**None required.** No hard gate; Q1 is reversible (Design Notes); Q2 resolved by
existing per-cwd behavior. The new-file / retire-status / Approach-B choices are
structural, easily reversed, and documented above — they do not meet the ADR bar
(hard-to-reverse + surprising + real trade-off).

## Harness Delta

- New `spec_slice` intake #14 under umbrella initiative #13.
- First slice of the P4 DASHBOARD initiative; unblocks US-011 (triplet) and
  US-012 (drift).
- Establishes the dashboard shell + shared fetch/parse spine reused by US-011.

## Evidence

- `npx tsc --noEmit` → exit 0 (clean).
- `npx tsx tests/p4.test.ts` → **16 passed, 0 failed** (parser, matrix render,
  placeholder tabs, box-width alignment at 76 + 60, Approach-B wiring:
  dashboard route fetches `query matrix --numeric`, tab switch `2`/`1`,
  refresh loop `r` re-fetches + re-opens, `Esc` closes, failing-query
  degradation).
- `npx tsx tests/p3.test.ts` → **33 passed, 0 failed** (status-view test
  removed; routeView assertions updated `status`→`dashboard`; DASHBOARD route
  wiring test renamed + still green).
- `npx tsx tests/p2.test.ts` → **44 passed, 0 failed** (no regression).
- `lens_diagnostics --mode all` → 0 errors across 9 files.
- Files: `extensions/harness/dashboard.ts` (new, pure),
  `extensions/harness/overlay.ts` (`HarnessView`+`routeView`→dashboard,
  exported `box`/`padRight`/`truncateAnsi`/`BOX_WIDTH`, deleted
  `renderStatusLines`), `extensions/harness/index.ts` (dashboard branch +
  `fetchMatrix` + refresh loop + tab/refresh key handling).
- Open Q4 (matrix `--numeric`) resolved: flag exists. Open Q1 (parse-table
  vs `--json`) + Q2 (per-cwd) resolved as planned in Design Notes.
