# US-039 Drift-gate false-positive hardening

## Status

implemented

## Lane

normal

## Product Contract

Eliminate two false-positive drift sources in `extensions/harness/drift.ts`
that block Gate B′ (and thus `harness-cli trace`) when no real drift exists.
Closes backlog #6 (planned treated as orphan_durable) and #12 (parseMatrix
scans the evidence column). Slice of initiative #50.

## Relevant Product Docs

- `extensions/harness/drift.ts` — parseMatrix + computeDrift (the two bugs)
- `extensions/harness/dashboard.ts` — parseMatrixNumeric (the anchored approach mirrored)
- `docs/decisions/0015-realign-grill-to-clarification.md` — just-in-time packet model
- `skills/harness-project-kicker/SKILL.md` — step 6 packet lifecycle note

## Acceptance Criteria

- parseMatrix reads status ONLY from the dedicated status column (column-anchored
  regex before the four yes/no proof columns); evidence text containing an
  earlier enum word no longer causes a false status_mismatch.
- A planned durable row without a packet is NOT orphan_durable drift (planned
  dropped from ACTIVE_WITHOUT_PACKET); in_progress/implemented/changed without a
  packet still are.
- `tsc --noEmit` exits 0; all test suites pass.

## Design Notes

- **Bug #12 (parseMatrix):** The old code did `for (const s of STORY_STATUSES)
  if (line.includes(s))` which scans the ENTIRE row (title + evidence) for enum
  words. Since STORY_STATUSES = [planned, in_progress, implemented, changed,
  retired] checks `planned` first, a row with status=implemented but evidence
  "Replaced the planned legacy path" returned 'planned' (WRONG) → false
  status_mismatch vs markdown ## Status → blocks trace. Fix: column-anchored
  regex `^(?:US-\d+)\s+(?:.+?)\s{2,}(planned|in_progress|implemented|changed|
  retired)(?:\s+(?:yes|no)\b){4}` mirroring parseMatrixNumeric (which anchors on
  four 0/1 proof columns). Fall back to '(unknown)' only on miss; never scan
  title/evidence for enum words.
- **Bug #6 (orphan_durable):** ACTIVE_WITHOUT_PACKET contained 'planned', but a
  planned slice legitimately has no packet yet (the kicker creates planned
  candidates via `story add` + parent_intake_id only; the packet is written when
  the slice moves to in_progress). A packetless planned SIBLING produced
  orphan_durable drift, blocking the trace of the slice actually being worked.
  Fix: drop 'planned' from the Set (keep in_progress, implemented, changed).
- parseMarkdownStatus is unchanged (already reads only ## Status, not Evidence).
- SKILL.md step 6 gains one line clarifying the packet lifecycle.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | tsc clean + p2 (parseMatrix column-anchoring repro; computeDrift planned≠orphan) + p4 (computeDrift planned=[] / in_progress=orphan) |
| Integration | no |
| E2E | no |
| Platform | no |
| Release | no |

## Harness Delta

- `extensions/harness/drift.ts` — parseMatrix column-anchored regex (#12);
  ACTIVE_WITHOUT_PACKET drops 'planned' (#6); DriftKind + set comments updated.
- `skills/harness-project-kicker/SKILL.md` — step 6 packet-lifecycle note.
- `tests/p2.test.ts` — matrix fixtures updated (4 yes/no proof cols); 2 new
  parseMatrix repro tests; orphan_durable fixture uses in_progress not planned.
- `tests/p4.test.ts` — orphan_durable test uses in_progress; 2 new computeDrift
  tests (planned→[] , in_progress→orphan_durable).

## Evidence

- **Repro #12:** `parseMatrix("US-099  T  implemented  yes  yes  no  no  Replaced the planned legacy path")` → `implemented` (was `planned` before fix). Also: retired row with evidence "Was implemented before replacement" → `retired`.
- **Repro #6:** `computeDrift({ "US-1": "planned" }, {})` → `[]` (was `[{kind:"orphan_durable"}]` before fix). `computeDrift({ "US-1": "in_progress" }, {})` → still `[{kind:"orphan_durable"}]`.
- `npx tsc --noEmit` → exit 0.
- `npx tsx tests/p2.test.ts` → all pass; `npx tsx tests/p4.test.ts` → all pass.
