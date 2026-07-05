# pi-harness — Design

> A pi extension that makes [`repository-harness`](https://github.com/hoangnb24/repository-harness)
> a first-class citizen inside the pi coding agent: detect it, install it,
> visualize its durable state, and (optionally) surface the
> [`harness-observer`](https://github.com/hoangnb24/repository-harness) flow
> timeline — all behind **one** command.

**Status:** design (not yet implemented).
**Package home (planned):** a new standalone repo `pi-harness`, distributed as
`pi install git:github.com/<owner>/pi-harness` (or `npm:<scope>/pi-harness`).

---

## 1. The one design idea: a single, state-aware `/harness`

There is exactly **one** slash command: `/harness`. What it shows depends on
what `detect()` finds in the current working directory:

```
/harness
  │
  ├─ detect() → HarnessState
  │
  ├─ NOT installed          →  INSTALL view     (run the harness installer)
  ├─ CLI present, no db     →  INSTALL view     (offer `harness-cli init`)
  ├─ Installed, no observer →  DASHBOARD  + "Enable flow logging" prompt
  └─ Fully installed        →  DASHBOARD        (matrix · stats · backlog · tools · timeline)
```

Why one command instead of `/harness`, `/harness install`, `/harness timeline`,
etc.:

- It mirrors how [`pi-fusion`](https://pi.dev/packages/@leblancfg/pi-fusion) does
  it — `/fusion` is the single entrypoint; everything else is in-pane
  navigation via keys (`1-9`, `p`, `Esc`). Sub-actions live *inside* the overlay,
  not as a tree of slash commands.
- It removes the user's burden of "which command do I want?" — the extension
  already knows the repo's state and shows the only view that makes sense.
- Secondary actions (install, enable observer, refresh, switch tab) become
  **keys inside the overlay** (`i` install, `o` observer, `r` refresh, `t`
  timeline tab). They never need their own command.

The overlay is built with `ctx.ui.custom({ overlay: true })`, the same floating
modal API pi-fusion's settings pane uses. Navigation between views is internal
component state, not new commands.

---

## 2. Package layout

Standalone repo `pi-harness`, matching pi-fusion's `fusion.ts / index.ts / ui.ts`
split (pure logic / lifecycle / TUI):

```
pi-harness/
  package.json                 # "pi": { "extensions": ["./extensions/harness/index.ts"] }
  README.md
  extensions/harness/
    index.ts                   # entry: session_start detect, footer/widget, registers /harness
    detect.ts                  # pure: HarnessState detection (cli / shim / db / observer / stats)
    overlay.ts                 # the state-aware /harness overlay (router between views)
    views/
      install.ts               # INSTALL view (flags + protected-path detection + runs installer)
      dashboard.ts             # DASHBOARD view (matrix/stats/backlog/tools, tabbed)
      timeline.ts              # TIMELINE tab (reads events.jsonl, live tail)
    runner.ts                  # thin wrapper around pi.exec for harness-cli + installer
    ui/                        # shared TUI primitives (Table, StatRow, DiffPill) — @earendil-works/pi-tui
  docs/DESIGN.md               # this file
```

`package.json` (pi packages are installed via `pi install`):

```json
{
  "name": "@<scope>/pi-harness",
  "keywords": ["pi-package"],
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  },
  "pi": {
    "extensions": ["./extensions/harness/index.ts"],
    "image": "./docs/preview.png"
  }
}
```

`peerDependencies` (not `dependencies`) for the pi core packages — pi bundles
those and loads packages with separate module roots.

---

## 3. Detection model (`detect.ts`)

One pure function, cached per-session and invalidated on file writes under
`scripts/bin/` and `harness.db`. Returns:

```ts
interface HarnessState {
  cwd: string;
  cliInstalled: boolean;       // <cwd>/scripts/bin/harness-cli exists
  cliVersion: string | null;   // `harness-cli --version`
  dbInitialized: boolean;      // <cwd>/harness.db exists
  shimPresent: boolean;        // AGENTS.md contains <!-- HARNESS:BEGIN -->
  claudeShimPresent: boolean;  // CLAUDE.md contains <!-- HARNESS:BEGIN -->
  observerInstalled: boolean;  // scripts/bin/harness-cli.real exists OR .harness-observer/ exists
  stats?: {                    // from `harness-cli query stats` (parsed)
    intakes: number; stories: number; decisions: number;
    backlog_items: number; traces: number;
  };
  error?: string;              // if any probe failed, surfaced in the overlay
}
```

Signals and probes:

| field | signal | probe |
|---|---|---|
| `cliInstalled` | `<cwd>/scripts/bin/harness-cli` | `fs.access` |
| `cliVersion` | stdout of `--version` | `pi.exec("scripts/bin/harness-cli",["--version"])` |
| `dbInitialized` | `<cwd>/harness.db` | `fs.access` |
| `shimPresent` | `<!-- HARNESS:BEGIN -->` marker in `AGENTS.md` | read + `includes()` |
| `observerInstalled` | `scripts/bin/harness-cli.real` **or** `.harness-observer/events.jsonl` | `fs.access` |
| `stats` | `query stats` table | parse the 5-column row |

> **Branching rule for `/harness`:** `!cliInstalled || !dbInitialized` → INSTALL
> view. Otherwise → DASHBOARD view. (`shimPresent` is informational; a user may
> legitimately have the CLI without the shim.)

The 5 columns of `query stats` are the durable-layer summary pi users will
recognize:

```
=== Harness Stats ===
intakes  stories  decisions  backlog_items  traces
-------  -------  ---------  -------------  ------
0        0        0          0              0
```

### Why auto-run on `session_start` (decided)

The footer needs current state. Two quick probes at startup — `--version` and
`query stats` — take milliseconds on a local `<1MB` `harness.db`. This is the
same pattern `pi-fusion`/`status-line.ts` use. If detection throws (no CLI,
corrupt db), the footer shows a muted "🪢 —" and `/harness` still opens to the
INSTALL view. Failure is always a clean degrade, never a crash.

---

## 4. Passive footer + widget (`session_start`)

Always-on, zero command needed. Publishes through `ctx.ui.setStatus()` so it
composes automatically with
[`pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer)'s
`customItems` contract — no coupling between the two extensions.

```ts
pi.on("session_start", async (_e, ctx) => {
  if (!ctx.hasUI) return;                 // no-op in print/json mode
  const st = await detectHarness(ctx.cwd);
  const t = ctx.ui.theme;

  if (st.cliInstalled && st.dbInitialized && st.stats) {
    const s = st.stats;
    ctx.ui.setStatus("harness",
      t.fg("accent", "🪢 ") +
      t.fg("dim", `${s.stories} stories · ${s.traces} traces · ${s.backlog_items} backlog`));
  } else if (!st.cliInstalled) {
    ctx.ui.setStatus("harness", t.fg("warning", "🪢 no harness"));
    ctx.ui.setWidget("harness-hint",
      ["repository-harness not found in this repo.",
       "Run /harness to install it."], { placement: "belowEditor" });
  } else if (!st.dbInitialized) {
    ctx.ui.setStatus("harness", t.fg("warning", "🪢 cli present, db missing"));
    ctx.ui.setWidget("harness-hint",
      ["Harness CLI is installed but the database isn't initialized.",
       "Run /harness to finish setup."], { placement: "belowEditor" });
  }
});
```

Powerline users add one block to settings and the harness status lands in their
bar with no other change:

```json
{ "powerline": { "customItems": [
  { "id": "harness", "statusKey": "harness", "position": "left" }
]}}
```

---

## 5. The `/harness` overlay (`overlay.ts`)

A single registered command routes into a state-aware overlay:

```ts
pi.registerCommand("harness", {
  description: "Open repository-harness (install or dashboard)",
  handler: async (_args, ctx) => {
    if (ctx.mode !== "tui") { ctx.ui.notify("Open /harness in interactive mode", "info"); return; }
    const st = await detectHarness(ctx.cwd);
    const showInstall = !st.cliInstalled || !st.dbInitialized;
    await ctx.ui.custom<void>((tui, theme, keybindings, done) =>
      new HarnessOverlay({ state: st, view: showInstall ? "install" : "dashboard",
                            cwd: ctx.cwd, tui, theme, keybindings, onDone: done }),
      { overlay: true, overlayOptions: { width: "80%", margin: 2 } }
    );
  },
});
```

`HarnessOverlay` is one component that owns the current view and re-renders on
key input. Internal transition table:

```
key        from            to              action
i          install         (stay)          run install with current flags, then → dashboard
r          any             (stay)          re-detect, re-render
o          dashboard       timeline        enable + open observer (see §8)
1..4       dashboard       matrix/stats/   switch tab
                           backlog/tools
t          dashboard       timeline        switch to timeline tab
Esc        any             close           done()
```

Every view renders into the same overlay frame — no new commands, no screen
clearing (overlay mode leaves prior content intact).

---

## 6. INSTALL view (when harness is absent or db missing)

### 6.1 Layout

```
┌─ repository-harness · install ─────────────────────────────┐
│ Target: /Users/…/my-project                                 │
│                                                             │
│ Detected state                                              │
│   AGENTS.md      : absent                                   │
│   docs/          : absent                                   │
│   scripts/       : absent                                   │
│   → fresh install allowed                                   │
│                                                             │
│ Mode                                                        │
│  (•) Fresh            curl … | bash -s -- --yes             │
│  ( ) Merge into exist curl … | bash -s -- --merge --yes     │
│  ( ) Override + backup curl … | bash -s -- --override --yes │
│                                                             │
│ Options                                                     │
│  [x] Also add Claude shim   (--claude)                      │
│  [ ] Dry run first           (--dry-run)                    │
│  [ ] Then init database      (harness-cli init)             │
│                                                             │
│ [i install]  [r refresh]  [Esc cancel]                      │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Protected-path awareness

The installer refuses if `AGENTS.md`, `docs/`, or `scripts/` already exist and
no conflict flag is set. The overlay pre-runs the **same** existence checks
(`detect()` already knows) and **disables** modes the installer would reject, so
the user cannot pick an invalid combination:

| Detected | Fresh | Merge | Override |
|---|---|---|---|
| clean dir | ✅ enabled | (n/a) | (n/a) |
| `AGENTS.md` or `docs/` or `scripts/` present | ❌ disabled | ✅ enabled | ✅ enabled |

### 6.3 Execution

`runner.ts` runs the exact command from repository-harness's README via
`pi.exec`, streaming progress into the overlay:

```ts
const url = "https://raw.githubusercontent.com/hoangnb24/repository-harness/main/scripts/install-harness.sh";
const flags = mode === "merge"    ? ["--merge","--yes"]
            : mode === "override" ? ["--override","--yes"]
            :                       ["--yes"];
if (claude)  flags.push("--claude");
if (dryRun)  flags.push("--dry-run");

const install = await pi.exec("bash", ["-c",
  `curl -fsSL "${url}?$(date +%s)" | bash -s -- ${flags.join(" ")}`],
  { cwd, signal: ctx.signal });

if (!dryRun && !install.code && initDb) {
  await pi.exec("scripts/bin/harness-cli", ["init"], { cwd });
}
// re-detect; if now installed, transition overlay to dashboard view
```

The installer itself downloads the prebuilt `harness-cli` binary, verifies its
`.sha256`, writes `AGENTS.md` + `docs/` + `scripts/`, and appends the durable
rules to `.gitignore`. The extension does **not** reimplement any of that — it
just drives the official script and reports its output.

---

## 7. DASHBOARD view (when harness is installed)

Tabbed, all data sourced from `harness-cli query …`:

```
┌─ repository-harness · dashboard ────────────────────────────┐
│ cli 0.1.11 · db ok · observer ON     [1 matrix] 2 stats 3 backlog 4 tools  t timeline
├─ 1 · Proof matrix (query matrix --numeric) ─────────────────┤
│ id       title              status   unit  intg  e2e  plat   │
│ US-001   Auth login         done      1     1     0    0  ✓  │
│ US-014   Manager roles      in-prog   1     0     0    0  ⚠  │
│ …                                                           │
├─ 2 · Counts (query stats) ──────────────────────────────────┤
│ intakes 14 · stories 22 · decisions 5 · backlog 3 · traces 31│
├─ 3 · Open backlog (query backlog --open) ───────────────────┤
│ • add e2e for roles      predicted: catch regressions       │
│ • cache tool presence    risk: tiny                          │
├─ 4 · Tools equipped (query tools --json) ───────────────────┤
│ impact-analysis  gitnexus (present) · c3 (missing)          │
└─────────────────────────────────────────────────────────────┘
 [1-4 tabs] [t timeline] [o observer] [r refresh] [Esc close]
```

Color coding via `theme.fg`: `success` for verified/`1`, `warning` for weak
proof/`0`, `error` for failures, `dim`/`muted` for secondary text — the same
palette `renderResult` examples in `extensions.md` use.

### Data sources per tab

| tab | command | parse |
|---|---|---|
| matrix | `query matrix --numeric` | table → rows of `{id,title,status,unit,integ,e2e,plat}` |
| stats | `query stats` | single 5-col header row |
| backlog | `query backlog --open` | bullet rows |
| tools | `query tools --json` | native JSON — preferred, structured `{name,capability,kind,status}` |

> `query stats` and `query matrix` have **no `--json` flag** (only `query tools`
> does). For those two we parse the fixed-column table. If parsing ever gets
> fragile, fall back to `query sql "<select>"` against `harness.db`, but treat
> that as a last resort since it couples to schema versions. Document this in
> `runner.ts`.

---

## 8. TIMELINE tab (productizing `harness-observer`)

The observer is currently a personal spike that wraps `harness-cli` and writes
one JSONL line per call. This design promotes it to an in-dashboard feature
**without changing its semantics** — it stays a *companion*, never an inbound
harness tool, exactly as its README insists.

### 8.1 If observer not installed

The dashboard shows a one-line prompt and an `o` key:

```
Flow logging is OFF. Press o to enable (wraps scripts/bin/harness-cli transparently).
```

`o` runs `harness-observer/scripts/install.sh`, which renames the real binary to
`harness-cli.real` and drops the logger in its place. The extension just invokes
that script; it does **not** call `harness-cli tool register` (that would
distort the registry semantics the observer deliberately avoids).

### 8.2 Timeline view

Reads `.harness-observer/events.jsonl` and renders the **flow** the observer
exists to capture:

```
┌─ harness flow (last 50 calls) ──────────────────────────────┐
│ 10:11:30 ✗ query matrix           411ms  exit 1             │
│ 10:11:37 ✓ --version               9ms  exit 0             │
│ 10:32:00 ✓ intake #3              340ms  intake: 2 → 3      │
│ 10:33:12 ✓ story add US-014       210ms  story:  6 → 7      │
│ 10:34:55 ✗ story verify US-014     8.0s  exit 1             │
│ …                                                           │
└─────────────────────────────────────────────────────────────┘
 [j/k scroll] [↵ inspect] [/ filter] [r refresh] [Esc back]
```

The headline column is the **`db_before → db_after` diff** (`intake: 2 → 3`):
the exact "which command changed which table" insight the observer README calls
the connection between flow and state. Color by `exit` (`error` for ≠0,
`success` for 0, `dim` for the diff). `↵` opens a detail pane with full
`stdout`/`stderr` (truncated to 500 chars by the logger).

### 8.3 Live tail (the payoff)

Use `fs.watch(".harness-observer/events.jsonl")` to append new events as the
agent works, so the user watches harness calls land in real time — turning
"learn how the agent uses harness" into a visible loop. Re-validate the file
size and re-read the tail on each change event (watchers can fire coalesced).

### 8.4 Optional pi-side enrichment (later)

Hook `pi.on("tool_call")` for `bash` calls whose command includes
`harness-cli`, and tag the matching event with the current pi turn index from
`ctx.sessionManager`. That bridges pi's turn model and harness's command model
(neither captures the link alone) and lets the timeline say *"this trace came
from turn 4."* Not in v1; noted for a later phase.

---

## 9. Agent awareness & flow enforcement

### 9.1 Live-state injection (lightweight)

pi already auto-loads `AGENTS.md` as a context file, so the **static** harness
instructions are covered — do not duplicate them. What `AGENTS.md` cannot give
is **live** state. Inject only the dynamic summary, invisibly:

```ts
pi.on("before_agent_start", async (_e, ctx) => {
  const st = await detectHarness(ctx.cwd);
  if (!st.cliInstalled || !st.dbInitialized || !st.stats) return;
  return { message: {
    customType: "harness-state",
    display: false,                                    // to LLM only, not the TUI
    content:
      `Live repository-harness state: ${st.stats.stories} stories, ` +
      `${st.stats.backlog_items} open backlog item(s), ` +
      `${st.stats.traces} traces recorded. ` +
      `Use scripts/bin/harness-cli for intake/trace/query. ` +
      `Observer recording: ${st.observerInstalled ? "yes" : "no"}.`,
  }};
});
```

Keep this to a few lines — it is context budget, not a manual. The full harness
model still lives in `AGENTS.md`/`docs/HARNESS.md`.

### 9.2 Flow enforcement (strict — the load-bearing feature)

**Problem this exists to solve.** An agent can satisfy the harness reading
list, hit a failing `query matrix` (db missing), fix the environment, and then
ship the deliverable while **never** recording an intake, trace, or backlog
item. The footer (§4) makes harness state *visible*; visibility is not
enforcement. The Task Loop in `docs/HARNESS.md` is opt-in — nothing blocks
implementation without an intake, and nothing blocks "done" without a trace.
Field evidence (the first implementation attempt of this very extension)
confirmed it: the agent read every doc, ran `query matrix`, saw it fail,
initialized the db, and then wrote code with **zero** intake and **zero** trace.
This subsection turns the loop from documentation into rails, using pi's
**blockable** `tool_call` event and the injectable `before_agent_start`.

Enforcement is **on by default** for any repo where `cliInstalled &&
dbInitialized`. It is hard-block by default (the agent cannot proceed until the
gate clears); see §13.6 for the bypass UX tradeoff.

#### Gate A — Intake gate (blocks implementation, hard)

On `tool_call`, intercept mutation tools: `write`, `edit`, and `bash` calls
whose command is **not** a `harness-cli` read/query/init command. If the repo
is a harness repo and no intake has been recorded this session, return
`{ block: true, reason }`. The reason always carries the exact command to run
so the gate is a guide, not a wall:

```ts
pi.on("tool_call", (event, ctx) => {
  const st = sessionState.get(ctx.cwd);            // populated by detectHarness()
  if (!st.cliInstalled || !st.dbInitialized) return; // only gate real harness repos
  if (event.toolName === "bash" && isHarnessCliCall(event.input.command)) return; // never block harness-cli itself
  if (event.toolName !== "write" && event.toolName !== "edit" && event.toolName !== "bash") return;

  if (!st.intakeRecorded) {
    return { block: true, reason:
      "Repository-harness flow gate: record an intake BEFORE implementing. " +
      "Run: scripts/bin/harness-cli intake --type <new_spec|spec_slice|change_request|" +
      "new_initiative|maintenance_request|harness_improvement> --lane <tiny|normal|high-risk> " +
      "--summary <\"...\"> --flags <\"...\">  then re-run this edit. " +
      "(`query intakes` shows no row for this session.)" };
  }
});

// clear the gate the moment an intake actually lands
pi.on("tool_result", (event, ctx) => {
  if (event.toolName === "bash"
      && /harness-cli\s+intake\b/.test(event.input.command)
      && !event.isError) {
    sessionState.get(ctx.cwd).intakeRecorded = true;
  }
});
```

`intakeRecorded` is seeded each `before_agent_start` by diffing `query intakes`
count against the previous turn, so a human-recorded intake also clears the
gate.

#### Gate A′ — Precondition gate (blocks when `query matrix` would fail)

The exact shortcut this feature exists to kill: `query matrix` fails because
the db is missing, so the agent initializes the db and jumps to code — still
skipping intake. When `dbInitialized` is false, **all** mutation tools block
with a route to init, never to editing:

> "Repository-harness db is not initialized. Run
> `scripts/bin/harness-cli init` then `migrate`, re-run `query matrix` to
> confirm exit 0, **then record an intake** (`intake --type … --lane …`). Do
> not start implementation."

#### Gate B — Trace gate (nags before "done", soft)

We cannot reliably detect the agent's final turn, so the trace gate is a
persistent reminder rather than a block. `before_agent_start` appends to the
§9.1 injection, every turn, until `query traces` shows a new row:

> "Done Definition (docs/HARNESS.md) requires a recorded trace before this
task is complete. No trace has been recorded this session. Run
> `scripts/bin/harness-cli trace --summary … --intake <id> --read … --changed …
> --outcome … --friction …`."

The footer (§4) also shows a `⚠ no trace` badge in the same state so the human
can see the gate is unresolved.

#### Gate C — Friction capture prompt (non-blocking)

When a `bash` `tool_result` exits non-zero or an `edit` is retried, raise a
one-line widget: "Hit friction? Record it: `scripts/bin/harness-cli backlog
add --title <…> --pain <…>`." This productizes the friction loop
(`docs/HARNESS.md` step 9) without forcing it.

#### Why this is promoted to a core phase

The original design assumed agents follow `AGENTS.md`/`HARNESS.md` because the
docs say so. Evidence disproved that. Visibility (footer) did not change
behavior; only a blockable gate changes behavior. Enforcement is therefore a
core runtime feature (P2), delivered immediately after detection (P1), not a
far-future phase. The detection model (§3) grows one tracked field,
`intakeRecorded`, seeded from `query intakes`.

---

## 10. Optional v2: typed custom tools

Give the agent validated access so it stops hand-writing `harness-cli …`:

```ts
pi.registerTool({
  name: "harness_intake",
  label: "Harness intake",
  description: "Record a feature intake classification via repository-harness",
  promptSnippet: "Classify work into a harness lane (tiny/normal/high-risk)",
  parameters: Type.Object({
    type: StringEnum(["new_spec","spec_slice","change_request","new_initiative",
                      "maintenance_request","harness_improvement"]),
    summary: Type.String(),
    lane: StringEnum(["tiny","normal","high-risk"]),
  }),
  async execute(_id, p, _s, _u, ctx) {
    const r = await pi.exec("scripts/bin/harness-cli",
      ["intake","--type",p.type,"--lane",p.lane,"--summary",p.summary], { cwd: ctx.cwd });
    return { content: [{ type:"text", text: r.stdout || r.stderr }],
             details: { exit: r.code } };
  },
});
```

Plus `harness_query` (wraps `query matrix|stats|backlog|tools`) and
`harness_trace`. Only ship these once the dashboard is solid; they add system
prompt weight.

---

## 11. Delivery phases

| phase | scope | outcome |
|---|---|---|
| **P1** | `detect.ts` + `session_start` footer/widget | always-on status, composes with powerline |
| **P2** | **Flow enforcement** — intake gate (§9.2 Gate A/A′) + trace gate (B) + friction prompt (C) via `tool_call` / `before_agent_start` | harness Task Loop becomes **non-skippable**; kills the "query matrix failed → skip to code" shortcut |
| **P3** | `/harness` overlay router + **INSTALL view** | one command onboards a new repo end-to-end |
| **P4** | **DASHBOARD view** (4 tabs) | "visualize & understand harness" core |
| **P5** | **TIMELINE tab** + observer install + live tail | productizes `harness-observer` |
| **P6** | `before_agent_start` live-state injection (§9.1) | agent sees current counts |
| **P7** | typed tools (`harness_intake/query/trace`) | ergonomic agent-driven harness |

P1–P2 are the always-on foundation: **visibility** (footer) **+ enforcement**
(gates). P3–P4 then deliver the two v1 priorities chosen: **understand**
(dashboard) and **adopt** (install wizard), behind a single command. P5 is what
turns the observer from a personal tool into a feature. Enforcement is
promoted to P2 — ahead of the overlay — because field evidence showed the
harness loop is skipped whenever it is merely documented; only a blockable gate
changes that.

---

## 12. Decisions captured

| decision | choice | rationale |
|---|---|---|
| command surface | **single state-aware `/harness`** | matches pi-fusion; removes "which subcommand?" burden |
| package home | **new standalone repo `pi-harness`** | keeps repository-harness agent-agnostic; clean `pi install` |
| startup behavior | **auto-detect on `session_start`** | footer needs live state; ~2 cheap CLI calls |
| v1 priorities | **dashboard+footer (understand)** + **install wizard (adopt)** | user-selected |
| observer | **in-dashboard feature, not inbound tool** | preserves its documented semantics |
| footer integration | **`setStatus` only** | composes with pi-powerline-footer's `customItems`, zero coupling |
| system prompt | **inject live state only**, never static docs | `AGENTS.md` already covers static; avoid duplication |
| flow enforcement | **hard-block intake/trace gates via `tool_call`** (§9.2), on by default for harness repos | field evidence: agents skip the harness loop when it is opt-in; the footer (visibility) alone did not change behavior — only a blockable gate does |

---

## 13. Open questions (resolve before the relevant phase ships)

1. **Installer source pinning** — always `main`, or read a release tag like the
   CLI does (`scripts/harness-cli-release-tag`)? Pinning to a tag is safer for
   reproducibility.
2. **Windows** — the README has a PowerShell installer. Should the overlay detect
   `process.platform === "win32"` and run `install-harness.ps1`, or is macOS/Linux
   enough for v1?
3. **Stats parsing resilience** — parse the `query stats` table, or push a
   `--json` flag upstream into repository-harness? The latter removes a fragility
   for everyone, not just this extension.
4. **Multi-repo sessions** — the observer is `cwd`-aware via `HARNESS_OBSERVER_DIR`.
   Should `/harness` follow pi's `ctx.cwd` on every open, or cache per session?
5. **Enforcement bypass UX (§9.2)** — should the intake gate be **hard-block**
   (agent cannot proceed at all until `intake` lands) or **soft-block** (block
   with a one-line `/harness` bypass the user can override)? Hard-block is
   stricter and is the default; soft-block avoids trapping a stuck agent on
   tasks where intake genuinely does not apply (e.g. reading/exploring). Decide
   before P2 ships.
6. **Enforcement scope** — should the gate fire only for `write`/`edit`, or
   also for `bash` commands that mutate the repo (e.g. `git commit`, `npm
   install`)? Broad scope is stricter; narrow scope is less noisy.

---

## Appendix A — pi extension APIs this design uses

| capability | API | used for |
|---|---|---|
| command | `pi.registerCommand("harness", …)` | the single entrypoint |
| overlay | `ctx.ui.custom(fn, { overlay: true, overlayOptions })` | install + dashboard + timeline panes |
| footer status | `ctx.ui.setStatus("harness", …)` | passive state, powerline-compatible |
| widget | `ctx.ui.setWidget("harness-hint", […], {placement:"belowEditor"})` | install nudge |
| notify | `ctx.ui.notify(msg, "info"\|"warning"\|"error")` | post-install confirmations |
| shell | `pi.exec(cmd, args, { cwd, signal })` | run installer + `harness-cli` |
| system prompt | `pi.on("before_agent_start", …)` → `{ message: {customType,display:false,…}}` | live-state injection |
| startup | `pi.on("session_start", …)` | detect + footer |
| custom tools (v2) | `pi.registerTool({ parameters: Type.Object(…) })` | typed harness access |
| file watch | `node:fs.watch` | live timeline tail |
| theming | `ctx.ui.theme.fg("accent"\|"success"\|"warning"\|"error"\|"dim", text)` | color-coded rows |

## Appendix B — reference extensions studied

- **pi-fusion** (`@leblancfg/pi-fusion`) — single `/fusion` command → overlay
  settings pane; `before_agent_start` injection; `setStatus` bar; `appendEntry`
  archive. The closest architectural model for this extension.
- **pi-powerline-footer** (`nicobailon/pi-powerline-footer`) — `setFooter`
  replacement + `customItems` reading other extensions' `setStatus` keys. Defines
  the cross-extension status contract this design targets.

## Appendix C — detection signals recap

```
repository-harness installed   scripts/bin/harness-cli exists  +  <!-- HARNESS:BEGIN --> in AGENTS.md
database initialized            harness.db exists
harness-observer installed      scripts/bin/harness-cli.real exists  OR  .harness-observer/events.jsonl
claude shim present             <!-- HARNESS:BEGIN --> in CLAUDE.md
```
