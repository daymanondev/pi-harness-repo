# US-031 Fix Dashboard Input Freeze on Kitty-Keyboard Terminals

## Status

implemented

## Lane

normal

## Product Contract

The `/harness` DASHBOARD (and INSTALL) overlay renders correctly but accepts
**no keyboard input** on Kitty-keyboard-protocol terminals (Ghostty, Kitty,
WezTerm). Every key the operator presses is silently ignored — the overlay
appears frozen (input-starved) even though it drew fine and has focus.

- `HarnessOverlayComponent.handleInput` matched keys with raw byte compares
  (`data === "j"`, `isEscape(data) === "\u001b"`, `isArrowDown === "\x1b[B"`,
  `isEnter === "\r"`).
- pi-tui enables the **Kitty keyboard protocol** (flags 1+2+4) on supporting
  terminals, so keys arrive as **CSI-u** sequences: `\x1b[106u` for `j`,
  `\x1b[27u` for Esc, `\x1b[13u` for Enter, `\x1b[57419u` for Up.
- None of the raw compares match a CSI-u sequence → no key is recognized →
  the overlay is input-starved. Built-in pi components (SelectList, model
  selector) are unaffected because they use `kb.matches(data, keyId)` →
  `matchesKey()` (`@earendil-works/pi-tui/keys.ts`), which normalizes both
  legacy bytes and Kitty CSI-u.

## Fix

A self-contained `normalizeKey(data)` in `extensions/harness/overlay.ts`
decodes unmodified Kitty CSI-u sequences to the legacy bytes the pure reducer
already understands, applied once at the top of `handleInput`
(`extensions/harness/index.ts`):

- `\x1b[27u` / `\x1b[27;1u` → `\u001b` (Esc)
- `\x1b[13u` / `\x1b[13;1u` → `\r` (Enter)
- `\x1b[57419u` → `\x1b[A` (Up — Kitty functional codepoint)
- `\x1b[57420u` → `\x1b[B` (Down)
- `\x1b[<cp>u` (cp ≥ 32) → `String.fromCodePoint(cp)` (printables: j/k/r/f/t/1-6/i…)

Legacy bytes, modified keys (mod ≥ 2: Shift/Alt/Ctrl), and unknown sequences
pass through unchanged, so behavior on non-Kitty terminals is byte-identical
and the pure reducer (`reduceDashboardNav`) + all existing tests stay green.

`@earendil-works/pi-tui` is **not** imported — it is a nested dependency of
`@earendil-works/pi-coding-agent`, not resolvable from this extension, and the
overlay module already implements its own terminal helpers (box, truncateAnsi,
padRight) under a "no pi-tui dependency" policy. The decoder is focused on the
unmodified sequences the reducers care about; key-release events (event=3) are
filtered by pi-tui before they reach the component.

## Acceptance Criteria

- On a Kitty-capable terminal (Ghostty), `/harness` DASHBOARD responds to j/k
  (move), 1-6/t (tabs), r (refresh), f (filter), Enter (drill), Esc (close),
  and ↑/↓.
- On a non-Kitty terminal, behavior is unchanged (raw bytes still match).
- Modified keys (Ctrl+J, Shift+J, …) do not falsely match navigation.

## Evidence

- `extensions/harness/overlay.ts`: `normalizeKey()` (CSI-u decoder) + updated
  `isEscape` docstring.
- `extensions/harness/index.ts`: `handleInput` calls `normalizeKey(data)` once
  at entry; install + dashboard paths use the normalized `key`.
- `tests/p4.test.ts`: +6 tests — CSI-u printables, Esc/Enter/Up/Down decode,
  legacy passthrough parity, modified-key passthrough, event-type suffix
  (flag 2), and a reducer+normalizeKey integration test. p4 109/109
  (was 103); p2 46, p3 33, p5 31, p6 36 — 0 regressions; tsc 0 errors.
- `docs/decisions/0013-pi-tui-external-rerender.md`: correction appended — the
  US-016 "pi-internal watcher freeze" was a misdiagnosis; real cause is
  Kitty-incompatible key matching. The watcher retirement stands; the
  attribution is corrected.

## Notes

- This corrects decision 0013 / US-016, which attributed the dashboard freeze
  to a pi-internal render loop triggered by the live-tail `fs.watch` watcher.
  v3's "confirmed responsive" was tested on a non-Kitty terminal, so the
  Kitty-incompatible key matching was never exercised. The recurrence on
  Ghostty (this repo's operator terminal, `TERM_PROGRAM=ghostty`) exposed it.
- Headless tests cannot catch this class of bug (they feed single-byte
  strings, not CSI-u) — the same limitation 0013 flagged. The new tests
  close the gap by asserting CSI-u → legacy decoding directly.
