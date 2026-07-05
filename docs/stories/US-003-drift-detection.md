# US-003 pi-harness drift detection (extension-only)

## Status

planned

## Lane

normal

## Product Contract

pi-harness must detect when `docs/stories/*.md` and the durable `story` table
disagree (status mismatch, orphan markdown, orphan durable row, evidence gap),
and surface that drift to the user — without any change to `repository-harness`
upstream. `harness-cli audit` only reads the durable layer, so it reports
"perfect" while markdown lies; this story draws the missing arrow between the
two boxes.

## Relevant Product Docs

- `pi-harness-design/DESIGN.md` §4 (footer), §7 (dashboard), §9.2 (enforcement gates)
- `docs/HARNESS_AUDIT.md` (existing audit checks — durable-only, the blind spot)
- `docs/TOOL_REGISTRY.md` (no markdown-aware query exists today)

## Acceptance Criteria

- A pure `detectDrift(cwd, exec)` function returns a list of drift records:
  `{ storyId, durable, markdown, kind }` where kind ∈
  `{status_mismatch, orphan_markdown, orphan_durable, missing_evidence}`.
- `detect.ts` exposes it alongside `detectHarness`; `HarnessState` gains an
  optional `drift?: DriftRecord[]` field.
- Footer renders `🪢 ⚠ N drifted` (warning color) when `drift.length > 0`,
  in addition to the existing states.
- Dashboard gains a "Drift" tab (P4) listing each drift record with a one-line
  fix hint (`story update --id <id> --status <x>` or "create packet").
- DESIGN.md §9.2 Gate B is updated: the trace/"done" gate refuses when
  `drift.length > 0` for the story being closed.
- No modification to `repository-harness` source or installer.

## Design Notes

- Source of durable truth: `query matrix` (status enum parse).
- Source of markdown truth: read every `docs/stories/US-*.md`, parse the
  `## Status` line. Both are cheap; reuse the detect cache.
- Keep the checker in `detect.ts` (pure, injected exec) so it is unit-testable
  with fixtures — same pattern as `parseStats`.
- This is the workaround for the upstream blind spot; if `repository-harness`
  ever adds markdown-aware audit, prefer their signal.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | `detectDrift` fixtures cover all 4 drift kinds + the clean case |
| Integration | footer shows the badge when a fixture drift is introduced |
| E2E | N/A |
| Platform | N/A |
| Release | N/A |

## Harness Delta

- Workaround for Backlog #2 (markdown↔durable drift pattern).
- Extends DESIGN.md §4 (footer states), §7 (dashboard tabs), §9.2 (Gate B).
