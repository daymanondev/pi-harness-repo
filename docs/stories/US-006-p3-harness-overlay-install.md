# US-006 P3 — `/harness` overlay router + INSTALL view

> **Session handoff story.** Created as the post-compact target so a fresh
> session opens with a clear P3 objective. Source spec: `pi-harness-design/DESIGN.md` §5 (overlay), §11 P3.

## Status

planned

## Lane

normal

## Product Contract

Deliver the `/harness` command that the P1 footer/widget already promises ("Run
/harness to install") but which does not yet exist. One command, two modes:

- **INSTALL view** (repo has no harness): an overlay wizard that onboards
  repository-harness end-to-end — installer → `init` → `migrate` → AGENTS.md
  shim — then the footer flips to the live state and the gates arm.
- **STATUS view** (repo has harness): a minimal menu placeholder. The full
  multi-tab dashboard is P4; P3 only proves the router + command work.

## Relevant Product Docs

- `pi-harness-design/DESIGN.md` §5 (overlay router), §11 P3, §13.1 (installer source pinning — open)
- `extensions/harness/{detect,index}.ts` (detection + exec plumbing to reuse)
- pi APIs (verified): `pi.registerCommand(name, {handler})`, `ctx.ui.custom(fn, { overlay: true, overlayOptions })`, guard `ctx.mode === "tui"` / `ctx.hasUI`

## Acceptance Criteria

### Command + router

- `pi.registerCommand("harness", { handler })` registers `/harness`.
- Handler calls `detectHarnessCached`, then routes: `!cliInstalled || !dbInitialized` → INSTALL view; else STATUS view.
- Guarded by `ctx.mode === "tui"` (overlay is TUI-only); in `-p`/json it no-ops or prints a one-line status.

### INSTALL view (the P3 deliverable)

- Overlay (`ctx.ui.custom({ overlay: true })`) shows: "repository-harness not found", the planned steps, and `[Enter] install / [Esc] cancel`.
- On confirm, runs sequentially via `pi.exec` (reuse `makeExec`): installer command → `harness-cli init` → `harness-cli migrate` → write `AGENTS.md` shim with the `<!-- HARNESS:BEGIN -->` marker.
- Per-step progress + failure stop (any non-zero exit aborts and reports).
- On success: invalidate the detect cache, re-detect, confirm via `ctx.ui.notify`, and the footer flips to live state.

### STATUS view (placeholder)

- A minimal overlay listing durable counts + a hint that the dashboard is coming (P4). No tabs yet.

### Installer pin-down (§13.1 — resolve before/within P3)

- Determine the real repository-harness install command (curl line or installer script) from `docs/HARNESS.md` / the repository-harness README; pin to a tag, not `main`, if possible (§13.1).
- Record the decision as an ADR if non-trivial.

### Cross-cutting

- Reuse `detectHarness`/`detectHarnessCached`, `cliBinaryPath`, `makeExec` — no duplication.
- Never crash the session: wrap overlay + exec in try/catch; failures degrade to a notify.
- Unit-testable parts (router decision, step sequencing) kept pure where possible.

## Design Notes

- The overlay `fn(tui, theme, keybindings, done)` renders the wizard; `done(result)` closes it.
- `overlayOptions` (anchor/width/margin) for positioning once the shape is known.
- The installer likely needs network; surface a clear error if offline.
- After install, the P2 gates auto-arm (they already key off `cliInstalled && dbInitialized`).

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | router decision (install vs status) from a HarnessState; step-sequence builder |
| Integration | manual: run `/harness` in a throwaway non-harness repo → confirm it installs + footer flips |
| Typecheck | `tsc --noEmit` exit 0 |
| E2E | N/A |
| Platform | N/A |
| Release | N/A |

## Harness Delta

- Resolves the P1 footer/widget "broken promise" (`/harness` now exists).
- Resolves §13.1 (installer source pinning) as a side effect.
- Foundation for P4 (dashboard) — the router + overlay host carry over.

## Evidence

To be added after P3 implementation.
