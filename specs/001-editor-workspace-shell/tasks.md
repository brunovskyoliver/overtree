---

description: "Task list for feature 001 Editor workspace shell"
---

# Tasks: Editor workspace shell

**Input**: Design documents from `specs/001-editor-workspace-shell/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/collab.md, contracts/ui.md, quickstart.md

**Tests**: Required. Constitution IV and SC-007 say every acceptance scenario must be an automated test (Vitest at the seams, Playwright for journeys, two browser contexts for sync).

**Organization**: Tasks are grouped by user story so each story can be built and tested on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: User story the task belongs to (US1–US5)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization

- [X] T001 Scaffold a SvelteKit project (Svelte 5, TypeScript strict, pnpm, minimal template) at the repo root with `pnpm dlx sv create`, keeping the existing `.specify/`, `.claude/` and `specs/` folders; switch to `@sveltejs/adapter-node` in `svelte.config.js`; add `data/`, `build/`, `test-results/` and `playwright-report/` to `.gitignore`
- [X] T002 Add runtime deps `yjs y-protocols @hocuspocus/server @hocuspocus/provider ws codemirror @codemirror/legacy-modes @codemirror/language @codemirror/search y-codemirror.next paneforge drizzle-orm better-sqlite3` and dev deps `drizzle-kit vitest @playwright/test @types/ws @types/better-sqlite3` in `package.json`; check that `yjs` resolves to a single 13.x copy (`pnpm why yjs`)
- [X] T003 [P] Configure scripts in `package.json`: `dev`, `build`, `start` (`node server.ts`), `check`, `test` (vitest run), `test:e2e` (playwright test), `db:generate` (drizzle-kit generate)
- [X] T004 [P] Configure Vitest (`vite.config.ts` test block, `tests/unit/**`) and Playwright in `playwright.config.ts` (webServer: `pnpm build && node server.ts` with `PORT=4173`, `DATA_DIR` = a fresh temp dir per run, `PUBLIC_TEST_HOOKS=1`; projects chromium, firefox, webkit; tests in `tests/e2e/`)
- [X] T005 [P] Set `allowImportingTsExtensions` and `rewriteRelativeImportExtensions` (or `noEmit`) in `tsconfig.json` so `server.ts` and `src/lib/server/*` can import each other with `.ts` extensions under Node type stripping

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Persistence, the realtime server and the dark page frame every story needs

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Define the tables in `src/lib/server/schema.ts` exactly as data-model.md: `documents` (`name` text PK, `state` blob not null, `updated_at` integer unix ms not null) and `updates` (`id` integer PK autoincrement, `doc_name` text not null indexed, `update` blob not null, `created_at` integer unix ms not null); add `drizzle.config.ts` and generate the first migration into `drizzle/`
- [X] T007 Implement `src/lib/server/db.ts`: open `better-sqlite3` at `$DATA_DIR/overtree.db` (default `./data`, create the directory), enable WAL, run drizzle `migrate()` from `drizzle/`, export the drizzle instance (erasable TS only, relative `.ts` imports, no `$lib`/`$env` aliases)
- [X] T008 Implement `src/lib/server/collab.ts` per contracts/collab.md and research R1–R2 (relative `.ts` imports, no `$lib`/`$env` aliases): `Hocuspocus` instance with `debounce: 500`, `maxDebounce: 2000`; `onChange` inserts each `update` into `updates` synchronously; `onStoreDocument` writes the snapshot to `documents` and deletes compacted `updates` rows in one transaction; `onLoadDocument` applies snapshot + remaining updates in id order, and seeds the starter text into `Y.Text('content')` when both are empty; `onConnect` rejects any document name other than `main.tex`; export `attachCollab(httpServer)`, which handles `upgrade` on `/collab` only (ws `noServer`, `IncomingMessage` → `Request`, forward `handleMessage`/`handleClose`)
- [X] T009 Add a Vite plugin in `vite.config.ts` whose `configureServer` calls `attachCollab(server.httpServer)` so `pnpm dev` serves `/collab`
- [X] T010 Create the production entry `server.ts`: `http.createServer(handler)` from `./build/handler.js`, `attachCollab(server)`, listen on `PORT` (default 3000) and `HOST` (default `127.0.0.1`; the Dockerfile sets `0.0.0.0`); relative `.ts` imports only
- [X] T011 [P] Add dark theme tokens (colors from `reference-layout.png`: app background, panel, borders, green accent, text, focus ring) and base styles in `src/app.css`, imported from `src/routes/+layout.svelte`
- [X] T012 Vitest `tests/unit/collab.test.ts`: start an http server on a random port with `attachCollab` and a temp `DATA_DIR`; two `HocuspocusProvider` clients (Node `ws` polyfill) on `main.tex` see each other's edits; a fresh server on the same `DATA_DIR` returns the stored text; text survives a restart even when the server is stopped before any snapshot is written (updates log only); after a store, `updates` is compacted and the text is unchanged on reload; first load returns the seed exactly once; a connection to another document name is rejected

**Checkpoint**: `pnpm test` passes the collab test; `pnpm dev` serves a dark empty page and `/collab`.

---

## Phase 3: User Story 1 - Write LaTeX and keep it (Priority: P1) 🎯 MVP

**Goal**: an editor bound to the shared `main.tex` that persists, syncs across tabs and supports undo/redo.

**Independent Test**: type, reload, text kept; two tabs sync; undo/redo steps through edits.

### Tests for User Story 1

- [X] T013 [P] [US1] Playwright `tests/e2e/persistence.spec.ts`: fresh start shows the seed text with the editor focused and ready (US1-1); type then reload within one second, text kept (US1-2, SC-001); undo/redo by keyboard and by toolbar buttons (US1-4); line numbers, matching-bracket highlight and distinct token classes for command, comment and math present, asserting the classes the stex mode actually emits (US1-5)
- [X] T014 [P] [US1] Playwright `tests/e2e/sync.spec.ts`: two browser contexts, an edit in one appears in the other in < 300 ms (US1-6, SC-003); closing the socket through `window.__overtree.provider` shows "Offline", and edits made then appear in the other context after reconnect (edge case, FR-015)
- [X] T015 [P] [US1] Vitest `tests/unit/restart.test.ts`: write through a provider, close the server, reopen on the same `DATA_DIR`, identical text (US1-3, SC-002). Done as the existing "keeps text across a restart" case in `tests/unit/collab.test.ts` (phase 2); no separate file.

### Implementation for User Story 1

- [X] T016 [P] [US1] Editor theme and highlight style in `src/lib/editor/theme.ts` (dark, matching reference: commands, arguments, comments, math, active line, selection, matching bracket, gutter)
- [X] T017 [US1] `src/lib/components/Editor.svelte`: create `Y.Doc` + `HocuspocusProvider` (`url` from `location`, path `/collab`, name `main.tex`); `EditorView` with `basicSetup` minus `history`, `StreamLanguage.define(stex)`, theme, `yCollab(ytext, provider.awareness, { undoManager })`; focus the editor on load; destroy everything on unmount; expose `{ view, undoManager, provider }` to the parent via a bindable prop; expose `window.__overtree = { provider }` only when `import.meta.env.DEV` or `PUBLIC_TEST_HOOKS` from `$env/dynamic/public` is set
- [X] T018 [US1] Tab strip above the editor in `Editor.svelte` showing `main.tex` and the sync badge (`role="status"`: "Saved" / "Connecting…" / "Offline" from provider status events), per contracts/ui.md
- [X] T019 [US1] Undo/redo buttons at the start of the toolbar in `src/lib/components/Toolbar.svelte` calling `undoManager.undo()/redo()` (`role="toolbar" aria-label="Formatting"`, `aria-label` + `title` on each button)
- [X] T020 [US1] `src/routes/+page.svelte`: top bar (app name "Overtree" + constant `PROJECT_NAME`) and the editor filling the page (layout panes come in US2); SSR off for the page (`export const ssr = false` in `+page.ts`) since the editor is client-only

**Checkpoint**: MVP. Editing persists and syncs; T013–T015 pass.

---

## Phase 4: User Story 2 - Workspace layout (Priority: P1)

**Goal**: the three-pane dark workspace with resizable, collapsible, remembered panes.

**Independent Test**: three panes visible; drag splits; collapse/expand; reload restores layout; keyboard reaches all controls.

### Tests for User Story 2

- [X] T021 [P] [US2] Playwright `tests/e2e/layout.spec.ts`: sidebar (tree with `main.tex`, outline), editor and PDF pane visible (US2-1); drag the tree/outline divider and both vertical borders, sizes change and respect minimums (US2-2, US2-6); collapse/expand sidebar and PDF via the arrow buttons, editor widens and the previous width comes back (US2-3, US2-4); PDF empty-state text shown (US2-5); reload restores sizes and collapsed state (US2-7, FR-018); Tab order reaches handles, toolbar buttons, tree item and outline entries with a visible focus outline and accessible names (US2-8, FR-016); 1024 px wide window keeps minimum widths (edge case)

### Implementation for User Story 2

- [X] T022 [P] [US2] `src/lib/components/FileTree.svelte`: header "File tree", `role="tree"` with one `role="treeitem" aria-selected="true"` item `main.tex` (FR-011)
- [X] T023 [P] [US2] `src/lib/components/PdfPane.svelte`: empty state "No PDF yet. Compiling arrives in a later version." (FR-014)
- [X] T024 [US2] `src/lib/components/Workspace.svelte`: paneforge outer horizontal group `autoSaveId="overtree:layout:main"` (sidebar default 20% min 12% collapsible | editor min 25% | pdf default 40% min 15% collapsible) and inner vertical group `autoSaveId="overtree:layout:sidebar"` (tree default 50% min 15% / outline slot min 15%); handles styled like the reference with collapse/expand `<button>`s (`aria-label` "Collapse sidebar"/"Expand sidebar"/"Collapse PDF"/"Expand PDF", `aria-expanded`) calling `pane.collapse()/expand()`; outline slot takes a snippet
- [X] T025 [US2] Wire `Workspace` into `src/routes/+page.svelte` with FileTree, an outline placeholder slot, Editor and PdfPane; visible `:focus-visible` styles on all controls in `src/app.css`

**Checkpoint**: US1 + US2 tests pass. The UI matches the reference layout.

---

## Phase 5: User Story 3 - Navigate by outline (Priority: P2)

**Goal**: a live outline of section headings with click-to-jump and a current-section highlight.

**Independent Test**: mixed headings are listed in order with indentation; clicking jumps; new headings appear within 1 s.

### Tests for User Story 3

- [X] T026 [P] [US3] Vitest `tests/unit/outline.test.ts` for `parseOutline`: three levels in order with correct `level`/`line` (US3-1); `% \section{Old}` skipped and `\%` not treated as a comment (US3-4); `\section*{Preface}` and `\section[Short]{Long title}` → "Preface", "Long title"; `\section{The \emph{best} way}` → "The best way"; empty text → `[]`; 5,000-line input parses in < 16 ms
- [X] T027 [P] [US3] Playwright `tests/e2e/outline.spec.ts`: click an entry far down a long document, cursor on that line, editor focused, line in view (US3-2, SC-005); type `\section{Methods}`, entry appears within 1 s (US3-3); entry containing the cursor has `aria-current="location"` (US3-5); empty document shows "No sections yet"

### Implementation for User Story 3

- [X] T028 [P] [US3] Implement `parseOutline(text): { level: 1 | 2 | 3; title: string; line: number }[]` in `src/lib/outline.ts` per contracts/ui.md outline rules (1-based lines, level 1 = section)
- [X] T029 [US3] `src/lib/components/Outline.svelte`: `<nav aria-label="File outline">` with header "File outline", a list of buttons indented by level, the current entry marked by `aria-current="location"` and the green highlight, and "No sections yet" when empty; re-parse on Y.Text changes debounced 200 ms; track the cursor line via an `EditorView.updateListener`; click → `view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })` then `view.focus()`
- [X] T030 [US3] Put `Outline` into the Workspace outline slot in `src/routes/+page.svelte`, sharing the editor's `view`

**Checkpoint**: US1–US3 tests pass.

---

## Phase 6: User Story 4 - Format with the toolbar and search (Priority: P2)

**Goal**: Bold, Italic, Section, Link, Figure and Table insertions plus the search button.

**Independent Test**: each button produces the contract text; search finds and replaces; one undo reverts an insertion.

### Tests for User Story 4

- [ ] T031 [P] [US4] Vitest `tests/unit/commands.test.ts`: each command on an `EditorState` with and without a selection gives the exact text, selection and cursor from contracts/ui.md (US4-1 … US4-5), including Figure/Table on a non-empty line starting a new line
- [ ] T032 [P] [US4] Playwright `tests/e2e/toolbar.spec.ts`: select a word → Bold/Italic/Section/Link via buttons; Figure and Table on an empty line; one Ctrl/Cmd+Z reverts a whole insertion (US4-7); the search button and Ctrl/Cmd+F open the find panel, find highlights matches, and replace-one / replace-all work (US4-6)

### Implementation for User Story 4

- [ ] T033 [P] [US4] Implement `wrap(before, after)`, `bold`, `italic`, `section`, `link`, `figure`, `table` as `(view: EditorView) => boolean` commands in `src/lib/editor/commands.ts`, each a single `view.dispatch`, per contracts/ui.md
- [ ] T034 [US4] Add Bold, Italic, Section, Link, Figure, Table and Search buttons to `src/lib/components/Toolbar.svelte` (icons, `aria-label`, `title`); before each insertion call `undoManager.stopCapturing()` so it is its own undo step; Search calls `openSearchPanel(view)`; style the CodeMirror search panel for the dark theme in `src/lib/editor/theme.ts`

**Checkpoint**: US1–US4 tests pass.

---

## Phase 7: User Story 5 - Run it with one command (Priority: P3)

**Goal**: `docker compose up` runs the app with persistent data, bound to loopback by default.

**Independent Test**: compose up, type, down/up, text kept.

- [ ] T035 [P] [US5] `Dockerfile` (multi-stage `node:24-bookworm-slim`, pnpm via corepack; builder: `pnpm install --frozen-lockfile && pnpm build`; runtime: prod deps, `build/`, `server.ts`, `src/lib/server/`, `drizzle/`; `ENV DATA_DIR=/data PORT=3000 HOST=0.0.0.0`; `CMD ["node","server.ts"]`) and `.dockerignore`
- [ ] T036 [P] [US5] `compose.yaml`: one `app` service, `ports: ["${OVERTREE_BIND:-127.0.0.1}:${PORT:-3000}:3000"]`, named volume `overtree-data:/data`, `restart: unless-stopped` (FR-017)
- [ ] T037 [US5] Smoke script `scripts/compose-smoke.sh`: `docker compose up -d --build`, wait for HTTP 200 on `127.0.0.1:${PORT:-3000}`, write text through a Node provider client, `docker compose down` then `up -d`, read the text back, check that the port isn't published on `0.0.0.0`; run it once and record the result (US5-1, US5-2, SC-006)

**Checkpoint**: all stories work.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T038 [P] Performance check in `tests/e2e/perf.spec.ts`: load a 5,000-line document, typing latency stays < 50 ms per keystroke and the outline updates within 1 s; editor interactive < 2 s after navigation (SC-004, edge case)
- [ ] T039 [P] Write `README.md`: what Overtree is, `pnpm dev`, tests, `docker compose up`, `OVERTREE_BIND`/`PORT`/`DATA_DIR`, and the no-login warning
- [ ] T040 Run the quickstart.md validation end to end (`pnpm check`, `pnpm test`, `pnpm test:e2e`, compose smoke) and compare the running UI against `reference-layout.png` by screenshot
- [ ] T041 Set roadmap row 001 to `done` in `specs/ROADMAP.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (1) → Foundational (2) → user stories.
- US1 (3) is the MVP and comes first. US2 (4) wraps the editor in panes and needs US1's `Editor.svelte`.
- US3 (5) needs the editor `view` and the outline slot from US2. US4 (6) needs the toolbar from US1. US3 and US4 are independent of each other.
- US5 (7) needs only Foundational + a buildable app; it can run after US1.
- Polish (8) after all stories.

### Within Each Story

Tests are written alongside or before implementation and must pass at the checkpoint. Pure modules (`outline.ts`, `commands.ts`) come before the components that use them.

### Parallel Opportunities

- T003, T004, T005 in parallel after T002.
- T011 in parallel with T006–T010.
- In US1: T013, T014, T015, T016 in parallel.
- US3 and US4 phases can run in parallel after US2; inside them T026/T027/T028 and T031/T032/T033 are parallel.
- T035 and T036 in parallel.

## Parallel Example: User Story 3

```text
T026 tests/unit/outline.test.ts
T027 tests/e2e/outline.spec.ts
T028 src/lib/outline.ts
```

## Implementation Strategy

### MVP First

1. Phases 1–2 (setup + collab/persistence).
2. Phase 3 (US1): editor that persists and syncs. Stop and validate: this is the MVP.

### Incremental Delivery

3. US2 layout → US3 outline → US4 toolbar → US5 compose → polish. Each phase ends with its tests green and one commit `feat(001): phase N <name>`.
