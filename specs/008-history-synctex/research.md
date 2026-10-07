# Research: Project history, restore, SyncTeX & PDF navigation

Codebase facts this builds on (005 state):

- Text files are Hocuspocus documents named by file id. `updates` is an append-only log of Yjs updates that `onStoreDocument` **compacts** into `documents.state` (debounced). So the existing log is not usable as history.
- `onChange` receives `context`: the socket's `ConnectionContext { userId, projectId }`, or for `openDirectConnection(name, context)` the context passed in (Hocuspocus `handleDocumentUpdate`, origin `source: 'local'`). Server writes (`setText`, uploads) can therefore be attributed.
- Binary files are content-addressed blobs (`putBlob`, sha256), never garbage-collected (003 R1, comment in `files.ts`).
- Compiles already run `latexmk -synctex=1` and keep `compile/<pid>/output.synctex.gz` next to `output.pdf` (`compile.ts`). The project is unpacked under `/tmp/p/` in the container and latexmk runs in `/tmp/p/$MAIN_DIR`.
- `PdfViewer.svelte` already keeps page and zoom across a recompile (002 FR-019), but not the offset inside the page, and nothing survives a reload.
- Access: `projectRole`, `fileRoles().roleOf`, `requireProject`, `requireEditFiles`, `requireEditFolder` in `access.ts`; `broadcast(pid, event)` sends stateless project events on `project:<pid>`.

## R1. History log: a second, never-compacted update log with authors

**Decision**: New table `history_log` (append-only, never compacted): `id`, `projectId`, `docName` (null for tree events), `userId` (null for system/baseline), `kind` (`text` | `tree` | `baseline`), `update` (Yjs update bytes, null for `tree`), `createdAt`. `onChange` writes a `text` row next to its existing `updates` row, in the same synchronous call, with `context.userId`. Tree-changing service calls (create, rename/move, delete, upload, set main, restore) write a `tree` row with the acting user.

**Rationale**: The live `updates` table must stay compacted for fast loads (Principle I persistence is unchanged). A separate log keeps every update with its author, which is what per-author diffs need, and stays the only text write path (the log is a copy of the CRDT updates, not a second write path).

**Alternatives**: Stop compacting `updates` and add a `userId` column — couples load time to history length. Store `Y.snapshot` per version on a `gc: false` live doc — Hocuspocus docs are gc'd, and turning gc off for live docs grows memory for everyone.

**Baseline rows (self-healing)**: Before closing a version, every text file of the project that has no `history_log` row gets a `baseline` row holding its current full state (`documents.state` + pending `updates`, merged). This covers the upgrade (existing projects), new projects/imports/duplicates (which write `documents` directly) and anything else written out of band. If edits were logged before the baseline row exists, replay still works: Yjs applies updates idempotently and holds structs with missing dependencies as pending until the baseline arrives.

## R2. Versions: derived from the log, closed by a sweep

