// detect.ts — pure repository-harness state detection (DESIGN.md §3).
//
// Pure contract: this module imports NO pi types and NO pi runtime. The only
// side-effecting surface (running `harness-cli`) is injected as `exec`. That
// keeps detectHarness unit-testable with a stub exec + a tmpdir cwd.
//
// Correctness note vs DESIGN.md: pi.exec's documented options are
// { signal, timeout } — there is no `cwd` option. The caller resolves the CLI
// to an absolute path against ctx.cwd and relies on the inherited session cwd
// (the repo root) so harness-cli finds harness.db.

import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { platform } from "node:os";

/** Structural type matching the subset of pi.exec this module needs. */
export type ExecFn = (
  cmd: string,
  args: string[],
  opts?: { signal?: AbortSignal; timeout?: number }
) => Promise<{ stdout: string; stderr: string; code: number | null; killed?: boolean }>;

/** Durable-layer counts from `harness-cli query stats`. */
export interface HarnessStats {
  intakes: number;
  stories: number;
  decisions: number;
  backlog_items: number;
  traces: number;
}

/** Full detection result. Every field is serializable for the overlay/cache. */
export interface HarnessState {
  cwd: string;
  cliInstalled: boolean;
  cliVersion: string | null;
  dbInitialized: boolean;
  shimPresent: boolean;
  claudeShimPresent: boolean;
  observerInstalled: boolean;
  stats?: HarnessStats;
  error?: string;
}

const HARNESS_BEGIN = "<!-- HARNESS:BEGIN -->";
const isWindows = platform() === "win32";

/** Resolve the harness-cli binary path for the current platform. */
export function cliBinaryPath(cwd: string): string {
  return join(cwd, "scripts", "bin", isWindows ? "harness-cli.exe" : "harness-cli");
}

/** Resolve the harness.db path. */
export function dbPath(cwd: string): string {
  return join(cwd, "harness.db");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function fileContains(p: string, needle: string): Promise<boolean> {
  try {
    const text = await readFile(p, "utf8");
    return text.includes(needle);
  } catch {
    return false;
  }
}

/**
 * Parse the `harness-cli query stats` table into HarnessStats.
 *
 * The table looks like:
 *   === Harness Stats ===
 *   intakes  stories  decisions  backlog_items  traces
 *   -------  -------  ---------  -------------  ------
 *   0        0        0          0              0
 *
 * Returns undefined if no numeric row is found.
 */
export function parseStats(stdout: string): HarnessStats | undefined {
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // A data row is whitespace-separated integers and nothing else.
    const parts = trimmed.split(/\s+/);
    if (parts.length === 5 && parts.every((t) => /^\d+$/.test(t))) {
      const nums = parts.map((t) => Number(t));
      return {
        intakes: nums[0]!,
        stories: nums[1]!,
        decisions: nums[2]!,
        backlog_items: nums[3]!,
        traces: nums[4]!,
      };
    }
  }
  return undefined;
}

export interface DetectOptions {
  signal?: AbortSignal;
  /** Skip the (cheap) version+stats CLI calls. Useful when only fs signals matter. */
  skipCliProbes?: boolean;
}

/**
 * Detect repository-harness state for `cwd`. Never throws — any failure is
 * captured in `state.error` and the footer degrades gracefully.
 */
export async function detectHarness(
  cwd: string,
  exec: ExecFn,
  opts: DetectOptions = {}
): Promise<HarnessState> {
  const state: HarnessState = {
    cwd,
    cliInstalled: false,
    cliVersion: null,
    dbInitialized: false,
    shimPresent: false,
    claudeShimPresent: false,
    observerInstalled: false,
  };

  const bin = cliBinaryPath(cwd);
  const db = dbPath(cwd);

  // fs-based signals (always safe)
  state.cliInstalled = await pathExists(bin);
  state.dbInitialized = await pathExists(db);
  state.shimPresent = await fileContains(join(cwd, "AGENTS.md"), HARNESS_BEGIN);
  state.claudeShimPresent = await fileContains(join(cwd, "CLAUDE.md"), HARNESS_BEGIN);

  // observer: the installer renames the real binary to harness-cli(.exe).real
  // and/or writes .harness-observer/events.jsonl
  const realBin = join(cwd, "scripts", "bin", isWindows ? "harness-cli.exe.real" : "harness-cli.real");
  const observerDir = join(cwd, ".harness-observer", "events.jsonl");
  state.observerInstalled =
    (await pathExists(realBin)) || (await pathExists(observerDir));

  if (opts.skipCliProbes || !state.cliInstalled) {
    return state;
  }

  // CLI probes: version + stats. Both are cheap on a local <1MB db.
  try {
    const ver = await exec(bin, ["--version"], { signal: opts.signal, timeout: 5000 });
    if (ver.code === 0) {
      // `harness-cli 0.1.11`
      const m = ver.stdout.match(/(\d+\.\d+\.\d+[^\s]*)/);
      state.cliVersion = m ? m[1]! : ver.stdout.trim() || null;
    }
  } catch (e) {
    state.error = `version probe failed: ${(e as Error).message}`;
  }

  if (state.dbInitialized) {
    try {
      const statsRes = await exec(bin, ["query", "stats"], { signal: opts.signal, timeout: 5000 });
      if (statsRes.code === 0) {
        state.stats = parseStats(statsRes.stdout);
      }
    } catch (e) {
      // keep prior error if any, but record stats probe failure
      state.error ??= `stats probe failed: ${(e as Error).message}`;
    }
  }

  return state;
}

// ─── Per-session cache (DESIGN.md §3) ──────────────────────────────────────
// Keyed by cwd. Invalidated by mtime change of harness.db or the CLI binary,
// plus a short TTL so a long session still refreshes after external changes.

interface CacheEntry {
  state: HarnessState;
  at: number;
  dbMtimeMs: number;
  binMtimeMs: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 5_000;

async function mtimeMs(p: string): Promise<number> {
  try {
    return (await stat(p)).mtimeMs;
  } catch {
    return -1;
  }
}

/**
 * Cached detection. Reuses a prior result unless the db or binary changed on
 * disk or the TTL expired. Falls back to a full detect on any error.
 */
export async function detectHarnessCached(
  cwd: string,
  exec: ExecFn,
  opts: DetectOptions = {}
): Promise<HarnessState> {
  const db = dbPath(cwd);
  const bin = cliBinaryPath(cwd);
  const [dbMtimeMs, binMtimeMs] = await Promise.all([mtimeMs(db), mtimeMs(bin)]);
  const now = Date.now();

  const hit = cache.get(cwd);
  if (
    hit &&
    now - hit.at < TTL_MS &&
    hit.dbMtimeMs === dbMtimeMs &&
    hit.binMtimeMs === binMtimeMs
  ) {
    return hit.state;
  }

  const state = await detectHarness(cwd, exec, opts);
  cache.set(cwd, { state, at: now, dbMtimeMs, binMtimeMs });
  return state;
}

/** Drop the cached entry for a cwd (or everything if omitted). Test/diagnostic hook. */
export function invalidateCache(cwd?: string): void {
  if (cwd) cache.delete(cwd);
  else cache.clear();
}
