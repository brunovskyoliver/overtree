# Implementation Plan: Editor workspace shell

**Branch**: `001-editor-workspace-shell` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-editor-workspace-shell/spec.md`

## Summary

A SvelteKit app serving one page: the three-pane workspace from `reference-layout.png`. `main.tex` is a `Y.Text` inside a Yjs document, synced by a Hocuspocus server attached to the same Node HTTP server as SvelteKit (path `/collab`) and saved to SQLite through Drizzle as an append-only update log plus compacted snapshots. The editor is CodeMirror 6 with the `stex` legacy mode, `y-codemirror.next` binding and `Y.UndoManager`. Panes are paneforge groups (drag, collapse, local-storage persistence). The outline is a regex parser over the document text. Docker Compose runs one container with a data volume.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 24 LTS (native type stripping for the production server entry)

**Primary Dependencies**: SvelteKit (latest, Svelte 5 runes) + `@sveltejs/adapter-node`; `@hocuspocus/server` + `@hocuspocus/provider` 4.x (hooks only, no Database extension); `yjs` 13.6, `y-protocols`; `ws`; `codemirror` 6 meta-package, `@codemirror/legacy-modes` (stex), `y-codemirror.next`; `paneforge`; `drizzle-orm` + `better-sqlite3`, `drizzle-kit` (dev)

**Storage**: SQLite file at `$DATA_DIR/overtree.db` (default `./data`): `updates` (append-only Yjs updates) and `documents` (compacted snapshot per document)

**Testing**: Vitest (outline parser, toolbar commands, collab server sync + persistence with two in-process providers); Playwright (journeys, two browser contexts for sync)

**Target Platform**: Linux container (node:24-bookworm-slim); desktop Chrome, Firefox, Safari ≥1024 px

**Project Type**: Web application, single SvelteKit project (UI + server in one process)

**Performance Goals**: remote edit visible in another tab < 300 ms (SC-003); editor interactive < 2 s (SC-004); typing and outline stay responsive at 5,000 lines

**Constraints**: one process, no external services; port published on 127.0.0.1 by default (compose binding, and `server.ts` default `HOST`); no second write path for text (only Yjs updates)

**Scale/Scope**: 1 project, 1 document, a handful of concurrent tabs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
|-----------|--------|-----|
| I. Collaboration is the data model | PASS | `main.tex` is a `Y.Text`; only Hocuspocus writes it; every update persisted on arrival plus compacted snapshots; `Y.UndoManager` via `y-codemirror.next`. No HTTP route writes text. |
| II. Self-hostable by one person | PASS | One container, SQLite on a volume, env vars with defaults (`PORT`, `DATA_DIR`, `OVERTREE_BIND`). |
| III. Untrusted compilation | N/A | No compilation in this feature (002). |
| IV. Test the seams | PASS | Vitest for sync/persistence and pure logic; Playwright covers every acceptance scenario, two contexts for cross-tab sync. |
| V. Simplicity first | PASS | Library-first (paneforge, stex mode, Hocuspocus hooks); no project table yet; shortcuts marked `ponytail:`. |
| Tech constraints | PASS | SvelteKit + Svelte 5 runes, adapter-node, pnpm, CodeMirror 6 + y-codemirror.next, Hocuspocus in the same process, SQLite via Drizzle, dark theme, ARIA tree/list. |

Post-design re-check: PASS (no changes).

## Project Structure

### Documentation (this feature)

```text
specs/001-editor-workspace-shell/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── collab.md        # WebSocket endpoint, document/field names, persistence
│   └── ui.md            # toolbar insertions, outline rules, layout storage, test ids
├── reference-layout.png
└── tasks.md
```

### Source Code (repository root)

```text
package.json, pnpm-lock.yaml, svelte.config.js, vite.config.ts, tsconfig.json
drizzle.config.ts
drizzle/                      # generated SQL migrations
server.ts                     # production entry: http server + SvelteKit handler + collab upgrade
Dockerfile, compose.yaml, .dockerignore
src/
├── app.html, app.css         # dark theme tokens
├── routes/
│   ├── +layout.svelte
│   └── +page.svelte          # workspace (top bar, panes)
├── lib/
│   ├── components/
│   │   ├── Workspace.svelte  # paneforge groups, collapse handles
│   │   ├── FileTree.svelte
│   │   ├── Outline.svelte
│   │   ├── Editor.svelte     # CodeMirror + Yjs binding, toolbar, tab strip, sync indicator
│   │   ├── Toolbar.svelte
│   │   └── PdfPane.svelte    # empty state
│   ├── editor/
│   │   ├── commands.ts       # toolbar insertions (pure CodeMirror transactions)
│   │   └── theme.ts          # dark editor theme + highlight style
│   ├── outline.ts            # parseOutline(text) -> entries
│   └── server/
│       ├── db.ts             # better-sqlite3 + drizzle, migrate on open
│       ├── schema.ts         # documents + updates tables
│       └── collab.ts         # Hocuspocus instance, persistence hooks, seeding, attachCollab(httpServer)
tests/
├── unit/                     # vitest: outline, commands, collab
└── e2e/                      # playwright journeys
```

**Structure Decision**: one SvelteKit project. Server-only modules sit in `src/lib/server/`. `collab.ts` exports `attachCollab(httpServer)`. A Vite plugin in `vite.config.ts` calls it in dev, and `server.ts` calls it in production. Every file `server.ts` imports must use erasable TypeScript syntax (no enums, no parameter properties) with explicit relative `.ts` import extensions and no `$lib`/`$env` aliases, because Node runs it without a build step. `server.ts` listens on `HOST` (default `127.0.0.1`); the Docker image sets `HOST=0.0.0.0`.

## Complexity Tracking

No constitution violations.
