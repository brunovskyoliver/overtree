# Research: Multi-file projects, file tree & LaTeX autocomplete

## R1. File identity and storage
- **Decision**: one `files` table with `id` (uuid), `parent_id` (folder id or null = root), `name`, `kind` (`folder` | `text` | `binary`), `hash`/`size` for binaries. The Hocuspocus document name of a text file is its `id`. Binaries live at `$DATA_DIR/blobs/<sha256>` (temp file + rename, written once, never modified). The main document is `project.main_file_id`.
- **Rationale**: rename and move change one row and never touch Yjs state, so open editors, undo history and stored updates stay valid (FR-007). Content addressing matches constitution principle I and deduplicates repeated uploads.
- **Alternatives**: path as document name (rename would have to copy Yjs state, which breaks open providers and undo); blobs in SQLite (bloats the DB and backups).
- **Ceiling**: blobs are never garbage-collected. `ponytail:` comment; history (008) needs old blobs anyway, and cleanup can come with backups in 011.

## R2. Upgrading the single-file data from 001/002
- **Decision**: `ensureProject()` runs once when the collab server is attached. If `files` is empty, it creates the `main.tex` text file row with a new uuid. If `documents`/`updates` rows named `main.tex` exist, they are renamed to that uuid in the same transaction. Otherwise the uuid doc is seeded with `SEED` through `setText`. Then it sets `project.main_file_id`.
- **Rationale**: keeps the user's existing text and history. A migration can't generate the uuid portably, and running in code keeps it testable (reopen a 002-style data dir).

## R3. Writing text server-side without a second write path
- **Decision**: `setText(id, text)` opens `hocuspocus.openDirectConnection(id)`, runs `transact(doc => { t.delete(0, t.length); t.insert(0, text) })` and disconnects. It is used for upload of text files, replace-on-upload and zip import. `onChange` persists it like any edit, and connected clients receive it live.
- **Rationale**: one write path for text (principle I). Replacing an open file updates its tab (US4 scenario 6).
- **Note**: zip import with up to 2,000 text files opens one direct connection at a time. Spike target: under 10 s for 500 small files. `ponytail:` comment if it turns out slow; batching snapshots directly is the upgrade.

## R4. Deleting text files that may be open
- **Decision**: delete in one DB transaction (rows of `files`, `documents`, `updates` for every text file under the deleted item). Then `hocuspocus.closeConnections(id)` for each one. `onConnect` refuses ids that are not live text files. `onStoreDocument`/`onChange` skip ids that no longer exist, so a late debounced store can't bring the row back.
- **Rationale**: Hocuspocus stores debounced. Without the guard, a delete followed by the debounce would write the snapshot again.

