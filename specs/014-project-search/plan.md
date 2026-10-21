# Implementation Plan: Search and replace across the project

**Branch**: `014-project-search` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

## Summary

Search runs on the server over the current text of every text file (the live Hocuspocus document when one is loaded, else the stored snapshot plus updates), so files not open in tabs are covered without the browser loading their Yjs docs. Replacements also run on the server, as Yjs transactions on a Hocuspocus direct connection whose context carries the user: Hocuspocus persists them, history logs them under that user, and open editors receive them like any collaborator's edit. One matcher module is shared by browser and server. No schema change, no new dependency.

## Design decisions

**D1. One matcher, shared** (`src/lib/search.ts`, plain erasable TS like `src/lib/files.ts`). `buildRegExp` turns the query and options into a global `gmu` RegExp (literal queries escaped; case-insensitive adds `i`; whole word wraps the pattern in `(?<![\p{L}\p{N}_])(?:…)(?![\p{L}\p{N}_])`, so `\section` and `über` behave). An invalid pattern returns `{ error }` instead of throwing. The browser uses it to show the regex error inline before any request and to find the clicked match again in the editor's text; the server uses it for search and replace. `matches()` skips zero-length matches. `expand()` implements `String.replace`'s `$` patterns for one match, because `replace()` itself can't give per-match replacement offsets.

**D2. HTTP API** (both `requireProject(…, 'read')`, then per-file roles from `fileRoles`):
- `GET /api/projects/:pid/search?q=&case=1&word=1&regex=1` → `{ files: [{ fileId, path, canEdit, matches: [{ from, to, line, before, match, after }] }], total, truncated }`. Offsets are UTF-16 code units, which is what CodeMirror positions and `Y.Text` indices count. Files in path order, at most `MATCH_CAP` = 2,000 matches; the server asks for one more than the room left to tell whether the cap cut anything off. 400 with the reason for a bad regex.
- `POST /api/projects/:pid/search/replace` with `{ q, case, word, regex, replacement, fileId?, at? }` → `{ replaced, files, skipped }`. `fileId` + `at`: the one match starting at `at`; `fileId`: all in that file (403 if the user's effective role there is reader); neither: every file the user can edit, `skipped` counting matches in read-only files.

**D3. Replacements are Yjs edits (Principle I).** For each target file: `openDirectConnection(id, { userId, projectId })`, then in one `transact` the matches are found again on the document's current text and replaced from the last to the first (earlier offsets stay valid). Re-matching inside the transaction makes the operation atomic with respect to concurrent typing; a single-match replace whose `at` no longer starts a match is a 409 instead of a wrong edit. `onChange` in `collab.ts` already writes the update and `logText`s it with `context.userId`, so attribution needs no new code. A project-wide replace calls `closeVersion(pid, 'edit')` before (earlier edits get their own version) and after (the replace is one version), the same pattern restore uses; no new version kind, so the History UI needs no change.

**D4. Undo.** The editor's `Y.UndoManager` only tracks local-origin transactions, so Ctrl/⌘+Z does not undo a server-side replace (same as restore, 008 research R5). Project-wide replaces are undone by restoring the version before them. Doing single-match replaces in the browser for open tabs would make them undoable but adds a second code path for the same operation; not done.

**D5. Freshness.** Results are a snapshot. The panel re-runs the search: debounced 250 ms on query/option changes, 800 ms after the user's own edits (`onLocalEdit`), after each replace, and on tree reloads (`project.files` replaced). Collaborators' edits don't trigger a refresh; "Search again" does. Replace actions use the options the shown results were found with, not a query still being typed; "Replace all" runs the search first so the confirm's counts match the query as typed. Clicking a stale result re-matches in the editor and selects the match nearest the old offset.

**D6. UI placement.** `Workspace.svelte` keeps the tree/outline pane group and the new `SearchPanel.svelte` both mounted and toggles which one is shown, so the tree keeps its state and the search keeps its query. Ctrl/⌘+Shift+F is a window keydown handler in `Workspace` (ignored while the History view makes the workspace inert or a dialog is open); it expands a collapsed sidebar. The file tree header gets a "Search project" button. Colors are CSS variables; new ones in `app.css`: `--search-match`, `--error-bg`, `--error-text`.

## Schema changes

None.

## Files

- New: `src/lib/search.ts`, `src/lib/server/search.ts`, `src/routes/api/projects/[pid]/search/+server.ts`, `src/routes/api/projects/[pid]/search/replace/+server.ts`, `src/lib/components/SearchPanel.svelte`, `tests/unit/search.test.ts`, `tests/e2e/search.spec.ts`.
- Changed: `src/lib/components/Workspace.svelte` (search view, shortcut), `src/lib/components/FileTree.svelte` (search button), `src/routes/project/[id]/+page.svelte` (open a match, refresh after local edits), `src/app.css` (three variables).

## Constitution Check

| Principle | Status | How |
|---|---|---|
| I. Collaboration is the data model | ✅ | Replacements are Yjs transactions through Hocuspocus (D3); search only reads. |
| II. Self-hostable by one person | ✅ | No new service or dependency. |
| III. Untrusted compilation | ✅ | Not touched. |
| IV. Test the seams | ✅ | Vitest: matcher, search route (per-file roles, live doc, cap, bad regex), replace route (one/file/project, stale 409, attribution and one version in history, live delivery to a connected provider, reader refusals); the existing route-guard test covers both routes for 401/404. Playwright: US1 (closed file, click and keyboard open, options, refresh after own edits, regex error), US2 with two contexts (one/file/project replace, live in the other browser), US3 with project reader and per-file reader override. |
| V. Simplicity first | ✅ | One shared matcher, no index. `ponytail:` search reads every text file per request (fine for the 2,000-file limit; an index or per-file cache keyed on the document version is the upgrade). `ponytail:` per-file roles never hide a file today, the `!role` skip is there for when they do. |

## Complexity Tracking

None.
