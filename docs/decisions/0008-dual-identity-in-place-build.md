# 0008 Build pi-harness In-Place in the Harness-Consuming Repo

Date: 2026-07-05

## Status

Accepted

## Context

`pi-harness-design/DESIGN.md` §2 specified a **new standalone repo** `pi-harness`
as the package home, and §13 left the question open until the relevant phase
shipped. The repo we are working in (`pi-harness-repo`) already:

- consumes `repository-harness` (has the installer-written `AGENTS.md`,
  `docs/`, `scripts/bin/harness-cli`, and a `harness.db` durable layer), and
- is named for the package and holds `pi-harness-design/DESIGN.md`.

This created a dual identity: the repo is both a **consumer** of
repository-harness (agent-workspace surface) and a **producer** of the
`@earendil-works/pi-harness` pi package (extension + skills surface). The risk
is that the two surfaces leak into each other at publish time — e.g. shipping
`harness.db`, repository-harness's own `docs/`, or its generic `README.md`
inside the pi package tarball.

## Decision

Build the pi-harness package **in-place at the repo root** (not a separate
standalone repo, and not a sub-directory). Keep the two surfaces separated by a
strict npm `files` whitelist:

```json
"files": ["extensions", "skills", "README.md"]
```

Layout:

```
pi-harness-repo/                # consumer of repository-harness AND producer of pi-harness
  AGENTS.md                     # ← repository-harness surface (not shipped)
  docs/                         # ← repository-harness surface (not shipped)
  scripts/                      # ← repository-harness surface (not shipped)
  harness.db                    # ← durable layer (gitignored, not shipped)
  extensions/harness/           # ← pi package surface (shipped)
  skills/harness-intake-griller/# ← pi package surface (shipped)
  package.json                  # ← pi manifest + files whitelist (shipped)
  README.md                     # ← pi-harness README (shipped)
```

The `files` whitelist is the **enforcement boundary**. Adding any path to it
requires explicit review, because that path ships to every consumer via
`pi install` / `npm publish`.

## Alternatives Considered

1. **Standalone repo `pi-harness`** (DESIGN.md §2 original). Rejected for now:
   the dev repo already exists, is named for the package, and holds the design
   doc. `pi install git:<url>` works from any URL, so a split later is a pure
   relocation with no code change (`git filter-repo`).
2. **Sub-directory** (`package/` or `pi-harness/` inside the repo). Rejected:
   adds a path component to every manifest entry with no isolation benefit
   while the `files` whitelist already provides the publish boundary.
3. **No boundary, ship everything.** Rejected outright: would publish
   `harness.db`, `node_modules`, repository-harness's `docs/`, and the wrong
   `README.md` to consumers.

## Consequences

Positive:

- One repo, one source of truth, no split overhead until volume justifies it.
- The `files` whitelist keeps the published tarball auditable and small
  (verified: `npm pack --dry-run` = 7 files / 36 KB).
- repository-harness installer `--merge` updates do not touch `extensions/` or
  `skills/` (it only manages `AGENTS.md`, `docs/`, `scripts/`), so the two
  surfaces never collide on update.

Tradeoffs:

- The repo's `README.md` must describe **pi-harness**, not repository-harness.
  (The installer-written README was replaced — see story/trace for this
  decision's implementation.)
- A future agent that adds a non-pi file to `files` (or removes the whitelist)
  silently breaks the boundary. Mitigated by this decision record existing.
- If the package grows large enough to justify a standalone repo, the split is
  a relocation, not a rewrite — but it is still work.

## Follow-Up

- Re-evaluate standalone split if the package adds a build step, binary asset,
  or a second extension that warrants its own release cadence.
- Keep the `files` whitelist as the single publish-boundary control; do not add
  a `.npmignore` that could diverge from it.
