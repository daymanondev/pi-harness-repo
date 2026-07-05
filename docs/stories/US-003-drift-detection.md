# US-003 pi-harness drift detection (extension-only)

## Status

retired

## Retirement Note

Retired and **folded into the delivery phases** rather than kept as a
standalone story, to avoid story/phase duplication (the exact entropy the
drift feature exists to fight). The three pieces landed in DESIGN.md §11:

- Footer `🪢 ⚠ N drifted` badge → **P1** (footer, §4)
- Gate B′ done-block on drift → **P2** (enforcement gates, §9.2 — clause already added)
- Dashboard **Drift** tab → **P4** (dashboard, now 5 tabs)

The friction pattern itself is kept as **Backlog #2** (markdown↔durable drift)
for mémoire. See `intervention` on this story for the retirement record.

## Lane

normal

## Product Contract (original, for history)

pi-harness must detect when `docs/stories/*.md` and the durable `story` table
disagree, and surface that drift — without any change to `repository-harness`
upstream. Delivered via the three phase pieces above.

## Harness Delta

- Workaround for Backlog #2.
- Drove DESIGN.md §4 (footer badge), §9.2 (Gate B′), §7/§11 (Drift tab).
- Intervention recorded on this story to capture the human scope change.
