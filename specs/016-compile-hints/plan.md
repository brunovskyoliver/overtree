# Implementation Plan: Friendlier compile errors and code check

**Branch**: `016-compile-hints` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

## Summary

Hints are computed on the server when a compile result is written, from one data-driven rule table shared with the
tests. The editor gets `@codemirror/lint` with one lint source that merges the instant code check and the last
compile's entries; compile markers are anchored as Yjs relative positions so they follow everyone's edits. ChkTeX runs
inside the existing compile job container, before latexmk, when the project's new `chktex` setting is on.

## Design decisions

- **Hint table** (`src/lib/compile-hints.ts`): an ordered list of `{ test: RegExp, hint(match, entry, ctx) }` rules over
  the entry message, plus lookup tables (command → package, environment → package, known package names). Typos are
  found with a small Levenshtein distance (≤ 1–3 by name length). File-not-found suggestions compare against the project
  paths relative to the main document's folder (where TeX resolves names): same name ignoring case, same base name in
  another folder, then the closest path with and without extension. "Missing from this image vs typo" for packages is a
  heuristic: close to a known package name → typo; else a project file with that name elsewhere → move it; else "not in
  this image, the full image probably has it".
- **Parser** (`src/lib/log-parser.ts`): keeps the `l.<n>` text as `context` (the undefined command is its last token),
  the `*** (…)` reason of an emergency stop, places a line-less `! File … not found.` at the emergency stop that follows
  it, and drops `!  ==> Fatal error` lines. `parseChktex` reads the job's `%f:%l:%c:%d:%k:%n:%m` lines.
- **Where hints are computed**: server, in `compileOnce` (it has the project paths); stored in `result.json` with the
  entries. Older stored results simply have no hints.
- **Markers**: one `linter()` source (delay 400 ms) = code check (only `.tex` files, when the pref is on) + compile
  entries of the shown file. Per file, the entries of a compile are turned once into Yjs relative positions (start
  assoc 0, end assoc −1) from the synced `Y.Text`; each lint run maps them back to offsets, so markers follow local and
  remote edits and survive tab switches (a hidden tab's EditorState doesn't follow Yjs). A new compile id rebuilds
  them. A refresh `StateEffect` (+ `needsRefresh`) re-runs the linter when a compile result arrives or the pref
  changes; `forceLinting` alone only flushes a pending run. The range is the ChkTeX column, else the hint's token on the
  line (or up to two lines before), else the line's text.
- **Code check** (`src/lib/editor/codecheck.ts`): one linear scan with stacks for environments and braces and a math
  state; comments, `\verb`, escaped characters and verbatim-like environments are skipped; inside a definition's braced
  arguments `\begin`/`\end`/`$` aren't counted. A mismatched `\end` closes the open environment (one slip, one pair of
  markers, no cascade).
- **ChkTeX**: `command -v chktex && timeout -s KILL 5 chktex -q -f …` in the job script, output to
  `/tmp/output.chktex`, returned in the same tar. Availability: one `docker run … sh -c 'command -v chktex'` per image,
  cached (not when Docker couldn't answer), started at module load; `GET /compile` returns `chktex` and
  `chktexAvailable` (`null` when unknown). `PUT /compile/settings` accepts `{ compiler?, chktex? }`.
- **UI**: logs panel filters (All + one per level, ChkTeX only when present) and a `<details>` hint per entry (errors
  open). "Check with ChkTeX" item in the compile options menu (editors only, disabled with a note when unavailable).
  "Code check" checkbox in the editor settings popover. New theme variables `--error`, `--warning`, `--info` in
  `app.css`; the lint package's fixed-color SVG markers are redrawn from them.

## Schema changes

- `compile_settings.chktex integer (boolean) NOT NULL DEFAULT false` — migration `drizzle/0006_careful_rattler.sql`.

## Dependencies

- `@codemirror/lint` (CodeMirror's own lint package).

## Constitution Check

| Principle | Status |
| --- | --- |
| I. Collaboration is the data model | No new write path; markers are read-only views anchored with Yjs relative positions. |
| II. Self-hostable | No new service; one boolean column. |
| III. Untrusted compilation | ChkTeX runs only inside the per-job container with the same sandbox; the availability probe is a throwaway container with no network, read-only root, no capabilities. |
| IV. Test the seams | Vitest: hint rules on real logs (`tests/fixtures/hints/*.log`, refreshable with `REFRESH_HINT_LOGS=1`), code check, parser, ChkTeX in the sandbox and through `compileProject`. Playwright: `compile-hints.spec.ts` (all acceptance scenarios, two contexts for US2-5). |
| V. Simplicity | One rule table, one lint source, no new abstractions. The code check's lexical-scan ceiling is marked `ponytail:`. |

## Complexity Tracking

None.