## R5. Names and collisions
- **Decision**: one `validateName(name, siblings)` in `src/lib/files.ts`, used by client and server. It requires 1–255 chars, no `/` `\`, no control chars, not `.`/`..`, and a name unique among siblings, compared case-insensitively. Create and rename collisions → 409 with a message. An upload collision → the client asks "Replace existing file?" first and then sends `replace=1` for that file. Replacing a text file keeps its id (`setText`); replacing a binary points the row at the new hash. A text↔binary kind change on replace or rename is refused.
- **Rationale**: case-insensitive uniqueness avoids zips that can't be extracted on macOS/Windows.
- **Move cycles**: the server walks `parent_id` up from the target; if it reaches the moved folder → 400.

## R6. Upload transport and limits
- **Decision**: `multipart/form-data` POST to `/api/files` (`request.formData()`), one request per file so the client can show per-file progress (`XMLHttpRequest.upload.onprogress`; `fetch` has no upload progress). Limits come from env: `UPLOAD_MAX_FILE_MB=50`, `IMPORT_MAX_MB=200`, `PROJECT_MAX_FILES=2000`. adapter-node rejects bodies over `BODY_SIZE_LIMIT` (default 512 KB). `server.ts` therefore sets `process.env.BODY_SIZE_LIMIT ??= <IMPORT_MAX_MB + 1 MB>` before importing the handler, and the routes enforce the exact per-file limit.
- **Text detection**: the extension is in the text list (spec FR-006) and the bytes decode with `new TextDecoder('utf-8', { fatal: true })`. If decoding fails, the file is stored as binary.

## R7. Zip export and import
- **Decision**: `fflate`. Export: `zipSync` (or streaming `Zip` once projects grow) of every file at its path; text from the Yjs doc (direct connection), binary from blob. Import: streaming `Unzip` + `UnzipInflate`, counting real inflated bytes and aborting past `IMPORT_MAX_MB` (zip bomb safe even with lying headers). It also aborts past `PROJECT_MAX_FILES` entries. It skips entries with `..` segments, absolute paths, drive letters, backslashes treated as separators, symlinks (external attributes `0o120000` in the upper 16 bits), `__MACOSX/` and `.DS_Store`. If every entry shares one top-level folder, that prefix is stripped. Everything is parsed and validated before any write. Then, in order: delete all files (R4), create folders and files, set main (`main.tex` at root, else the shallowest `.tex` containing `\documentclass`, else none).
- **Rationale**: Node has zlib but no zip container. A correct reader with Zip64 and data-descriptor handling is far more than a few lines; fflate is about 8 KB and has no dependencies.
- **Alternatives**: `adm-zip` / `yauzl` (bigger, callback APIs); `unzip` CLI (not in the image, and a process per import).

## R8. Multi-file compile
- **Decision**: build a ustar stream in Node (`tarProject()`, next to the existing `untar`) of every file at its path: text from Yjs, binary from blob. The job script becomes `mkdir p && tar -x --no-same-owner -C p && cd "p/$MAIN_DIR" && latexmk … "$MAIN_FILE"`, then `tar -c` the main's `.pdf`/`.log`/`.synctex.gz`. `MAIN_DIR`/`MAIN_FILE` are passed with `-e`. They are already validated names, and the script quotes them. latexmk runs bibtex/biber itself (spike: `bibtex`, `biber` and `biblatex.sty` are present in `texlive:latest-medium`).
- **Paths**: names longer than 100 bytes use the ustar `prefix` field (155 bytes), so full paths are capped at 255 bytes. `ponytail:` ceiling; the upgrade is pax headers.
- **Tmpfs**: the job's `/tmp` stays at 256 MB (counted against the 512 MB memory limit), so projects whose files plus outputs exceed that fail with the normal "no PDF" message. `ponytail:` ceiling; raise `COMPILE_TMPFS` in 011.
- **Log → file**: `-file-line-error` prints paths relative to the main's folder (`./chapters/intro.tex:4:`). The server resolves `entry.file` against `MAIN_DIR` to a project path and adds `fileId` when it is a project text file. LogsPanel opens that file at the line (FR-020).
- **No main document**: the compile returns `failure` with "No main document. Right-click a .tex file and choose Set as main document." without starting a container.
- **PDF name**: `output.pdf` route sets `filename="<main base name>.pdf"`.

## R9. Editor with tabs
- **Decision**: one `EditorView`. Each open tab keeps `{ doc: Y.Doc, provider, undoManager, state: EditorState, scrollTop }`; switching saves `scrollTop`, then calls `view.setState(tab.state)` and restores scroll. Before switching, the current `view.state` is written back to the tab. Providers share one socket (`HocuspocusProviderWebsocket`), one per page. Closing a tab destroys its provider/undo/doc. Open ids + active id are stored in `localStorage` key `overtree:tabs`; unknown ids are dropped on load. The editor handle (`window.__overtree` in tests) always points at the active tab.
- **Rationale**: the CodeMirror-recommended way to keep per-document state; `yCollab` binds per state, so undo and remote changes stay per file (SC-004 is easy: `setState` is synchronous).
- **Alternatives**: one `EditorView` per tab hidden with CSS (more DOM, more memory); a single shared state with doc replacement (loses undo and cursor).
- **Non-LaTeX text files** (`.md`, `.txt`, `.bib`, `.csv`, …): same editor without the stex language and without LaTeX completion; `.bib` gets no completion either.

## R10. Tree UI
- **Decision**: hand-written ARIA tree (`role="tree"`, `treeitem`, `group`, `aria-expanded`, roving `tabindex`). Keys: Up/Down/Home/End move, Right/Left expand/collapse or move to child/parent, Enter opens, F2 renames, Delete deletes. Inline `<input>` rows for new/rename. HTML5 drag-and-drop: internal drags carry `application/x-overtree-id`; OS drops have `dataTransfer.files` (folders dropped from the OS are not supported: only files, documented in quickstart). Context menu uses the existing `Menu` class, opened by the kebab button or `contextmenu`. Confirmations use `<dialog>` with `showModal()` (focus trap and Escape come with the platform). Expanded folders persist in `localStorage` (`overtree:tree`).
- **Live updates**: none across browser tabs (006); each tab reloads the list after its own operations.

## R11. Completion source
- **Decision**: `autocompletion({ override: [latexSource], icons: false, addToOptions: [{ position: 90, render: kindLabel }] })`, with `activateOnTyping`. The source looks back from the cursor with regexes:
  - `\\[a-zA-Z@]*$` → commands (bundled + project `\newcommand`s), environment snippets (`\begin{}`) and `\usepackage` snippets; `from` = position of `\`, so CodeMirror's fuzzy matcher (`FuzzyMatcher`, prefix-first ranking and match highlighting built in) works on the whole `\name`.
  - `\\(ref|eqref|autoref|pageref|cref|Cref|nameref)\{([^}]*)$` → labels; `\\(cite[tp]?|parencite|textcite|autocite|nocite)\*?(\[[^\]]*\])*\{([^}]*,)?\s*([^,}]*)$` → bib keys; `\\(usepackage|RequirePackage)(\[[^\]]*\])?\{([^}]*,)?([^,}]*)$` → packages; `\\(input|include|includegraphics|bibliography|addbibresource)(\[[^\]]*\])?\{([^}]*)$` → paths filtered by extension; `\\(begin|end)\{([^}]*)$` → environments.
  - No completion when the line before the cursor has an unescaped `%` (same `stripComment` rule as the outline) or the file is not `.tex/.cls/.sty`.
  - Snippets: `snippetCompletion('\\section{${}}', …)`, `\\usepackage{${1}}` and `\\usepackage[${2}]{${1}}` (cursor in braces first, Tab → options, Tab → out), `\\begin{${1}}\n\t${2}\n\\end{}` with the mirror (R12).
  - Kind label is a field on our option objects (`kind: 'cmd' | 'env' | 'pkg' | 'label' | 'cite' | 'file'`), rendered right-aligned and muted like the screenshot. `detail` carries extra info (bib title, the signature).
- **Rationale**: built-in fuzzy matching, keyboard handling (Up/Down/PageUp/PageDown/Enter/Escape; Tab added via `acceptCompletion` in our keymap), ARIA listbox with `aria-activedescendant`, and snippet tab stops: nothing custom except context detection and data.
- **Data**: `data.ts` is a hand-curated list of commands (name, snippet, optional detail), environments and packages, written for this project (not copied from AGPL sources).

## R12. `\begin{}` → `\end{}` mirroring and Enter auto-close
- **Decision (mirror)**: a `StateField` holding `{ beginNameRange, endNameRange } | null`, set by an annotation dispatched when the `\begin` snippet is applied (the completion's `apply` function inserts the snippet and then dispatches the annotation). Ranges map through changes. While the selection is inside the begin-name range, an `updateListener` (or transaction extender) rewrites the end-name range to equal the begin name. The field clears when the cursor leaves that range or the begin text no longer parses.
- **Decision (Enter)**: a `Prec.high` keymap on `Enter`. If the cursor is at line end and the text before matches `\\begin\{([^}]+)\}(\[[^\]]*\]|\{[^}]*\})*\s*$`, it counts `\begin{name}` vs `\end{name}` from the cursor to the end of the doc. If there is no surplus `\end{name}`, it inserts `\n<indent>\t\n<indent>\end{name}` and puts the cursor on the middle line. Otherwise it returns false (default Enter).
- **Rationale**: CodeMirror snippets have no mirrored fields; this is about 40 lines and testable with a headless `EditorState`.

## R13. Project symbols for files that are not open
- **Decision**: `GET /api/project/symbols` returns `{ labels: string[], commands: {name, args}[], environments: string[], bibKeys: {key, title?, author?}[], files: {path, kind}[] }`. It is computed from every text file's current Yjs text (direct connection, read-only) with the same `scanTex`/`scanBib` the client uses. The client fetches it on load, after each tree operation and on tab switch (debounced 500 ms). For open tabs, the client rescans their live text on change (debounced 300 ms) and those results replace that file's server-provided entries. This meets FR-029 (≤ 2 s) for everything a single user can change.
- **Rationale**: avoids syncing every document to the browser. Once collaboration lands (006), edits by others in closed files show up on the next fetch.
- **Scan rules**: `\label\{([^}]+)\}`; `\\(re)?newcommand\*?\{?\\([a-zA-Z@]+)\}?(\[(\d)\])?`, `\\providecommand…`, `\\DeclareMathOperator\*?\{\\(\w+)\}`, `\\def\\([a-zA-Z@]+)`, `\\newenvironment\{([^}]+)\}`; comments stripped per line. Bib: `@(\w+)\s*\{\s*([^,\s]+)\s*,` excluding `@string`, `@comment`, `@preamble`, with `title`/`author` fields read up to the entry's closing brace.

## R14. Previews
- **Decision**: image tab → `<img src="/api/files/<id>/raw" alt="<name>">` centered, `object-fit: contain`; SVG is served with `Content-Security-Policy: sandbox` and `Content-Type: image/svg+xml` so scripts inside can't run. PDF tab → existing `PdfViewer` with that URL (zoom and pages; no dark toggle requirement). Other binaries → message + download. The raw route sets `Content-Disposition: attachment` when `?download` is present and `X-Content-Type-Options: nosniff` always.
