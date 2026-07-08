# Decisions

Decision records explain why important product, architecture, or harness choices
were made.

Use `docs/templates/decision.md` when adding a new decision.

After adding or updating a markdown decision file, also add or refresh the
durable decision row:

```bash
scripts/bin/harness-cli decision add \
  --id 0008-auth-boundary \
  --title "Auth Boundary" \
  --doc docs/decisions/0008-auth-boundary.md
```

Trace fields such as `--decisions` summarize task-level choices. They do not
count as the Harness decision log.

Add a decision when:

- A locked technical choice changes.
- A product rule changes meaningfully.
- A validation requirement is added, removed, or weakened.
- A high-risk feature chooses one design over another.
- Auth, authorization, data ownership, audit/security, or API behavior changes.
- The source-of-truth hierarchy changes.

The canonical decision list is the durable `decision` table, surfaced by
`scripts/bin/harness-cli query decisions` — the markdown files are the
human-readable bodies, not the index. A decision that partially supersedes
another links to it from its Status section (e.g. ADR-0015 → ADR-0010/0012) and
annotates the superseded record with a one-line pointer.
