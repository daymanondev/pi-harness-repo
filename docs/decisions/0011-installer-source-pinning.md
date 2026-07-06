# 0011 Installer source pinning — `main` + cache-bust for v1, ref as a constant

Date: 2026-07-06

## Status

Accepted

## Context

DESIGN §13.1 (open question, to resolve "before/within P3") asks: should the
`/harness` INSTALL view fetch `install-harness.sh` from `main`, or pin a
release tag like the CLI does (`scripts/harness-cli-release-tag`)?

P3 (US-006) drives the official installer end-to-end:

```
curl -fsSL "<url>?$(date +%s)" | bash -s -- <flags>
```

Pinning to a release tag is safer for reproducibility — `main` can move under
us — but two facts blocked a blind tag pin:

1. The install-harness.sh URL convention and the release-tag scheme live in the
   upstream `repository-harness` repo (`hoangnb24/repository-harness`), which is
   **not** checked out here. We cannot verify the tag name/shape from this repo.
2. DESIGN §6.3 already chose `main` with a `?$(date +%s)` cache-bust, matching
   the curl line the installer itself documents.

Guessing a tag (`v0.1.11`, `release/…`) risks a 404 that breaks every fresh
install — a worse failure mode than a moving `main`.

## Decision

For v1, pin to **`main`** with the `?$(date +%s)` cache-bust, exactly as
DESIGN §6.3 specifies, **and** expose the ref as a single exported constant
`INSTALLER_REF` in `extensions/harness/overlay.ts`. The installer's own
`.sha256` binary verification remains the integrity gate; the URL ref only
chooses *which* copy of the script we bootstrap from.

A verified release tag becomes a **one-line** change to `INSTALLER_REF` once the
upstream tag URL is confirmed — no command-builder or wiring edits.

Windows (§13.2) stays deferred: the overlay runs the bash installer on
macOS/Linux only for now; `process.platform === "win32"` handling is a
follow-up.

## Consequences

- **Reproducibility** is slightly weaker than a hard tag pin: `main` can move.
  Mitigations: the `$(date +%s)` cache-bust guarantees we never serve a stale
  CDN-cached script, and the installer verifies the downloaded binary's
  `.sha256`, so a tampered/moved `main` fails loudly rather than silently.
- **Upstream coupling**: a breaking change to `install-harness.sh` on `main`
  would surface as an install failure. Acceptable for an early-phase extension
  with no external users yet; revisit before P3 is advertised broadly.
- **Follow-up**: once `hoangnb24/repository-harness` publishes a tagged release
  URL, flip `INSTALLER_REF` to that tag and re-record this decision as
  "superseded".
