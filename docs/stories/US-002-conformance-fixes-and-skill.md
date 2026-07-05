# US-002 Conformance fixes + harness-intake-griller skill

## Status

implemented

## Lane

normal

## Product Contract

After the P1 build, audit the pi-harness work against `repository-harness`
conventions and close the gaps: bring the repo under git, give the package a
clean publish surface, and remove clutter. Then author the
`harness-intake-griller` skill (referenced by `AGENTS.md`) and bundle it into
the extension so the intake step has a real source of truth.

## Relevant Product Docs

- `pi-harness-design/DESIGN.md` §2 (package layout), §3 (detection), §13 (open questions)
- `docs/HARNESS.md` (Harness v0 scope, deliberately-excludes list)
- `docs/FEATURE_INTAKE.md` (harness_improvement input type)
- `~/.pi/agent/skills/grill-with-docs/SKILL.md` (skill pattern reference)

## Acceptance Criteria

- Repo is under git with a clean baseline commit (no ignored artifacts staged).
- `package.json` has a `files` whitelist so `npm pack` ships only `extensions/`, `skills/`, `README.md`.
- `harness-observer/` source clone removed from repo root (runtime data `.harness-observer/` untouched).
- `.gitignore` excludes `harness-cli.real` (observer rename artifact).
- `skills/harness-intake-griller/` exists with `SKILL.md` + 2 companion files, declared via `pi.skills`.
- `AGENTS.md` skill reference points to the bundled path.
- Verification: `npm pack --dry-run` clean; `tsc --noEmit` exit 0.

## Design Notes

- **Skill location:** bundle in `skills/` (pi-package convention) rather than `.codex/skills/` (Codex convention). Declared in `package.json` under `pi.skills`.
- **Skill depth:** full grill-with-docs style (entry + 2 companion files), adapted to the harness vocabulary (lanes, risk flags, hard gates, `docs/decisions/` not `adr/`, durable rows recorded inline).
- **Dual identity:** see Decision 0008 — repo both consumes repository-harness and produces the pi-harness package; `files` whitelist is the boundary.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | skill markdown renders; companion files link correctly |
| Integration | `npm pack --dry-run` ships the skill; git baseline is clean |
| E2E | N/A (no runtime command in this story) |
| Platform | N/A |
| Release | N/A |

## Harness Delta

- Resolved Backlog #1 (dangling `.codex/skills/...` reference).
- Added Decision 0008 (in-place build + files whitelist).
- Recorded friction: repo was not git-tracked; package had no `files` whitelist; `.gitignore` missed `harness-cli.real`.

## Evidence

- `git log`: baseline commit `6e52048` (Dung Pham), 55 files, no ignored artifacts.
- `npm pack --dry-run`: 7 files / ~36 KB → after US-003 README rewrite, 7 files / 28.6 KB.
- `tsc --noEmit` → exit 0.
- Durable: trace #3 (standard tier, meets normal-lane requirement).
- Backlog #1 closed as `implemented` with actual outcome.
