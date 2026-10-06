# Implementation Plan: Multi-file projects, file tree & LaTeX autocomplete

**Branch**: `003-multi-file-autocomplete` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-multi-file-autocomplete/spec.md`

## Summary

The single `main.tex` becomes one entry of a `files` table (folders, text files, binary files) with a stable id per entry. Text files are Hocuspocus documents named by file id, so rename and move never touch the CRDT. Binary files are blobs stored once per SHA-256 under `$DATA_DIR/blobs/`. A small REST API under `/api/files` and `/api/project` creates, renames, moves, deletes, uploads, downloads, zips and imports. The Svelte file tree (ARIA tree, HTML5 drag-and-drop, kebab/right-click menu on the existing `Menu` class, native `<dialog>` for confirmations) sits on top of it. The editor keeps one `EditorView` and swaps one `EditorState` per open tab, each with its own provider, `Y.UndoManager` and `yCollab`. Compiles now send a tar of the whole project to the job container on stdin and run `latexmk` from the main document's folder; log entries resolve to project files. Autocomplete uses `@codemirror/autocomplete` (fuzzy matching and snippets are built in) with a LaTeX source over bundled lists plus project symbols. Open files are scanned live; the rest come from `/api/project/symbols`. Two small extensions handle `\begin`→`\end` name mirroring and auto-closing on Enter.

## Technical Context

**Language/Version**: TypeScript 6 (strict), Node 24, Svelte 5 runes, SvelteKit 3 (unchanged)

**Primary Dependencies**: new: `fflate` 0.8 (zip read and write, no dependencies). Existing: Hocuspocus 4, CodeMirror 6 + `@codemirror/autocomplete`, `y-codemirror.next`, Drizzle + better-sqlite3, paneforge, pdfjs-dist.

**Storage**: SQLite tables `files`, `project` (main document); Yjs docs in the existing `documents`/`updates` tables keyed by file id; blobs in `$DATA_DIR/blobs/<sha256>` ([data-model.md](./data-model.md))

**Testing**: Vitest: file service (names, collisions, move cycles, delete cleanup, legacy `main.tex` migration), zip import/export (round trip, malicious zips, limits, wrapper folder), project tar + multi-file compile against real Docker (`\input`, `\includegraphics`, bibtex, main in subfolder), symbol scanner, completion source and both editor extensions (headless `EditorState`). Playwright: every acceptance scenario on Chromium, Firefox and WebKit.

**Target Platform**: unchanged (Linux container with Docker socket, or host in dev; desktop browsers ≥ 1024 px)

**Project Type**: single SvelteKit web app

**Performance Goals**: tab switch < 100 ms for 5,000 lines; completion popup < 100 ms after `\`, < 50 ms per keystroke with 1,000 project keys; small multi-file compile still < 5 s

**Constraints**: no second write path for text (all text writes go through Yjs docs via Hocuspocus); binary files immutable and content-addressed; compile isolation unchanged; upload limits 50 MB/file, 200 MB unpacked zip, 2,000 files (env-configurable); zip entries can never escape the project

**Scale/Scope**: one project (until 005), up to 2,000 files, one user per project (live tree sync is 006)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
|-----------|--------|-----|
| I. Collaboration is the data model | PASS | Every text file is a Yjs doc from creation. Creating, uploading, replacing and importing text all write through a Hocuspocus direct connection (`setText`), the same path as typing. Binary files are immutable blobs addressed by SHA-256. Doc identity is the file id, so rename and move are metadata-only. |
| II. Self-hostable by one person | PASS | Still `docker compose up`, SQLite + data dir. One new pure-JS dependency. Limits are env vars with defaults. |
| III. Untrusted compilation | PASS | Same container flags as 002. The project goes in as a tar on stdin; the in-container `tar -x` runs as uid 1000 in tmpfs with `--no-same-owner`, and paths are validated before the tar is built. |
| IV. Test the seams | PASS | Vitest for the file service, zip, compile and completion logic; Playwright for every acceptance scenario. |
| V. Simplicity first | PASS | CodeMirror's built-in fuzzy matcher and snippets; native HTML5 drag-and-drop and `<dialog>`; existing `Menu`; a 25-line ustar writer next to the existing reader instead of a tar library; fflate only because a zip reader with bomb checks is not a few lines. |
| Tech constraints | PASS | No change to stack. |

Post-design re-check: PASS. No violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-multi-file-autocomplete/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── files-api.md
│   └── ui.md
├── reference-layout.png
├── reference-autocomplete.png
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── files.ts                    # shared: FileEntry type, isTextName, validateName, paths(), kind by extension, limits
│   ├── project.svelte.ts           # client: tree state (load/create/rename/move/delete/upload), open tabs + active, persisted tabs
│   ├── completion/
│   │   ├── data.ts                 # bundled commands (≥300), environments (≥40), packages (≥200)
│   │   ├── scan.ts                 # scanTex / scanBib (pure): labels, \newcommand…, bib keys + title
│   │   ├── source.ts               # CompletionSource: context detection (\cmd, \ref{, \cite{a,…), snippets, kind labels
│   │   └── environments.ts         # \begin→\end mirror field + Enter auto-close keymap
│   ├── components/
│   │   ├── FileTree.svelte         # rewritten: header actions, tree rows, inline name input, DnD, context menu, OS drops
│   │   ├── ConfirmDialog.svelte    # <dialog> for delete / replace / zip import
│   │   ├── EditorTabs.svelte       # tab strip
│   │   ├── FilePreview.svelte      # image / PDF (PdfViewer) / no-preview + download
│   │   ├── Editor.svelte           # one EditorView, EditorState per tab, provider per tab, completion extensions
│   │   ├── Outline.svelte          # follows the active tab
│   │   └── LogsPanel.svelte        # entries open files by path
│   └── server/
│       ├── schema.ts               # + files, project
│       ├── files.ts                # file service: CRUD, blobs, setText, ensureProject (legacy main.tex), tree paths
│       ├── zip.ts                  # exportZip, importZip (fflate streaming, safety rules)
│       ├── collab.ts               # onConnect: doc must be a live text file; store/change guarded for deleted files
│       └── compile.ts              # project tar in, latexmk from main's folder, log paths → file ids
├── routes/api/
│   ├── files/+server.ts            # GET list, POST create (folder|text) / upload (multipart)
│   ├── files/[id]/+server.ts       # PATCH rename/move, DELETE
│   ├── files/[id]/raw/+server.ts   # GET content (inline or ?download)
│   ├── project/+server.ts          # GET { mainFileId }, PUT main
│   ├── project/zip/+server.ts      # GET project.zip, POST import
│   └── project/symbols/+server.ts  # GET labels, commands, envs, bib keys from every text file
drizzle/0002_*.sql
tests/
├── fixtures/projects/              # multi-file sources, sample zips (3 thesis-like, malicious)
├── unit/files.test.ts, zip.test.ts, compile-multi.test.ts, scan.test.ts, completion.test.ts
└── e2e/tree.spec.ts, tabs.spec.ts, multi-compile.spec.ts, upload.spec.ts, completion.spec.ts, arg-completion.spec.ts
```

**Structure Decision**: same layout as 001/002. File logic is server-only in `src/lib/server/files.ts` and `zip.ts`, reached from routes through `getServer()` like `compile.ts`. `src/lib/files.ts` holds the validation shared by client and server, so the inline errors and the server use one rule set.

## Complexity Tracking

No constitution violations.
