# Implementation Plan: Track changes (suggest mode)

**Branch**: `013-track-changes` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

## Summary

Suggestion records live in each text file's Yjs document, in a `Y.Map` called `changes` next to the `content` text, anchored with Yjs relative positions. The editor records the user's own edits there while the project's switch is on, in a transaction right after the edit with the same origin, so per-user undo covers both. Deletions are applied to the text and the record keeps the removed string. The project-wide switch is a column on `projects`, toggled over HTTP and announced with the existing `project` event.

## Decisions

**D1. Records in the document, not the database.** `doc.getMap('changes')`: id → `{ kind: 'insert', author, at, start, end }` or `{ kind: 'delete', author, at, start, text }`; `author` is `{ id, name, color }` copied at write time, so the panel needs no user lookup and shows people who have left. Positions are `Y.relativePositionToJSON` as plain JSON. An insertion is anchored to its first character (assoc 0) and its last (assoc −1), so typing inside it grows it naturally while typing next to it does not. A deletion is anchored to the character before the gap (assoc −1), so text typed at the gap comes after the marker ("deleted, then inserted"). Sync, persistence, offline merge, read-only enforcement for readers (Hocuspocus drops their updates) and history logging all come for free: there is no second write path (Principle I). Ids are `clientID-time-seq`, not `crypto.randomUUID()`, which browsers lack on plain-http LAN servers.

**D2. Shared logic in `src/lib/track-changes.ts`** (no CodeMirror, no DOM): `recordEdit`, `resolveChanges`, `acceptChanges`, `rejectChanges`, `clearChanges`, `keepAnchors`. Unit-tested on plain Yjs and used by the editor and the server.

**D3. Recording in the editor** (`src/lib/editor/track.ts`, a ViewPlugin after `yCollab`). For a local update (no `ySyncAnnotation`), the sync plugin has already written the edit to the Y.Text; the track plugin then calls `recordEdit` with the CodeMirror change set, the old text's deleted slices and its last resolved records, which are in the old coordinates. That is what merging needs: typing right at the end or start of the author's own insertion extends it, a Backspace or Delete next to their deletion joins it in the right order, and deleted text inside any tracked insertion is not a deletion (the insertion shrinks). Emptied insertions are dropped on any local delete, tracking on or off. Records are written with the sync config as origin, so `Y.UndoManager` (scope `[content, changes]`) merges them into the same undo step as the text. The same plugin draws marks (insertions, `--tc-color` from the author's presence color) and widgets (deletions, `title` = author and deleted text) and exposes its resolved list to the review panel through a facet. Remote record changes redraw on a microtask, after the Yjs transaction's text observer has updated the view.

**D4. Undo/redo anchors (`keepAnchors`).** Undo and redo recreate text as new Yjs items; `Item.redone` links old to new only on the client that did it, so a record anchored to the old items would land elsewhere for everyone else and after a reload. After each undo/redo step, records whose anchors moved are re-anchored with the UndoManager as origin while it is still undoing/redoing, and the resulting stack item is merged into the step's own, so one Ctrl+Z still takes everything back.

**D5. The switch in SQLite.** `projects.track_changes` (boolean, default false); `PUT /api/projects/:pid/track-changes { on }` for owners and editors (403 for readers), `GET /api/projects/:pid` returns `trackChanges`, and `broadcast(pid, { type: 'project' })` makes open editors refetch details within the 300 ms budget. A project-level Yjs doc was the alternative, but the existing `project:<pid>` doc is read-only and never persisted, and a non-text setting is plain project metadata like the title. Accepted gap: a client that is offline when the switch flips keeps its old state until it reconnects (`access` refetch).

**D6. Server paths that read or write text.** Compile, raw download, symbols, duplicate and GitHub push read `content` only: they see the proposed version, as intended (FR-009). GitHub pulls and repository import edit `content` minimally with `editText`, so existing records keep their anchors. `setText` (history restore and replacing a text file by upload, both whole-file replacements) now also clears `changes` in the same transaction (FR-010): the restored text never had those suggestions, and leftover anchors would point into deleted text. History versions store plain text; the record updates are in the log like any other Yjs update (history-diff only reads `content`). Duplicate copies text only, so the copy has no suggestions and starts with tracking off.

**D7. UI.** Top bar: "Track changes" (pressed state, accent fill while on, disabled for readers) and "Review" (opens the panel for this tab). The panel (`ReviewPanel.svelte`) is a 260 px column right of the editor inside the editor section, clear of the pane's right rail. Accept/Reject buttons show only when the user can edit the file. Review actions use their own origin: not tracked, not on anyone's undo stack. No new color literals: insertion and marker colors come from the author's palette color via `--tc-color` and `color-mix`, everything else from `app.css` variables.

## Schema

`projects.track_changes integer NOT NULL DEFAULT false` (migration `drizzle/0006_optimal_lord_hawal.sql`; may be renumbered at merge). No other tables.

## Constitution Check

| Principle | Status | How |
|---|---|---|
| I. Collaboration is the data model | ✅ | Suggestions are Yjs data in the file's document; accept/reject are Yjs edits. The only non-CRDT write is the project switch, which is not text. |
| II. Self-hostable | ✅ | No new service or dependency. |
| III. Untrusted compilation | ✅ | Unchanged; compile sees the plain proposed text. |
| IV. Test the seams | ✅ | Vitest: `tests/unit/track-changes.test.ts` (recording, merging, review, undo/redo across peers, sync), `tests/unit/track-changes-server.test.ts` (live sync and persistence through Hocuspocus, readers dropped, switch route, restore). Playwright with two contexts (plus a reader): `tests/e2e/track-changes.spec.ts`. |
| V. Simplicity | ✅ with notes | One module plus one plugin. `ponytail:` a failed toggle just leaves the switch unchanged, without a message. Records resolve by walking Yjs items (O(text) per record) on each local edit; fine for hundreds of suggestions, a cached index would be the upgrade. |

## Scenario coverage

| Spec | Test |
|---|---|
| US1 1, 2, 4 | e2e "the switch is the project’s…" |
| US1 3, US3 6 | e2e "a reader sees the state…"; unit "the switch: …readers get 403" |
| US2 1–3, US3 1–4 | e2e "B types and deletes…" (latency measured < 300 ms) |
| US2 4 | e2e (one mark for " new"); unit "records an insertion and merges…", "backspace and forward delete merge in order", "keeps another author's adjacent typing separate" |
| US2 5, US3 5 | e2e "replacing a selection…"; unit "replacing a selection…", "reject all handles…nested" |
| US2 6 | e2e "suggestions survive a reload"; unit "survive a server restart", "records travel… after offline edits on both sides" |
| US2 7 | unit "deleting text inside a suggested insertion…" |
| US4 1, 2 | e2e "undo takes back…"; unit "undoing a tracked insertion…", "after undo and redo the other side and a reload…" |
| US4 3 | unit "undoing a tracked deletion…" |
| FR-010 | unit "restoring a version drops the file’s suggestions" |
