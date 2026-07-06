# US-009 kicker slice 3 — dogfood the kicker on a sample requirement

## Status

implemented

## Lane

normal

## Product Contract

Third slice of `harness-project-kicker` (umbrella intake #9). **Rescoped mid-flight (with user)** from an interactive dogfood run to a **static audit + fix + worked example**, because the kicker is one-shot and interactive (the step-4 quiz needs a human) so an automated run would not validate anything real. The real validation is the next genuine project kickoff.

## Evidence

- Pulled CLI ground truth from `sqlite3 harness.db .schema` + every subcommand
  `--help`: `intake.input_type`, `intake.risk_lane`, `story.status`,
  `trace.outcome`, plus all accepted CLI spellings.
- Discovered the CLI **normalizes** — `--lane high-risk` → stored `high_risk`,
  `--type maintenance_request` → stored `maintenance` (verified by inserting +
  deleting test rows). So the repo-wide `high-risk` / `maintenance_request`
  spellings in docs, `extensions/harness/gates.ts`, and DESIGN.md are **not** bugs.
- Found + fixed one genuine hallucination: `SKILL.md` step 2 listed
  `--lane <normal|cautious|regulated>` — `cautious`/`regulated` do not exist
  (CLI rejects). Corrected to `<tiny|normal|high-risk>`.
- Verified the corrected skill: no `cautious`/`regulated`/`low-risk` tokens
  remain; every embedded enum (`new_initiative`, `high-risk`, `planned`,
  `--id/--title/--lane`) is a CLI-accepted form.
- Added a **Worked example** section showing the artifact shape a run produces
  (intake id, roadmap milestones, slice contracts, hand-off) so a future run
  has a reference shape.
- Meta-finding recorded: the three session errors (`status: done`,
  `outcome: <prose>`, `lane: cautious`) are all the same failure mode —
  unverified enum generation; the antidote is the harness's own 'check
  `--help`/schema before writing any CLI value' discipline.
