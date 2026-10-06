# Overtree Roadmap

Self-hosted Overleaf clone: multi-user real-time editing, live LaTeX compilation, sharing, history and undo, multi-file projects, LaTeX autocomplete. Stack and rules: `.specify/memory/constitution.md`.

Each row is one Spec Kit feature. Run them in order; the paragraph under each is the description to hand to `/speckit-feature` (or `/speckit-specify`).

Status: `todo` · `in progress` · `done`

## Phase 1: Single-user core

| # | Feature | Status | Depends on |
|---|---------|--------|------------|
| 001 | Editor workspace shell | done | — |
| 002 | Live compilation & PDF preview | done | 001 |
| 003 | Multi-file projects, file tree & LaTeX autocomplete | done | 002 |
| 004 | *(merged into 003)* | — | — |

### 001 Editor workspace shell
SvelteKit app with the three-pane layout from the reference screenshot: left sidebar (file tree on top, file outline below, resizable split), CodeMirror 6 editor in the middle with LaTeX syntax highlighting, line numbers, bracket matching, search, and a formatting toolbar (bold, italic, section, link, figure, table), PDF pane on the right. Dark theme. One project with a single `main.tex`, already stored as a Yjs document synced over WebSocket and persisted to SQLite, so a page reload keeps the text and undo/redo works through `Y.UndoManager`. File outline lists `\section`/`\subsection`/`\subsubsection` and jumps to the line on click. Panes collapse with the arrow handles. Docker Compose file runs the app.

### 002 Live compilation & PDF preview
Recompile button with dropdown (auto-compile on/off, compiler: pdfLaTeX / XeLaTeX / LuaLaTeX, stop on first error). Compilation runs `latexmk` inside a TeX Live container per job, with no network, no shell-escape, and time/memory limits. Auto-compile triggers a few seconds after typing stops. PDF pane renders with pdf.js: page navigation, zoom in/out/fit, dark-mode toggle for the page, download PDF. Logs panel lists errors and warnings parsed from the `.log`, each clickable to jump to file and line, with an error badge on the Recompile button. Last good PDF stays visible while a new compile runs or fails.

### 003 Multi-file projects, file tree & LaTeX autocomplete
One feature covering both parts below (bundled to reach multi-user sooner).

**Files and tree.** File tree with nested folders: create file, create folder, upload (drag-and-drop too), rename, move by drag, delete with confirmation, download. Text files (`.tex`, `.bib`, `.cls`, `.sty`, `.md`, `.txt`) open in the editor as Yjs docs; images and PDFs open in a preview. Editor tabs for open files. Choose the main document from the file's context menu. `\input`/`\include`/`\includegraphics`/`\bibliography` paths resolve against the project tree in compiles. Outline covers the open file. Download the whole project as a zip and create a project by uploading a zip.

**Autocomplete.** Completion popup like Overleaf's (screenshot 2): typing `\` lists commands with a kind label (`cmd`, `env`, `pkg`), fuzzy matching, keyboard navigation, and snippets with tab stops (`\begin{}` inserts the matching `\end{}`; `\usepackage[]{}` puts the cursor in the braces). Sources: a bundled list of common commands and environments, package names for `\usepackage`, commands defined in the project (`\newcommand`, `\newenvironment`), `\label` keys for `\ref`/`\eqref`/`\autoref`, BibTeX keys from project `.bib` files for `\cite`, and project file paths for `\input`/`\includegraphics`. Auto-closing of `\begin{env}` on Enter. Spell-check underline is out of scope here.

## Phase 2: Multi-user

| # | Feature | Status | Depends on |
|---|---------|--------|------------|
| 005 | Accounts & project dashboard | todo | 003 |
| 006 | Real-time collaboration | todo | 005 |
| 007 | Sharing & permissions | todo | 006 |

### 005 Accounts & project dashboard
Sign up, log in, log out, password reset by email link (SMTP optional; without it an admin can reset from the CLI). First registered user becomes admin; admin can disable open sign-up. Dashboard lists the user's projects with last-modified time and owner: create blank or from template (article, report, beamer, letter), rename, duplicate, archive, delete, search. Project title in the top bar is editable (the "ResQFlow ▾" menu). Users have a display name and an avatar color.

### 006 Real-time collaboration
Several users edit the same files at once. Each remote user shows a colored cursor and selection with a name label; avatars of connected users appear in the top bar (the green "S" in the screenshot) and clicking one jumps to their cursor. File tree operations (create, rename, move, delete) propagate live to everyone. Undo/redo only reverts your own changes. Reconnect after network loss merges offline edits without losing text. A compile started by anyone updates the PDF for everyone looking at it, optionally. Tested with two and five concurrent browser sessions.

### 007 Sharing & permissions
Share dialog: invite by email with role Editor or Viewer; "anyone with the link" tokens for view or edit, revocable; list and remove collaborators; transfer ownership. Viewers get a read-only editor, can compile and download, but cannot change files. The server enforces roles on every WebSocket message and HTTP route, not only in the UI. Invitations for unknown emails are accepted after sign-up.

## Phase 3: History, polish, operations

| # | Feature | Status | Depends on |
|---|---------|--------|------------|
| 008 | Project history & restore | todo | 006 |
| 009 | SyncTeX & PDF navigation | todo | 002 |
| 010 | Comments & chat | todo | 006 |
| 011 | Self-hosting hardening | todo | 007 |

### 008 Project history & restore
History panel (the "History" button) with a timeline of versions grouped by time and author, created automatically from Yjs updates plus on every compile. Select a version to see a diff of each changed file against the current state, with additions and deletions colored per author. Name a version (labels). Restore a single file or the whole project to a version; restoring creates a new version instead of rewriting history. Download a zip of any version.

### 009 SyncTeX & PDF navigation
The arrows between the editor and PDF: jump from cursor position to the matching place in the PDF and from a double-click in the PDF to the source line, across files. PDF pane remembers scroll position across recompiles. Layout menu: side-by-side, editor only, PDF only, PDF in a separate window.

### 010 Comments & chat
Select text and add a comment; comments anchor to Yjs relative positions so they survive edits, show in a margin, can be replied to and resolved. Project chat panel with message history and unread badge. Real-time for all collaborators, respecting roles (viewers can comment only if the owner allows).

### 011 Self-hosting hardening
Production Docker Compose with a full TeX Live image, data volume layout, documented backup/restore (SQLite online backup + blob directory), health check, structured logs, rate limits on auth and compile, compile queue with a concurrency cap, upload size limits, HTTPS behind a reverse proxy (Caddy example), and an upgrade path for database migrations.

## Later / not planned yet

- Visual (rich-text) editor mode
- Track changes / review mode
- Git or GitHub sync, Dropbox sync
- Spell checking and grammar
- Reference manager integrations (Zotero, Mendeley)
- AI writing assistant