**Decision**: A version covers the log rows `(previous.watermark, this.watermark]` of one project. `closeVersion(pid, kind, extra)` runs synchronously (better-sqlite3), in one transaction:
1. ensure baselines (R1);
2. `watermark = max(history_log.id)` for the project; if there are no rows after the previous version's watermark and `kind` is not `restore`, return the previous version (no empty versions, spec edge case);
3. build the **manifest** (R3) of the current state and store it as a blob;
4. insert `versions` row with kind, `startedAt` (first row's time), `createdAt` (now), authors (distinct non-null `userId` of the covered rows only; a restorer has rows of their own, a compile requester adds nothing), changed file ids, `restoredFrom`.

Triggers:
- **Sweep** every 30 s (`setInterval(...).unref()` in `attachCollab`, plus once at startup): for every project with rows after its last watermark, close with kind `edit` when the newest row is ≥ 5 min old **or** the oldest open row is ≥ 30 min old (clarification Q1). Thresholds are constants (`IDLE_MS`, `MAX_OPEN_MS`) overridable by env `HISTORY_IDLE_MS` / `HISTORY_MAX_OPEN_MS` / `HISTORY_SWEEP_MS` only so tests can shorten them.
- **Compile**: `POST /compile` calls `closeVersion(pid, 'compile')` before compiling (FR-002). A compile with no changes since the last version creates nothing.
- **Restore**: seals pending edits as `edit` first, applies the restore, then closes a `restore` version.
- **Label current version**: closes an `edit` version if anything is open, then labels the newest version.

No in-memory state: a restart loses nothing, the startup sweep closes whatever was open.

**Alternatives**: in-memory per-project timers — lost on restart, harder to test.

## R3. Manifest: full tree per version, contents content-addressed

**Decision**: A manifest is JSON `{ mainFileId, entries: [{ id, parentId, name, kind, hash }] }` stored as a blob (`putBlob`), referenced by `versions.manifestHash`. For text files `hash` is the sha256 of the UTF-8 text, also stored with `putBlob`; binaries reuse their existing blob hash. Text is read synchronously at close time: for a document loaded in Hocuspocus from `hocuspocus.documents.get(id)`, else by applying `documents.state` + `updates` rows to a fresh `Y.Doc`. Only files changed since the previous version are re-read; others copy the previous manifest's hash.

**Rationale**: Version zip, restore and the "changed files" list need no replay at all; dedup is free; restoring binaries works because blobs are never deleted.

**Consistency note**: `onChange` runs right after the in-memory doc applies an update, on the same event loop turn, so text read synchronously and the watermark agree up to at most an update that is about to be logged; that row lands in the next version. Acceptable and documented with a comment.

## R4. Per-author diff via Yjs snapshots on a replay doc

**Decision**: For a text file whose id is the same in both states, the diff comes from replaying its `history_log` rows into a `new Y.Doc({ gc: false })`:
1. apply rows with `id ≤ A` (A = older version's watermark), take `snapA = Y.snapshot(doc)`;
2. apply rows up to B (newer version's watermark, or all rows for "current"), take `snapB`;
3. `doc.getText('content').toDelta(snapB, snapA, computeYChange)` yields runs with `ychange: { type: 'added' | 'removed', user }`.

`computeYChange('added', id)` maps `id.client` to the user whose log row first contained that client's structs (built from `Y.decodeUpdate(row.update).structs` of rows in `(A, B]`). `computeYChange('removed', id)` finds the row in `(A, B]` whose delete set contains `id` (`Y.decodeUpdate(row.update).ds`, `Y.isDeleted`). No match → `user: null` (neutral color). Server-side, the result is turned into segments `[{ op: '=', text } | { op: '+' | '-', text, userId }]`.

Fallback (binary, file recreated with a new id, or file only on one side): `fast-diff` on the two texts from the manifests, `userId: null` unless exactly one author touched the range of versions, then that author.

**Rationale**: Yjs' own snapshot diff (the mechanism y-prosemirror uses for versions) gives exact character-level attribution without a text-diff heuristic.

**ponytail**: replay starts at the file's first log row, so cost grows with history length (fine for thousands of updates; add per-version Yjs checkpoints when it shows up in profiling).

**Alternatives**: jsdiff between stored texts, attributing by version authors — wrong for multi-author versions, which is the common collaborative case.

## R5. Restore as minimal Yjs edits through Hocuspocus

**Decision**: Text content is restored through `openDirectConnection(fileId, { userId, projectId })` and a transaction that applies the `fast-diff` of current → target text as deletes/inserts (not delete-all + insert-all). The log row is attributed to the restoring user via `context`. Collaborators' remote changes are not tracked by their `Y.UndoManager` (it tracks only its own provider's origin), so they cannot undo the restore (FR-013); the restoring user cannot undo it with Ctrl+Z either (it is not their editor's transaction) and restores again from history instead.

Tree: whole-project restore computes, from the target manifest and the current tree:
- files present in both (same id): move/rename back to the target `parentId`/`name`; text: minimal edit; binary: set `hash`/`size`;
- files only in the target (deleted since): recreated with a **new id** (a deleted doc's log can't be continued by a new Yjs doc) at the target path, folders first; text written through Yjs;
- files only in the current tree (created since): deleted;
- `mainFileId` restored (mapped to the new id if recreated).

Name clashes during moves are resolved by applying deletes first, then moves in parent-first order; a remaining clash (impossible in a consistent target) is a 409.

Permissions (clarification Q2, FR-018/019): every planned change is checked with `fileRoles(pid, userId).roleOf`: edits/moves/deletes need edit on the file (and on the destination folder for moves), recreations need edit on the target parent folder. Changes the user may not make are skipped; the response lists skipped paths. Owner is never restricted. Single-file restore applies only the file part and refuses (403) instead of skipping.

The restore runs `closeVersion(pid, 'edit')` first, then the changes, then `closeVersion(pid, 'restore', { userId, restoredFrom })`; tree changes `broadcast(pid, { type: 'tree' })` and kick nothing (open editors receive the text through Yjs).

## R6. Labels

**Decision**: `version_labels(id, projectId, versionId, name, userId, createdAt)`, 1–100 chars, several per version allowed. Add: E (project editor or owner). Rename/delete: label author or owner (clarification Q4). Readers see labels. "Labels only" filter is a query parameter of the versions list.

## R7. Version zip

**Decision**: `GET /history/:vid/zip` builds the zip from the manifest (folders as `dir/` entries, text and binary from blobs) with the same `zipSync` path as `exportZip`; filename `<title>-<version label or date>.zip`. Readers allowed (FR-015). Per-file read restrictions do not exist in 005 (overrides are editor/reader only), so every member gets every file.

## R8. History events to open clients

**Decision**: `ProjectEvent` gains `{ type: 'history' }`, broadcast after each `closeVersion` and label change; an open History panel refetches its first page. No polling.

## R9. SyncTeX: parse `output.synctex.gz` on the server, in TypeScript

**Decision**: A small parser `src/lib/server/synctex.ts` (gunzip with `node:zlib`) reads the Input table, the units/offset/magnification preamble and per page the box records (`[`/`(` boxes with width/height/depth, `h`/`v` void boxes, `x`/`k`/`g`/`$` points). Two queries:
- **forward** `(fileId, line) → { page, x, y, width, height }[]`: records with the file's input tag and that line; if none, the nearest earlier line that has records; the first page with matches; hbox records merged into one rectangle per page.
- **reverse** `(page, x, y) → { fileId, line }`: the smallest hbox on the page containing the point; else the nearest record by vertical then horizontal distance.

Coordinates are converted to PDF points from the top-left: `pt = sp × unit × mag/1000 / 65536 × 72/72.27`, with the X/Y offsets (default 1in) added. The parsed index is cached in memory per `pdfId` (an LRU of 4 entries).

Paths: SyncTeX input names are absolute (`/tmp/p/...`) or relative to latexmk's cwd (`/tmp/p/$MAIN_DIR`). `compileOnce` writes `sync.json` (`{ mainPath, paths: { [projectPath]: fileId } }`, from `collectProject`) next to the synctex file, so navigation uses compile-time paths even if files were renamed since. Inputs outside `/tmp/p/` (TeX Live files) map to nothing.

**Rationale**: No maintained JS SyncTeX library exists; the `synctex` CLI would mean running a TeX Live container per click (Principle III forbids TeX tools in the app process, and a container per click is too slow). The format is line-based and small to parse. This is the one piece of custom parsing in the feature (recorded in plan Complexity Tracking).

**Alternatives**: `synctex` binary in the app image — violates Principle III's spirit (TeX tooling in the app) and adds an image dependency. Client-side parsing — ships the whole synctex file (often MBs) to every browser.

## R10. Navigation UI

**Decision**: A narrow vertical strip on the editor/PDF divider holds two buttons, "→" (Go to PDF location) and "←" (Go to code location). Shortcut for forward: **Ctrl/⌘+Alt+J** (⌘⌥→ switches tabs in some browsers). Forward: `GET /compile/sync/code?pdfId&fileId&line` → scroll the page into view at the rectangle (`scrollPageIntoView` with an `XYZ` destination) and draw a highlight `div` over the page for 1 s. Reverse: `dblclick` on a pdf.js page → convert client coords to PDF points via the page view's viewport (`convertToPdfPoint`, flipped to top-left) → `GET /compile/sync/pdf?pdfId&page&x&y` → `openAt(fileId, line)` (existing helper on the project page). "←" uses the point at the top-left quarter of the visible area of the current page. Disabled when `compile.last?.pdfId` is missing or the server answers 404 (no synctex).

## R11. PDF position across recompiles and reloads

**Decision**: `PdfViewer` tracks `{ page, offset (fraction of page height at the top of the viewport), scale }` on scroll (throttled). On `pagesinit` it restores page (clamped to the last page, spec US4 scenario 2), scale, then offset via `scrollPageIntoView` with an `XYZ` destination computed from the fraction. The position is also saved to `localStorage` under `overtree:pdfpos:<projectId>` and used as the initial `keep` on first load (FR-025).

## R12. Layout menu and separate PDF window

**Decision**: A "Layout" menu button in the top bar (uses the existing `menu.svelte.ts` popup helper): Side-by-side, Editor only, PDF only, PDF in separate window. Stored in `localStorage` `overtree:layout-mode` (per device; FR-026). Editor only / PDF only collapse the respective paneforge pane (the pane API already used by the collapse arrows). Separate window: `window.open('/project/<id>/pdf', 'overtree-pdf-<id>')`; `null` (blocked) → toast "Allow pop-ups to open the PDF in a new window", mode unchanged. The new route renders `PdfPane` with its own `CompileState` (`load()` for the current result) and the sync buttons.

Main window ↔ PDF window over `BroadcastChannel('overtree:pdf:<projectId>')`:
- main → pdf: `{ type: 'compiled', last }` after each compile; `{ type: 'forward', fileId, line }` when "→" is used.
- pdf → main: `{ type: 'open-at', fileId, line }` on double-click / "←"; `{ type: 'hello' }` on load, `{ type: 'bye' }` on `pagehide`.
The main window also detects closure (`win.closed` check every second while in that mode) and falls back to side-by-side (US7 scenario 3). The popup is a same-origin page, so the Clerk session and every server-side check apply unchanged.

## R13. History UI placement

**Decision**: The "History" button in the top bar toggles history mode for this tab. In history mode the workspace's editor and PDF panes are replaced by `HistoryView`: changed-files list (left), diff (center), timeline (right, 300 px). Closing returns to the editor with tabs intact (the editor stays mounted, hidden, so providers stay connected). The diff shows the file with unchanged runs collapsed to 3 lines of context, insertions with the author's color as background at 20 % alpha (`lightColor`), deletions struck through in the author's color, a legend of authors, and per-file "Restore this file" (E with edit on that file); the header has "Restore project" (E, confirm dialog listing skipped paths after the restore), "Download zip", "Label", and the toggle "Compare with current / Changes in this version" (clarification Q3). The timeline groups by day, shows time, avatars (`Avatar.svelte`, `colorFor`), changed file names (first 3 + "N more"), compile icon, restore marker ("Restored from <date>"), labels as chips, and loads 50 at a time on scroll. Keyboard: ↑/↓ moves between versions, Escape closes history.

## R14. Dependencies

**Decision**: add `fast-diff` (tiny, no deps, used by Quill/Yjs tooling) for minimal restore edits and fallback diffs. No other new dependency.
