# US-042 'o' opens the focused story doc in a cmux side surface

## Status

implemented

## Lane

normal

## Product Contract

From the dashboard, the operator could see a story's id/status/proofs but had
to leave the flow to read its packet. This slice adds an **`o`** key that opens
the focused story's packet (`docs/stories/US-NNN-*.md`) in a **cmux side
surface** — a markdown viewer panel beside the terminal with live reload — so
the operator reads the full contract/evidence without leaving the dashboard.

This is a **narrow, benign un-defer of US-028**: it opens a *local markdown
doc* via `cmux markdown open` (read-only live-reload viewer). It is **not** the
deferred external-provider pane-spawn of ADR-0014 — no provider, no build, no
mutating command. Command-Query separation is preserved: the pure dashboard
component only *signals* `openDoc` + the doc path; the handler (`index.ts`)
performs the `cmux` exec.

## Relevant Product Docs

- `docs/initiatives/0002-dashboard-focus-rework.md` — this initiative (#56)
- `docs/stories/US-027-*` — the `[s]` dispatch pattern this mirrors (signal in
  the reducer, act in the handler)
- `docs/stories/US-028-*` + `docs/decisions/0014-dashboard-dispatch-policy.md` —
  the deferred cmux pane-spawn; this slice is the permitted narrow doc-open case
- `extensions/harness/dashboard.ts` — pure `o` reducer signal
- `extensions/harness/index.ts` — `openDocPath` + `openDocInSurface` handler

## Acceptance Criteria

1. **`o` signal**: pressing `o` on the matrix tab (with ≥1 row) makes the pure
   reducer return `action: "openDoc"` — in both list and drilled states. `o` is
   a no-op on backlog (stories have packet docs; backlog items do not) and on an
   empty matrix.
2. **doc-path resolution**: the component resolves the focused (filtered) story
   to its packet's repo-relative path (`docs/stories/<filename>`), or null when
   the story has no packet (e.g. a planned slice with no packet yet) — in which
   case nothing opens.
3. **side-surface open**: the handler runs `cmux markdown open <abs-path>` (opens
   a markdown panel beside the terminal with live reload). Success → info notify;
   failure (cmux missing / no socket) → warning/error notify. Never throws.
4. **dashboard stays open**: after opening, the overlay re-opens (loop continues
   on `openDoc`), so the operator keeps browsing.
5. **Command-Query held**: no `pi.exec` / cmux call originates in the pure
   `dashboard.ts` (the component only signals).
6. **purity + tests**: `dashboard.ts` stays pure. `npx tsc --noEmit` clean.
   `p4` gains `o`-reducer tests; all suites pass.

## Design Notes

- **mirror `s` dispatch**: `o` follows the exact US-027 shape — reducer signals
  `openDoc`, the component resolves the selected row → path, the handler acts.
  No new architectural pattern.
- **relative path from the component, absolute in the handler**: the component
  has no `ctx.cwd`, so it emits a repo-relative path; `openDocInSurface` joins
  `ctx.cwd` for the absolute path `cmux markdown open` needs.
- **`cmux markdown open` defaults**: split `right`, `--focus false` — the doc
  opens beside the dashboard without stealing focus, with live file watching.
- **ADR-0014 scope**: US-028's deferral was about spawning a provider/build
  pane. Opening a read-only local doc in a viewer panel is materially narrower
  and benign; whether ADR-0014 wants an explicit clause for it is flagged as an
  open question (not silently decided here).

## Evidence

Implemented (intake #60 spec_slice). `dashboard.ts`: `DashboardNavResult.action`
gained `"openDoc"`; `reduceDashboardNav` `o` handler (matrix-only, fires drilled
or not, empty-safe). `index.ts`: `HarnessOverlayResult` gained
`{action:"openDoc"; path}`; `handleInput` openDoc branch; new
`openDocPath()` (focused filtered story → `docs/stories/<packet.filename>` or
null); dashboard loop execs `openDocInSurface` on `openDoc` and continues
(re-opens overlay); new `openDocInSurface(pi, ctx, relPath)` runs
`cmux markdown open <abs>` with success/fail notify + try/catch. `tests/p4.test.ts`:
+2 reducer tests (`o` matrix→openDoc, empty/backlog no-op; `o` works drilled).
Verified: `npx tsc --noEmit` exit 0; p2 48 / p3 33 / p4 100 / p6 36 all pass.
`cmux markdown open` confirmed valid (right split, no focus steal, live reload);
`openDocPath` confirmed resolving US-040 → existing packet. e2e (live cmux panel
open) deferred — requires an interactive cmux session. Slice of initiative #56.
