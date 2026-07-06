# Initiative: P4 — DASHBOARD view

- **Umbrella intake:** #13 (new_initiative, lane normal)
- **Design ref:** `pi-harness-design/DESIGN.md` §7 (DASHBOARD), §11 (phases)
- **Supersedes:** the P3 STATUS placeholder route in `extensions/harness/overlay.ts`
- **Closes:** backlog #2 (markdown↔durable drift pattern), via the Drift milestone

> This is a **roadmap** — a map of milestones, not a to-do list. It names the
> product areas and hard constraints; the tracer-bullet slices (US-010+) and
> their acceptance criteria live in the per-story packets, produced by the
> kicker's step 4/5. See ADR-0010 for the workflow model.

## Goal

Turn `/harness` from an install wizard (P3) into a **read-only window onto the
harness's own state** when harness is installed: what stories exist, how well
proven they are, what's open, what tools are equipped, and where the written
record has drifted from the durable record. Every byte shown is sourced from a
read-only `harness-cli query …` call or a local file read — the dashboard
**never mutates** harness state.

## Milestones

1. **Dashboard shell** — the container. The `/harness` router, when `detect()`
   says harness is installed & db-ok, routes to a tabbed DASHBOARD overlay
   (replacing the P3 STATUS placeholder). Owns: tab chrome + keybindings, the
   data-fetch spine (`harness-cli query …` per tab), refresh, Esc, theming. No
   tab content lives here beyond "press 1–4 / t".

2. **Proof matrix** — the headline tab. Renders `query matrix --numeric` as a
   table of stories with status + proof columns, color-coded by proof strength.
   This is the "is the harness loop actually producing evidence" view — the
   single most valuable screen in the dashboard.

3. **State & backlog visibility** — the remaining read-only query tabs bundled:
   counts (`query stats`), open backlog (`query backlog --open`), tools
   equipped (`query tools --json`). The "what is the current harness state"
   triplet. Grouped because each is a small single-command render.

4. **Drift visibility** — the cross-check tab. Reads markdown story status
   (and any drift-bearing docs) and the durable `harness.db` rows, surfaces
   mismatches with fix hints. This is what closes backlog #2 and the audit
   blind spot: drift becomes visible inside one session instead of
   accumulating silently.

TIMELINE (P5) is explicitly **out of scope** for this initiative — it is its
own later phase.

## Hard constraints

- **Read-only.** No `harness-cli` call made from the dashboard mutates state.
  If a tab needs a write, it is mis-scoped — push it to a later phase.
- **Pure renderers, impure lifecycle.** Tab content renderers are pure
  functions of parsed CLI output; only `index.ts`/the router does I/O. Mirrors
  the P3 split (ADR-0011).
- **Footer contract preserved.** The dashboard does not change the
  `setStatus("harness", …)` powerline contract; it adds an interactive view on
  top.
- **Degrade cleanly.** A failing `query …` call renders a dim error row in its
  tab, never throws out of the overlay.

## Open questions (resolve before the relevant slice ships)

1. **Stats/matrix parsing** (DESIGN §13.3) — `query stats` and `query matrix`
   have no `--json`; `query tools` does. Parse the fixed-column table in a
   thin parser, or push `--json` upstream into repository-harness? Decide at
   the shell slice (M1) since the parser shape is shared by M2/M3.
2. **Multi-repo / cwd** (DESIGN §13.4) — does the dashboard follow pi's
   `ctx.cwd` on every open, or cache per session? P3 already chose one; mirror
   it or revisit. Resolve at M1.
3. **Drift source of truth** — the Drift tab compares markdown vs durable, but
   *which* markdown fields and *which* durable tables are authoritative? (P2's
   Gate B′ already does one drift check — reuse its comparison, or generalize
   it into a shared pure function?) Resolve at M4.
4. **Matrix `--numeric` availability** — DESIGN §7 assumes `query matrix
   --numeric`. Confirm it exists in the shipped CLI version before M2; if not,
   parse the default `query matrix` table instead.
