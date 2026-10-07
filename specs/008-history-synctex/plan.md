# Implementation Plan: Project history, restore, SyncTeX & PDF navigation

**Branch**: `008-history-synctex` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-history-synctex/spec.md`

## Summary

History: a never-compacted `history_log` of every Yjs update (with the author from Hocuspocus' connection context) and every tree change, from which `versions` are closed by a 30 s sweep (5 min idle / 30 min max), by compiles and by restores. Each version stores a manifest blob (tree + content hashes, contents as content-addressed blobs) so zips and restores need no replay. Diffs with per-author colors come from replaying a file's log into a `gc: false` Y.Doc and calling `Y.Text.toDelta(snapB, snapA, computeYChange)`. Restores are minimal Yjs edits through `openDirectConnection` with the restorer's context plus tree operations, each checked against 005's effective file roles (skip-and-report for whole-project restores). SyncTeX: a small server-side parser of the existing `output.synctex.gz` answers forward/reverse queries; the PDF viewer keeps page/offset/zoom across recompiles and reloads; a Layout menu adds editor-only, PDF-only and a separate PDF window linked by `BroadcastChannel`. Research: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 6 (strict), Node 24, Svelte 5 runes, SvelteKit 3

**Primary Dependencies**: existing (Hocuspocus 4.7, Yjs 13.6, y-codemirror.next, CodeMirror 6, Drizzle, better-sqlite3, fflate, pdfjs-dist 6, paneforge) + new `fast-diff` (R14)

**Storage**: SQLite migration `0004` (`history_log`, `versions`, `version_labels`); manifests and text contents as blobs in `data/blobs/`; `compile/<pid>/sync.json`

**Testing**: Vitest (history log/close/sweep, manifest, attribution diff, restore incl. permissions/skips, labels, version zip, route guards, SyncTeX parser on a committed fixture); Playwright with the test auth bypass (two contexts for live restore and attribution, reader/editor-override contexts, synctex, PDF position, layout and popup window)

**Target Platform**: self-hosted Linux Docker image; Chromium, Firefox, WebKit

**Project Type**: web application (single SvelteKit app with in-process WebSocket server)

**Performance Goals**: History first page < 1 s at 1,000 versions (indexed `(projectId, id)` query, 50 per page); restore of ≤ 50 files visible to collaborators < 2 s; SyncTeX query < 100 ms after the first parse of a compile (cached)

**Constraints**: no second write path for text (restores go through Yjs); history never rewritten; all checks server-side; Principle III: no TeX tooling in the app process (SyncTeX parsed in TS)

**Scale/Scope**: projects up to 2,000 files (003 limit), histories of thousands of versions; one Node process

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
|---|---|---|
| I. Collaboration is the data model | ✅ | History copies CRDT updates into an append-only log; restores are Yjs transactions through Hocuspocus (direct connection), live for everyone. Binaries stay content-addressed blobs. |
| II. Self-hostable by one person | ✅ | SQLite + data volume only; no new service; env knobs have defaults. |
| III. Untrusted compilation | ✅ | No new TeX execution; SyncTeX output parsed as data in TS (R9). |
| IV. Test the seams | ✅ | Vitest for server logic and Yjs replay/restore; Playwright per user story, two contexts for live restore/attribution. |
| V. Simplicity first | ✅ with note | Versions derived from the log (no in-memory state); one new tiny dependency. One custom parser (SyncTeX) — see Complexity Tracking. `ponytail:` on replay cost (R4) and synctex cache size. |
| Tech constraints | ✅ | Svelte 5, Drizzle, pdf.js, CodeMirror 6, Clerk sessions unchanged. |
| Workflow | ✅ | Branch `008-history-synctex`, ROADMAP row updated when done. |

Post-design re-check: unchanged, passes.

## Project Structure

### Documentation (this feature)

```text
specs/008-history-synctex/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/http-api.md  contracts/ui.md
├── checklists/requirements.md
├── progress.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
drizzle/0004_*.sql                       # generated migration
src/lib/server/
├── schema.ts            # + historyLog, versions, versionLabels
├── history.ts           # NEW: logText/logTree, ensureBaselines, closeVersion, sweep, manifest, list/get versions
├── history-diff.ts      # NEW: replay + snapshot attribution, fast-diff fallback, FileDiff building
├── restore.ts           # NEW: restoreFile/restoreProject with permission planning
├── synctex.ts           # NEW: parser + forward/reverse queries + per-pdfId cache
├── collab.ts            # onChange → logText; start sweep
├── files.ts             # tree ops take `actor` and log tree rows; setText → minimal edit with context
├── compile.ts           # write sync.json; closeVersion before compile
├── projects.ts          # deleteProject removes history rows
├── zip.ts               # zip from a manifest
└── access.ts            # ProjectEvent 'history'
src/routes/api/projects/[pid]/
├── history/+server.ts, history/[vid]/+server.ts, history/[vid]/zip/+server.ts, history/[vid]/restore/+server.ts
├── history/labels/+server.ts, history/labels/[lid]/+server.ts
└── compile/sync/code/+server.ts, compile/sync/pdf/+server.ts
src/routes/project/[id]/pdf/+page.svelte (+page.ts)   # separate PDF window
src/lib/
├── history.svelte.ts    # NEW: client state (pages, selection, compare mode, actions)
├── layout.svelte.ts     # NEW: layout mode + BroadcastChannel link to the PDF window
├── synctex.ts           # NEW: client calls + highlight helpers
└── components/
    ├── HistoryView.svelte, HistoryTimeline.svelte, HistoryDiff.svelte   # NEW
    ├── LayoutMenu.svelte, SyncStrip.svelte                              # NEW
    ├── TopBar.svelte, Workspace.svelte, PdfPane.svelte, PdfViewer.svelte, Editor.svelte   # changed
tests/unit/history.test.ts, history-diff.test.ts, restore.test.ts, synctex.test.ts (+ fixtures/synctex/)
tests/e2e/history.spec.ts, restore.spec.ts, synctex.spec.ts, pdf-position.spec.ts, layout-menu.spec.ts
```

**Structure Decision**: same single SvelteKit app as 001–005; new server modules next to the existing ones, new routes under `/api/projects/[pid]/`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Custom SyncTeX parser (~200 lines) despite "libraries first" | No maintained JS SyncTeX library; navigation needs it | `synctex` CLI means TeX tooling per click (container per query: slow; in the app image: against Principle III) |
| Second log of Yjs updates (`history_log`) | History needs every update with its author; `updates` is compacted | Disabling compaction slows every document load with history length |
