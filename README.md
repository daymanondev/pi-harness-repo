# pi-harness

[![Status: P1–P6 done](https://img.shields.io/badge/phase-P1%E2%80%93P6%20done-2ea44f)](#delivery-phases)
[![pi-package](https://img.shields.io/badge/pi-package-blue)](https://pi.dev)

A [pi](https://pi.dev) extension that makes
[`repository-harness`](https://github.com/hoangnb24/repository-harness) a
first-class citizen inside the pi coding agent: detect it, surface its durable
state in the footer, and (in later phases) drive install, dashboard, and the
`harness-observer` flow timeline behind **one** state-aware `/harness` command.

> **Status:** shipping. Phases 1–4 and 6 are implemented: passive detection
> and footer, enforcement gates (P2), the `/harness` overlay router + INSTALL
> view (P3), the DASHBOARD (matrix/stats/backlog/tools/drift/drill-down, P4),
> and the next-action footer + `before_agent_start` injection (P6). P5's
> TIMELINE tab shipped (live tail retired; observer onboarding still planned).
> The typed tools (P7) are designed but not yet built. See
> [Delivery phases](#delivery-phases) and
> [`pi-harness-design/DESIGN.md`](./pi-harness-design/DESIGN.md).

---

## What it does

`pi-harness` adds always-on awareness of repository-harness to every pi
session, with zero commands required:

- **Detect** whether repository-harness is installed and initialised in the
  current repo (CLI present? `harness.db` initialised? agent shim present?
  observer installed?).
- **Surface state in the footer** — story/trace/backlog counts when installed,
  or a "no harness" / "db missing" warning otherwise. Composes automatically
  with [`pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer)
  via the `setStatus("harness", …)` contract.
- **Hint widget** below the editor when the harness is absent or its database
  is not initialised, pointing to `/harness` to install or finish setup.

Detection is pure (injectable `exec` function), cached per-session with
mtime + TTL invalidation, and degrades cleanly — it never throws out of
`session_start`.

## Install

```bash
pi install git:github.com/<owner>/pi-harness-repo
```

The package ships only `extensions/`, `skills/`, and this README (enforced by
the `files` whitelist in `package.json` — see
[Decision 0008](./docs/decisions/0008-dual-identity-in-place-build.md)).

## Powerline integration

If you use `pi-powerline-footer`, add one block and the harness status lands in
your bar:

```json
{ "powerline": { "customItems": [
  { "id": "harness", "statusKey": "harness", "position": "left" }
]}}
```

## Bundled skills

- **`harness-intake-griller`** — a relentless intake interview that
  stress-tests a feature idea against the repository-harness domain model
  (input type, risk flags, lane, story shape, validation) and records durable
  `intake` / `story` rows inline as the classification crystallises. Adapted
  from [`grill-with-docs`](https://github.com/mattpocock/skills) for the
  harness vocabulary.

## Delivery phases

| Phase | Scope | Status |
| --- | --- | --- |
| **P1** | `detect.ts` + `session_start` footer/widget | ✅ done |
| **P2** | Flow enforcement gates (intake/trace via `tool_call`) | ✅ done |
| **P3** | `/harness` overlay router + INSTALL view | ✅ done |
| **P4** | DASHBOARD view (matrix · stats · backlog · tools · drift · drill-down) | ✅ done |
| **P5** | TIMELINE tab + `harness-observer` onboarding (live tail retired; `o`-key onboarding planned) | 🅿️ partial |
| **P6** | next-action footer + hint widget + `before_agent_start` injection | ✅ done |
| **P7** | typed tools (`harness_intake` / `harness_query` / `harness_trace`) | 🅿️ planned |

Full design, detection model, and open questions live in
[`pi-harness-design/DESIGN.md`](./pi-harness-design/DESIGN.md).

## Repository identity

This repo is deliberately dual-purpose:

- It **consumes** `repository-harness` (`AGENTS.md`, `docs/`, `scripts/`,
  `harness.db`) — this is the agent-workspace surface.
- It **produces** the `@earendil-works/pi-harness` pi package (`extensions/`,
  `skills/`, `package.json`) — this is the publish surface.

The `files` whitelist is the boundary between them. See
[Decision 0008](./docs/decisions/0008-dual-identity-in-place-build.md).

## License

MIT
