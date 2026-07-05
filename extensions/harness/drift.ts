// drift.ts — markdown ↔ durable drift detection (DESIGN.md §9.2 Gate B′).
//
// Pure contract (same as detect.ts): imports NO pi types and NO pi runtime.
// The only side-effecting surface (running `harness-cli` + reading markdown
// files) is injected as `exec` and a `readFile` hook. That keeps detectDrift
// unit-testable with a stub exec + fixture markdown map.
//
// Why this exists: `harness-cli audit` only reads the durable layer, so it
// reports "perfect" while `docs/stories/*.md` and the `story` table silently
// disagree. This module draws the missing arrow between the two boxes.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ExecFn } from "./detect.js";

/** Story status enum (durable `story.status`, underscore form). */
export const STORY_STATUSES = [
  "planned",
  "in_progress",
  "implemented",
  "changed",
  "retired",
] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

/** Kinds of drift the checker can report. */
export type DriftKind =
  | "status_mismatch" // durable.status ≠ markdown ## Status
  | "orphan_markdown" // file exists, no durable row
  | "orphan_durable" // durable row (planned/in_progress/implemented), no file
  | "missing_evidence"; // markdown Evidence section empty/stale

export interface DriftRecord {
  storyId: string;
  durable: string; // durable status, or "(no row)"
  markdown: string; // markdown status, or "(no file)"
  kind: DriftKind;
  detail?: string;
}

/** Minimal fs hook so tests can supply fixture markdown content. */
export type ReadDirFn = (path: string) => Promise<string[]>;
export type ReadFileFn = (path: string) => Promise<string>;

// ─── parsers (pure, exported for unit tests) ───────────────────────────────

/**
 * Parse `harness-cli query matrix` into a map storyId → status.
 *
 * The matrix is a whitespace-aligned table whose `title` column contains
 * spaces, so naive column splitting fails. Instead, for each line that starts
 * with `US-\d+`, we find the FIRST story-status token present anywhere in the
 * line. (Titles never contain these exact enum words.)
 */
export function parseMatrix(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^(US-\d+)/);
    if (!m) continue;
    const id = m[1]!;
    let status = "(unknown)";
    for (const s of STORY_STATUSES) {
      if (line.includes(s)) {
        status = s;
        break;
      }
    }
    out[id] = status;
  }
  return out;
}

/**
 * Parse the `## Status` value out of a story markdown packet.
 * Returns the trimmed token (e.g. "implemented") or "" if absent.
 */
export function parseMarkdownStatus(text: string): string {
  const m = text.match(/##\s*Status\s*\n\s*([A-Za-z_-]+)/);
  return m ? m[1]!.trim().toLowerCase() : "";
}

/**
 * Inspect the `## Evidence` section. Returns true when the section is missing,
 * empty, or contains only a placeholder ("To be added" / "TBD" / "N/A").
 */
export function isEvidenceMissing(text: string): boolean {
  const m = text.match(/##\s*Evidence\s*\n([\s\S]*?)(\n##\s|$)/);
  if (!m) return true; // no Evidence section at all
  const body = m[1]!
    .replace(/<!--[\s\S]*?-->/g, "") // strip HTML comments
    .replace(/[`*_>#-]/g, " ") // strip markdown noise
    .trim();
  if (!body) return true;
  return /^(to be added|tbd|n\/a|none|pending)$/i.test(body);
}

/** Extract the storyId from a packet filename (`US-003-foo.md` → `US-003`). */
export function storyIdFromFilename(name: string): string | null {
  const m = name.match(/^(US-\d+)/);
  return m ? m[1]! : null;
}

// ─── detection ─────────────────────────────────────────────────────────────

export interface DriftOptions {
  signal?: AbortSignal;
}

/**
 * Detect drift between the durable `story` table and the markdown packets.
 *
 * Sources of truth:
 *   durable  = `harness-cli query matrix` (status enum parse)
 *   markdown = every `docs/stories/US-*.md`, `## Status` + `## Evidence`
 *
 * Never throws — exec/read failures are recorded as a single synthetic drift
 * record so the footer still surfaces that drift detection is unhealthy.
 */
export async function detectDrift(
  cwd: string,
  exec: ExecFn,
  opts: DriftOptions = {},
  deps: { readDir?: ReadDirFn; readFile?: ReadFileFn } = {}
): Promise<DriftRecord[]> {
  const readDir = deps.readDir ?? ((p: string) => readdir(p));
  const readFile =
    deps.readFile ??
    ((p: string) =>
      import("node:fs/promises").then((m) => m.readFile(p, "utf8")));

  const storiesDir = join(cwd, "docs", "stories");
  const bin = join(
    cwd,
    "scripts",
    "bin",
    process.platform === "win32" ? "harness-cli.exe" : "harness-cli"
  );

  // durable truth
  let durable: Record<string, string>;
  try {
    const res = await exec(bin, ["query", "matrix"], {
      signal: opts.signal,
      timeout: 5000,
    });
    durable = res.code === 0 ? parseMatrix(res.stdout) : {};
  } catch {
    return [
      {
        storyId: "(query matrix failed)",
        durable: "?",
        markdown: "?",
        kind: "status_mismatch",
        detail: "detectDrift could not read the durable layer",
      },
    ];
  }

  // markdown truth
  const md: Record<string, { status: string; evidenceMissing: boolean }> = {};
  try {
    const entries = await readDir(storiesDir);
    for (const name of entries) {
      const id = storyIdFromFilename(name);
      if (!id) continue;
      const text = await readFile(join(storiesDir, name));
      md[id] = {
        status: parseMarkdownStatus(text),
        evidenceMissing: isEvidenceMissing(text),
      };
    }
  } catch {
    // no docs/stories dir → every durable story is an orphan_durable
  }

  // retired durable rows with no packet are NOT drift (retire is the sanctioned
  // "remove the packet" path). Other active statuses without a packet are.
  const ACTIVE_WITHOUT_PACKET = new Set([
    "planned",
    "in_progress",
    "implemented",
    "changed",
  ]);

  const records: DriftRecord[] = [];
  const ids = new Set([...Object.keys(durable), ...Object.keys(md)]);

  for (const id of [...ids].sort()) {
    const dStatus = durable[id];
    const m = md[id];

    if (dStatus && !m) {
      if (ACTIVE_WITHOUT_PACKET.has(dStatus)) {
        records.push({
          storyId: id,
          durable: dStatus,
          markdown: "(no file)",
          kind: "orphan_durable",
        });
      }
      continue;
    }
    if (!dStatus && m) {
      records.push({
        storyId: id,
        durable: "(no row)",
        markdown: m.status || "(empty)",
        kind: "orphan_markdown",
      });
      continue;
    }
    if (dStatus && m) {
      if (dStatus !== m.status) {
        records.push({
          storyId: id,
          durable: dStatus,
          markdown: m.status || "(empty)",
          kind: "status_mismatch",
        });
      } else if (m.evidenceMissing && dStatus === "implemented") {
        // only nag evidence for implemented stories (planned/retired legitimately lack it)
        records.push({
          storyId: id,
          durable: dStatus,
          markdown: m.status,
          kind: "missing_evidence",
          detail: "Evidence section is empty/placeholder",
        });
      }
    }
  }

  return records;
}

/** Format drift records into a single footer-friendly count + id list. */
export function summarizeDrift(records: DriftRecord[]): {
  count: number;
  ids: string;
} {
  if (records.length === 0) return { count: 0, ids: "" };
  return {
    count: records.length,
    ids: records.map((r) => `${r.storyId}(${r.kind})`).join(", "),
  };
}
