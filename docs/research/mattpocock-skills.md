# Research: mattpocock/skills Patterns for Agent Intake

- **Intake:** #49 (`harness_improvement`, tiny)
- **Date:** 2026-07-08
- **Context:** auxiliary research for initiative #44 (realign griller/kicker/dashboard to upstream repository-harness theory). Source: <https://github.com/mattpocock/skills>

## Summary

`mattpocock/skills` provides composable, deterministic agent skills that
emphasize strict process over generative variation: **progressive disclosure**
for skill structure, a **lightweight triage state machine** for intake, and
**"leading words"** as vocabulary anchors — a blueprint for balancing thorough
clarification with low-ceremony execution.

## Findings

1. **Skill structure & progressive disclosure** — core instructions live in
   `SKILL.md`; deeper context is pushed to sibling files (`GLOSSARY.md`,
   `AGENT-BRIEF.md`) accessed via "context pointers" only when needed.
   [writing-great-skills](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-great-skills/SKILL.md)
2. **User vs model invocation** — frontmatter `disable-model-invocation: true`
   keeps a skill out of the agent's active context (token spend) unless the user
   invokes it manually (cognitive load instead).
   [writing-great-skills](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-great-skills/SKILL.md)
3. **Lightweight triage & bypass** — the `/triage` skill categorizes work into
   states (`needs-triage` / `needs-info` / `ready-for-agent`) and intentionally
   provides a **"Quick state override"**: if a human says "ready-for-agent", the
   agent skips grilling and trusts the user — avoiding over-ceremony.
   [triage](https://github.com/mattpocock/skills/blob/main/skills/engineering/triage/SKILL.md)
4. **Relentless yet productive grilling** — check for redundancy and prior
   rejections (an `.out-of-scope/` folder) **before** questioning the user.
   `/grill-me` and `/grill-with-docs` are focused interview loops to sharpen
   domain modeling, not generic questioning.
   [triage](https://github.com/mattpocock/skills/blob/main/skills/engineering/triage/SKILL.md)
5. **Prompt patterns: leading words & positive framing** — prompts use "leading
   words" (dense pre-trained concepts) to anchor behavior efficiently; they
   "prompt the positive" (name the desired behavior) over negative guardrails,
   and enforce strict **completion criteria** to prevent premature completion.
   [writing-great-skills](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-great-skills/SKILL.md)

## Already applied in initiative #44

- **Progressive disclosure** — both skills keep `SKILL.md` thin (griller = 98
  lines) and split detail into `INTAKE-FORMAT.md` / `SHARPEN-FORMAT.md` /
  `KICK-FORMAT.md`. ✓
- **User vs model invocation** — the kicker uses `disable-model-invocation: true`
  (user-invoked at kickoff); the griller is model-invocable (on-demand). ✓
- **grill-with-docs style** — the reworked griller is a one-question-at-a-time,
  repo-grounded clarification interview (ADR-0015). ✓

## Candidate steals (future)

- **Quick state override** for the griller: let the operator bypass clarification
  when they already know what they want ("ready-for-agent" → skip straight to
  classify/implement). Matches upstream's "the harness classifies automatically."
- **Prior-rejection check** before grilling: consult an out-of-scope/rejected
  list before asking, to avoid re-litigating settled questions.
- **Structured triage notes** output ("What's established" / "What's still
  needed") instead of open-ended conversation — could feed the intake
  classification fields directly.
- **Leading words + positive framing + completion criteria** for skill prompts —
  name desired behaviors, anchor on dense terms, define explicit "shaping
  complete" criteria for the kicker.
- **Vocabulary co-building** during kicker sharpening: build `GLOSSARY.md` terms
  inline as the initiative is shaped (we already have GLOSSARY.md; could be more
  deliberate during sharpen).

## Gaps

mattpocock's triage is heavily human-in-the-loop; scaling to fully autonomous
agents risks infinite questioning loops (the explicit completion criteria help
mitigate). Future prototype: a "triage note" structure for the griller that
doubles as the intake classification input.

## Sources

- [writing-great-skills/SKILL.md](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-great-skills/SKILL.md)
- [triage/SKILL.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/triage/SKILL.md)
- [grill-with-docs/SKILL.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md)
- [skills README](https://github.com/mattpocock/skills)
