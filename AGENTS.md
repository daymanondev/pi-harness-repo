# Agent Instructions

## Project Skills

This repo ships two harness skills (declared under `pi.skills` in `package.json`;
use the bundled copies, not a global one):

- **`skills/harness-project-kicker`** — initiative shaper. Use when a request
  brings a **new initiative, idea, or prompt** that needs shaping: it *sharpens*
  the requirement, records one `new_initiative` intake, writes initiative notes,
  decomposes into small slice stories (linked to the intake via
  `parent_intake_id`), and drives the per-slice classify→implement→trace loop.
  User-invoked at kickoff.
- **`skills/harness-intake-griller`** — on-demand **clarification** tool. Use
  when a **story or slice is ambiguous** (unclear behavior, UI/acceptance
  questions) and understanding must be sharpened before the automatic intake
  classification. NOT a mandatory per-slice intake gate (ADR-0015).

See `docs/GLOSSARY.md` (grill vs sharpen vs classified) and
`docs/decisions/0015-realign-grill-to-clarification.md`.

<!-- HARNESS:BEGIN -->
## Harness

This repo uses Harness. Before work, read:

- `README.md`
- `docs/HARNESS.md`
- `docs/FEATURE_INTAKE.md`
- `docs/ARCHITECTURE.md`
- `docs/CONTEXT_RULES.md`
- `docs/TOOL_REGISTRY.md`
- `scripts/bin/harness-cli query matrix` on macOS/Linux, or `.\scripts\bin\harness-cli.exe query matrix` on Windows

Use the Rust Harness CLI at `scripts/bin/harness-cli` on macOS/Linux or
`scripts/bin/harness-cli.exe` on Windows as the main operational tool. Before a
step that could use an external tool, run `scripts/bin/harness-cli query tools
--capability <name> --status present` to see what is equipped; an absent
capability is a clean skip.
<!-- HARNESS:END -->
