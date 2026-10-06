# Overtree Constitution

Overtree is a self-hosted, Overleaf-style collaborative LaTeX editor: several people edit one project at the same time, the PDF recompiles live, and projects can be shared by link or invite.

## Core Principles

### I. Collaboration Is the Data Model
Every text file is a Yjs document from the first feature on, even while the app is single-user. Edits travel as CRDT updates over WebSocket; the server persists updates and snapshots. No feature may introduce a second, non-CRDT write path for text content. Binary files (images, PDFs, fonts) are immutable blobs addressed by content hash.

### II. Self-Hostable by One Person
The whole system runs with `docker compose up` on one machine: one app container, one TeX compile image, SQLite and a data directory on a volume. No managed cloud services except Clerk for authentication, no external queues, no Redis until a measured need exists. Configuration is environment variables with working defaults.

### III. Untrusted Compilation
LaTeX source is untrusted input. Compiles run in a separate container per job with no network, `-no-shell-escape`, CPU/memory/time limits and a read-only TeX tree. The app server never runs TeX in its own process.

### IV. Test the Seams
Each feature ships tests at its boundaries: Vitest for server logic and Yjs sync, Playwright for user journeys (two browser contexts for any collaborative behavior). A feature is not done until its acceptance scenarios from `spec.md` pass as automated tests.

### V. Simplicity First
Use the platform and the chosen libraries before writing custom code. No abstractions with one implementation, no config for values that never change, no speculative scaffolding. Shortcuts with a known ceiling are marked with a `ponytail:` comment naming the ceiling and the upgrade path.

## Technology Constraints

- **App**: SvelteKit (Svelte 5 runes) + TypeScript (strict), `adapter-node`, pnpm.
- **Editor**: CodeMirror 6 with `y-codemirror.next` for shared editing, remote cursors and per-user undo (`Y.UndoManager`).
- **Realtime**: Yjs + a WebSocket sync server (Hocuspocus or `y-websocket`) in the same Node process as SvelteKit.
- **Storage**: SQLite via Drizzle ORM; blobs and compile output on the data volume.
- **Auth**: Clerk (Google + email sign-in). The app mirrors users and roles into SQLite; authorization (site roles, project and file permissions) lives in the app, not in Clerk.
- **Compile**: TeX Live image running `latexmk` (pdfLaTeX, XeLaTeX, LuaLaTeX selectable), SyncTeX enabled.
- **PDF**: pdf.js in the browser.
- **UI**: dark theme matching the reference layout (file tree + outline | editor | PDF), keyboard-first, accessible (focus states, ARIA on tree and menus).

## Development Workflow

- Work is delivered as Spec Kit features in the order of `specs/ROADMAP.md`; each feature gets its own branch `NNN-short-name` and `specs/NNN-short-name/` folder.
- `spec.md` describes user-visible behavior only; stack decisions live in `plan.md` and must respect this constitution.
- A feature updates its entry in `specs/ROADMAP.md` when it lands.
- Performance budgets: remote edits visible to other users in < 300 ms on LAN; a recompile of a small document (< 10 pages) returns a PDF in < 5 s.

## Governance

This constitution overrides other practice docs. Plans that break a principle must list the violation and its justification in the plan's Complexity Tracking table. Amendments bump the version (MAJOR: principle removed or redefined, MINOR: principle or section added, PATCH: wording) and note the date.

**Version**: 1.1.0 | **Ratified**: 2026-10-06 | **Last Amended**: 2026-10-06

Amendment 1.1.0: authentication moves from Better Auth to Clerk at the owner's request; Principle II allows Clerk as the one managed service.
