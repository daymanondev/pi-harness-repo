# US-017 P5 — Observer onboarding (`o` key → install.sh)

## Status

planned

## Lane

normal

## Product Contract

When `detect().observerInstalled` is false, the DASHBOARD shows a one-line
prompt ("Flow logging is OFF. Press o to enable…") and an `o` key that runs the
observer's `install.sh` — which renames `scripts/bin/harness-cli` to
`harness-cli.real` and drops the logger in its place — via `pi.exec`. After
install, re-detect so the footer/tab flip live. The extension **never** calls
`harness-cli tool register` (preserves the observer's documented companion
semantics).

Umbrella intake: **#20** (P5 timeline). Roadmap: `docs/initiatives/P5-timeline.md` (M3).
**blocked-by:** none (sequenced last; independent of the timeline render).

## Relevant Product Docs

- `pi-harness-design/DESIGN.md` §8.1 (observer install), §13.1 / ADR-0011 (the
  installer-source-pinning analogue this slice resolves for the observer)
- `docs/initiatives/P5-timeline.md` — M3 + OQ-2
- `extensions/harness/detect.ts` — `observerInstalled` (the signal this toggles)
- `extensions/harness/index.ts` — the overlay result union + re-detect loop
  (the `o` action + HarnessOverlayResult seam to extend)

## Acceptance Criteria

- When observer is absent, the dashboard shows the one-line prompt + `o` hint.
- `o` runs the observer `install.sh` via `pi.exec` (progress surfaced in-pane),
  never `harness-cli tool register`.
- On success, re-detect flips `observerInstalled` → the footer + TIMELINE tab
  reflect it without a manual restart.
- Failure (network, script exit ≠ 0) surfaces the error in-pane, never crashes.

## Design Notes

- **OQ-2 = the load-bearing open question.** The repo dropped the
  `harness-observer/` clone in US-002, so `install.sh` is external. Pin to a
  release tag or `main`? Mirror ADR-0011 (cache-bust + pinned ref +
  `INSTALLER_REF`-style constant). **Likely needs an ADR** — offer it at intake.
- **Risk surface (slice-level):** `External systems` (downloads + runs an
  external script) + `Existing behaviour` (mutates `scripts/bin/harness-cli`).
  This is the only state-mutating slice in P5 — keep it isolated.
- **Result union.** Add an `{ action: "enable-observer" }` to
  `HarnessOverlayResult` (analogous to `{ action: "install" }`).

## Validation

To be filled by `harness-intake-griller` when this slice starts. Expected
(provisional): unit (prompt render + plan builder, pure) + integration
(Approach B: `o` → mocked `pi.exec` → re-detect flip). e2e/platform: no.

| Layer | Expected proof |
| --- | --- |
| Unit | prompt render + enable-observer plan |
| Integration | `o` → mocked exec → re-detect flip |
| E2E | |
| Platform | |
| Release | |

## Harness Delta

Likely a decision record (ADR-0013?) mirroring ADR-0011 for the observer
installer source pinning — offer at intake if OQ-2 resolves here.

## Evidence

(pending implementation)
