# 0014 Dashboard dispatch policy — in-session sendUserMessage permitted; pane-spawn deferred (US-028)

Date: 2026-07-08

## Status

Accepted (in-session clause). The pane-spawn clause remains **deferred** —
unblocking US-028 requires extending this record with a launch-surface
decision, which is not made here.

## Context

US-023 established the dashboard as **read-only / advisory-only** (the US-014
Command-Query invariant) and satisfied backlog #5 ("act on what it shows")
*without* relaxing it: the dashboard *routes* (tells you grill vs implement +
the exact prompt) but "the operator opens the pane and runs it." That
conclusion explicitly equated **dispatch** with **pane spawn** — "If
dashboard-driven pane spawn is later wanted, US-028 + ADR-0014 handle it" —
and named US-028 (spawn) as "the only slice that would require relaxing
read-only."

US-027 re-opened this. The operator's real workflow is to tell the agent
"please check @AGENTS.md, follow the harness flow and start with backlog #N"
and then **triage with the agent** (review + verify + decide close / promote /
reframe through discussion). Advisory command skeletons (the original US-027
c/p/e design) are pointless under that workflow — closing always goes through
the agent anyway. The question became: can the dashboard hand a list item to
the agent in the **current session**, without spawning a pane?

Source check of the pi extension API found a third path the US-023 reasoning
did not consider: `ExtensionAPI.sendUserMessage(content)` ("always triggers a
turn") — in-session dispatch. No new pane, no new surface, no write to
`harness.db`.

## Decision

1. **In-session `pi.sendUserMessage` is permitted from the `/harness` overlay.**
   A dashboard list item (backlog row or matrix/story row) may be handed to the
   current agent session by closing the overlay and calling
   `pi.sendUserMessage(prompt)`, where `prompt` mirrors the operator's manual
   idiom ("please check @AGENTS.md, follow the harness flow and …"). The
   resulting turn is indistinguishable from one the operator typed, so the
   normal intake / trace discipline applies.

2. **This does NOT relax the US-014 read-only invariant re: durable state.**
   The dashboard still writes nothing to `harness.db` and runs no mutating
   `harness-cli` command from the render/input path. `sendUserMessage` composes
   a user message — exactly what the operator could have typed — and hands it
   to the agent, which then acts deliberately (with intake + trace). The
   invariant is narrowed from "advisory-only" to "advisory-only **except**
   in-session `sendUserMessage`."

3. **Pane-spawn dispatch remains deferred (US-028).** Spawning a new mux
   pane / surface (cmux/tmux/zellij/wezterm) or an out-of-session worker from
   the dashboard is still NOT permitted; it needs the launch-surface decision
   US-028 was walled for, to be appended here. US-027 is in-session only.

Routing: `dispatchPromptFor(target, grilledStoryIds)` (pure, in `dashboard.ts`)
builds the prompt — backlog → a triage prompt; matrix/story → reuses
`nextActionFor` (ungrilled → grill, grilled → implement). US-023's advisory
text in the detail pane is unchanged; this is the *action* layer on top.

## Alternatives Considered

1. **Advisory-only (US-023 status quo, original US-027 c/p/e design).** The
   dashboard shows command skeletons the operator copies. Rejected: under the
   operator's actual workflow, close/promote/reframe always go through the
   agent anyway, so the advisory text is redundant ceremony — "I can see the
   command but still have to tell the agent."
2. **Pane-spawn dispatch (US-028).** The dashboard spawns a mux pane per item.
   Deferred: crosses the launch-surface line, needs its own decision, and is
   heavier than the in-session path that now exists.
3. **In-session `sendUserMessage` (chosen).** One keypress hands the item to
   the current agent; no new surface, no durable write, no ADR for launch. The
   agent triages / grills / implements through the normal loop.

## Consequences

Positive:

- The dashboard becomes a **control surface**, not just a gauge — backlog #5
  is closed for real (act on what it shows, in one keypress).
- The pattern generalizes across list tabs (backlog + matrix/story), so the
  grill→implement core loop is one-key from the dashboard.
- The agent receives an ordinary user message, so intake/trace gates fire
  normally — no bypass of the harness discipline.

Tradeoffs:

- US-023's "advisory-only" rule is **narrowed**, not repealed — a future agent
  must read this record to know why the dashboard dispatches in-session but
  still does not spawn panes.
- `sendUserMessage` from a command handler triggers a turn; if the agent is
  already streaming, the message queues (deliverAs). The slice calls it only
  after the overlay closes (idle), so this is not exercised yet.

## Follow-Up

- **US-028 (pane-spawn)** remains deferred. If dashboard-driven multi-pane
  orchestration is later wanted, extend this record with the launch-surface
  decision; do not silently spawn panes.
- If `sendUserMessage`-from-command proves to queue oddly under streaming,
  revisit the timing (the `before_agent_start` injection seam is the
  alternative, but it fires only on the next turn).
