---

description: "Task list for feature 008: Project history, restore, SyncTeX & PDF navigation"
---

# Tasks: Project history, restore, SyncTeX & PDF navigation

**Input**: Design documents from `specs/008-history-synctex/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/http-api.md, contracts/ui.md, quickstart.md

**Tests**: Required by the constitution (Principle IV): every acceptance scenario ends as a Vitest or Playwright test.

**Organization**: grouped by user story (spec priorities P1 → P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- Paths are repo-relative (single SvelteKit app, plan.md "Project Structure")

---

## Phase 1: Setup

**Purpose**: dependency, schema, test server knobs

- [X] T001 Add `fast-diff` to dependencies with `pnpm add fast-diff` (package.json, pnpm-lock.yaml) (research R14)
- [X] T002 Add `historyLog`, `versions`, `versionLabels` tables with indexes to `src/lib/server/schema.ts` per data-model.md, then generate `drizzle/0004_*.sql` with `pnpm db:generate`
- [X] T003 [P] Set `HISTORY_IDLE_MS=1500`, `HISTORY_MAX_OPEN_MS=10000`, `HISTORY_SWEEP_MS=500` in the e2e webServer env of `playwright.config.ts` (quickstart.md)

---

## Phase 2: Foundational (blocks all history stories)

**Purpose**: the history log, versions and manifests; every later story reads them

- [X] T004 Create `src/lib/server/history.ts`: `logText(pid, docName, userId, update)`, `logTree(pid, userId)`, `ensureBaselines(pid)` (baseline row per text file without log rows, merged `documents.state` + `updates`), thresholds from env with defaults (research R1, R2)
- [X] T005 In `src/lib/server/history.ts` add the manifest builder: synchronous text read (loaded Hocuspocus doc, else DB state + updates into a fresh `Y.Doc`), text stored via `putBlob`, unchanged files reuse the previous manifest hash; `readManifest(hash)` (research R3)
- [X] T006 In `src/lib/server/history.ts` add `closeVersion(pid, kind, { userId?, restoredFrom? })` (one transaction; no empty non-restore versions; authors, `changed` list with added/edited/deleted/renamed vs previous manifest, `startedAt`) and `sweep(now)` (idle 5 min / max open 30 min), broadcasting `{ type: 'history' }` after each new version (research R2, R8)
- [X] T007 Add `'history'` to `ProjectEvent` in `src/lib/server/access.ts`
- [X] T008 In `src/lib/server/collab.ts` call `logText` in `onChange` with `context.userId` (for every non-presence text doc), and start the sweep (`setInterval(...).unref()`, interval `HISTORY_SWEEP_MS`) plus one sweep at startup
- [X] T009 Add an `actor: string` parameter to `createEntry`, `renameOrMove`, `deleteEntry`, `uploadFile`, `setMainFile` in `src/lib/server/files.ts` that writes a `tree` log row; pass `user.id` from `src/routes/api/projects/[pid]/files/+server.ts`, `files/[id]/+server.ts`, `main/+server.ts`; `setText(id, text, ctx)` passes `{ userId, projectId }` to `openDirectConnection` and applies a minimal `fast-diff` edit instead of delete-all/insert-all (research R5)
- [X] T010 In `src/routes/api/projects/[pid]/compile/+server.ts` call `closeVersion(pid, 'compile')` before `compileProject` (FR-002)
- [X] T011 Remove `history_log`, `version_labels`, `versions` rows (in that order) in project deletion in `src/lib/server/projects.ts`
- [X] T012 [P] Vitest `tests/unit/history.test.ts`: onChange rows carry the socket's user and direct-connection context; baseline rows for existing docs; idle/max-open sweep closes exactly one version; compile with no changes adds nothing; tree ops log the actor; manifest reconstructs tree + texts + main; restart (new attach) closes open rows; project delete removes history

**Checkpoint**: versions accumulate for every project; nothing visible yet

---

## Phase 3: User Story 1 - Browse history and compare (Priority: P1) 🎯 MVP

**Goal**: History panel with timeline and per-author colored diffs, vs current or vs previous

**Independent Test**: quickstart scenarios 1–2

- [X] T013 [US1] Create `src/lib/server/history-diff.ts`: replay a doc's log into `new Y.Doc({ gc: false })`, snapshots at two watermarks, `toDelta(snapB, snapA, computeYChange)` with client→user (structs) and deleter (delete sets) maps, segments `{ op, text, userId }`; `fast-diff` fallback for files without a shared id; `diffVersion(pid, vid, compare, userId)` returning `FileDiff[]` with `canRestore` from `fileRoles` (research R4, contracts/http-api.md)
- [X] T014 [US1] Add `listVersions(pid, { before, limit, labelsOnly })` and `getVersion` (authors/labels resolved to `UserRef` with `colorFor`, unknown users as "Unknown user") to `src/lib/server/history.ts`
- [X] T015 [US1] Routes `src/routes/api/projects/[pid]/history/+server.ts` (GET list, R) and `src/routes/api/projects/[pid]/history/[vid]/+server.ts` (GET diff, R, `compare=current|previous`); vid of another project → 404
- [X] T016 [P] [US1] Vitest `tests/unit/history-diff.test.ts`: two users' edits attributed to each (insert and delete), unknown author → null, vs-previous vs vs-current, added/deleted/renamed/binary entries, fallback path
- [X] T017 [P] [US1] Extend `tests/unit/routes-guarded.test.ts`: history GET routes 401 signed out, 404 non-member, 200 reader
- [X] T018 [US1] Create `src/lib/history.svelte.ts`: paged list (50, `before`), selection, compare mode, refetch on the `history` project event (wire in `src/lib/session.svelte.ts` handlers)
- [X] T019 [P] [US1] Create `src/lib/components/HistoryTimeline.svelte` (listbox, day groups, avatars, changed files, compile icon, restore line, label chips placeholder, infinite scroll, ↑/↓/Enter) per contracts/ui.md
- [X] T020 [P] [US1] Create `src/lib/components/HistoryDiff.svelte` (changed-files nav, per-file segments with `ins`/`del` colored by author via `lightColor`, collapsed context, legend, binary/added/deleted/renamed rows, compare toggle)
- [X] T021 [US1] Create `src/lib/components/HistoryView.svelte` composing timeline + diff; add the History button (`aria-pressed`) to `src/lib/components/TopBar.svelte`; in `src/lib/components/Workspace.svelte` and `src/routes/project/[id]/+page.svelte` show HistoryView over editor+PDF while keeping the editor mounted; Escape closes
- [X] T022 [US1] Playwright `tests/e2e/history.spec.ts`: two contexts edit, reader context sees versions with both authors and colored diff; compile creates a compile-point version, second compile without edits doesn't; compare toggle

**Checkpoint**: MVP part 1 — history is browsable

---

## Phase 4: User Story 2 - Restore a file or the whole project (Priority: P1) 🎯 MVP

**Goal**: restores as new versions, live for collaborators, enforcing roles and per-file overrides

**Independent Test**: quickstart scenarios 3–5

- [X] T023 [US2] Create `src/lib/server/restore.ts`: `planRestore(pid, manifest, userId, onlyFileId?)` (moves/renames back, edits, recreations with new ids folders-first, deletions, main file; each change checked with `fileRoles`), `restoreFile` (403 when not allowed), `restoreProject` (skip and report) — seal open version, apply (texts via `setText` with restorer context, binaries by hash, tree with `logTree`), `closeVersion(pid,'restore',{ userId, restoredFrom })`, broadcast `tree` (research R5)
- [X] T024 [US2] Route `src/routes/api/projects/[pid]/history/[vid]/restore/+server.ts` (POST, E; body `{ fileId? }` → `{ version, skipped }`)
- [X] T025 [P] [US2] Vitest `tests/unit/restore.test.ts`: single file restore; project restore with add/delete/rename/binary/main file; history untouched (old versions still listed); restore version kind and `restoredFrom`; reader 403; editor with read-only override: single file 403, project restore skips and lists it; owner never restricted; concurrent live doc receives the text
- [X] T026 [US2] UI in `src/lib/components/HistoryDiff.svelte` / `HistoryView.svelte`: "Restore this file" when `canRestore`, "Restore project" (E) with `ConfirmDialog`, notice listing skipped paths, errors shown inline; hidden for readers
- [X] T027 [US2] Playwright `tests/e2e/restore.spec.ts`: restore file seen live by second context without reload, Ctrl+Z there doesn't undo it; project restore recreates deleted file and reverts rename; reader sees no restore buttons; editor with read-only override gets skipped list

**Checkpoint**: MVP complete (history + restore)

---

## Phase 5: User Story 3 - SyncTeX navigation (Priority: P2)

**Goal**: → and ← between editor and PDF across files

**Independent Test**: quickstart scenario 6

- [X] T028 [US3] Write `compile/<pid>/sync.json` (`pdfId`, `mainPath`, `paths`) in `compileOnce` in `src/lib/server/compile.ts` when a synctex file is produced; remove it otherwise
- [X] T029 [US3] Create `src/lib/server/synctex.ts`: gunzip + parse (inputs, unit/offset/mag, pages, boxes), path mapping via `sync.json`, `forward(pid, pdfId, fileId, line)`, `reverse(pid, pdfId, page, x, y)`, LRU cache of 4 parsed files with a `ponytail:` note (research R9)
- [X] T030 [P] [US3] Generate and commit a fixture `tests/fixtures/synctex/multi.synctex.gz` + `multi.sync.json` by compiling `tests/fixtures/projects/multi` once (script in the test file's header comment), and Vitest `tests/unit/synctex.test.ts`: forward for a line in `chapters/intro.tex` lands on the right page/box; reverse of that box returns the file and line ±2; TeX Live inputs map to nothing; missing line falls back to the nearest earlier line
- [X] T031 [US3] Routes `src/routes/api/projects/[pid]/compile/sync/code/+server.ts` and `compile/sync/pdf/+server.ts` (R; 404 on stale `pdfId` or no mapping); guard tests in `tests/unit/routes-guarded.test.ts`
- [X] T032 [US3] Create `src/lib/synctex.ts` (client calls) and `src/lib/components/SyncStrip.svelte` (→ / ← buttons, disabled "Compile first"); in `src/lib/components/PdfViewer.svelte` add `showBox(page, boxes)` (scroll + 1 s `.sync-highlight`), `dblclick` → PDF point via the page view's viewport → `onsync(page, x, y)`, and `visiblePoint()` for ←; place the strip in `src/lib/components/Workspace.svelte`; Ctrl/⌘+Alt+J keymap in `src/lib/components/Editor.svelte` (reads cursor file/line via the editor handle); reverse uses the page's existing `openAt`
- [X] T033 [US3] Playwright `tests/e2e/synctex.spec.ts`: import the multi fixture, compile, forward from `chapters/intro.tex` shows the highlight on the right page; double-click a `main.tex` paragraph opens `main.tex` at the line; reader can navigate; buttons disabled before the first compile; after editing (no recompile) forward still lands on a page without error (US3 #3); double-click on a spot that maps only to a TeX Live file changes nothing (US3 #6)

---

## Phase 6: User Story 4 - PDF keeps its place (Priority: P2)

**Goal**: page, offset and zoom survive recompiles and reloads

**Independent Test**: quickstart scenario 7

- [X] T034 [US4] In `src/lib/components/PdfViewer.svelte` track `{ page, offset, scale }` on scroll (throttled), restore offset on `pagesinit` with an `XYZ` destination (page clamped), and persist/load `overtree:pdfpos:<projectId>` (pass `projectId` from `src/lib/components/PdfPane.svelte`) (research R11)
- [X] T035 [US4] Playwright `tests/e2e/pdf-position.spec.ts`: twenty-pages document, scroll to page 5 mid-page, recompile → same page and offset (±5 %); shrink document → last page; reload → same position

---

## Phase 7: User Story 5 - Name versions (Priority: P3)

**Goal**: labels with author/owner rename-delete rights and a labels-only filter

**Independent Test**: quickstart scenario 8

- [X] T036 [US5] In `src/lib/server/history.ts` add `addLabel` (E; no versionId → close open version then label newest), `renameLabel`/`deleteLabel` (author or owner), validation 1–100 chars, broadcast `history`; routes `src/routes/api/projects/[pid]/history/labels/+server.ts` and `history/labels/[lid]/+server.ts`
- [X] T037 [P] [US5] Vitest in `tests/unit/history.test.ts` (labels block): reader 403 on add, other editor 403 on rename/delete, author and owner allowed, label-current creates a version when edits are open, labels-only filter
- [X] T038 [US5] UI: "Label…" in the diff header and "Label current version" in the timeline header (E), label chips with rename/delete menu when `canEdit`, "Labels only" toggle in `src/lib/components/HistoryTimeline.svelte` / `HistoryDiff.svelte`
- [X] T039 [US5] Playwright `tests/e2e/history.spec.ts` (labels block): editor labels, reload shows it, reader sees no menu, labels-only filter

---

## Phase 8: User Story 6 - Download any version (Priority: P3)

**Goal**: zip of the project at any version for every member

**Independent Test**: quickstart scenario 9

- [X] T040 [US6] Add `manifestZip(manifest)` to `src/lib/server/zip.ts` (folders, text and binary from blobs; shared `zipSync` path with `exportZip`) and route `src/routes/api/projects/[pid]/history/[vid]/zip/+server.ts` (R; `Content-Disposition` with `attrChars`)
- [X] T041 [P] [US6] Vitest in `tests/unit/zip.test.ts`: version zip byte-identical per file to that version (text + binary + empty folder); non-member 404; reader 200
- [X] T042 [US6] "Download zip" link in `src/lib/components/HistoryDiff.svelte` and a Playwright check in `tests/e2e/history.spec.ts` (download event, unzip, compare one file)

---

## Phase 9: User Story 7 - Layout menu and separate PDF window (Priority: P3)

**Goal**: side-by-side / editor only / PDF only / separate window, remembered per device

**Independent Test**: quickstart scenario 10

- [X] T043 [US7] Create `src/lib/layout.svelte.ts` (mode in `overtree:layout-mode`, `window.open`, closed-window polling, `BroadcastChannel('overtree:pdf:<pid>')` messages per research R12) and `src/lib/components/LayoutMenu.svelte` (menuitemradio items, popup-blocked notice) in `src/lib/components/TopBar.svelte`
- [X] T044 [US7] Apply modes in `src/lib/components/Workspace.svelte` (collapse/expand panes; window mode hides the PDF pane; strip placement per contracts/ui.md); main page posts `compiled` and `forward` messages and handles `open-at`
- [X] T045 [US7] Create `src/routes/project/[id]/pdf/+page.svelte` (+ `+page.ts` disabling SSR like the project page): own `CompileState`, `PdfPane`, ← button and double-click posting `open-at`, reacts to `compiled` and `forward`, `hello`/`bye`
- [X] T046 [US7] Playwright `tests/e2e/layout-menu.spec.ts`: each mode, reload keeps it; separate window via `context.waitForEvent('page')`, recompile in main updates it, double-click in it moves the main editor cursor, closing it returns to side-by-side; with `window.open` stubbed to return null the popup-blocked notice shows and the mode stays (US7 #4)

---

## Phase 10: Polish & cross-cutting

- [X] T047 [P] Performance check in `tests/unit/history.test.ts`: 1,000 versions, first page query < 1 s (SC-002); restore of 50 files < 2 s (SC-003)
- [X] T048 [P] Accessibility pass on HistoryView, LayoutMenu, SyncStrip (focus states, ARIA per contracts/ui.md); run existing `tests/e2e/layout.spec.ts`, `viewer.spec.ts` and fix regressions
- [X] T049 Update `README.md` (history, SyncTeX, layout, the three env knobs) and `specs/ROADMAP.md` row 008 → `done` (README done; the ROADMAP row is left to the maintainer)
- [X] T050 Run `pnpm check`, `pnpm test`, `pnpm test:e2e` and the quickstart scenarios; fix failures

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → everything else.
- US1 (Phase 3) before US2 (restore UI lives in the diff view), US5 (labels UI) and US6 (zip link). US2's server part (T023–T025) only needs Phase 2.
- US3 (Phase 5), US4 (Phase 6) and US7 (Phase 9) need only Phase 1 (they don't touch history) and can run in any order after it; US7's window uses US3's sync strip when present.
- Polish last.

## Parallel examples

- Phase 2: T012 (tests) alongside T009–T011 once T004–T006 exist.
- US1: T016, T017, T019, T020 in parallel after T013–T015.
- US3 and US4 are independent of each other and of US1/US2.

## Implementation Strategy

MVP = Phases 1–4 (history browsing + restore with permissions). Then US3 + US4 (daily navigation), then US5–US7, then polish. Each phase ends with `pnpm check`, the relevant Vitest files and its Playwright spec green, and one commit `feat(008): phase N <name>`.
