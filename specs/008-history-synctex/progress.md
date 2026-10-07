# Feature 008: Project history, restore, SyncTeX & PDF navigation
Stage: implement
Updated: 2026-10-07T00:00:00Z

## Decisions
- Branch `008-history-synctex` created from HEAD of `005-accounts-sharing-collab` (2309f8e), per user.
- Feature dir numbered 008 to match the roadmap row, not the next free number (006).

- Gate 1 (user: B,A,B,B = all recommendations): versions close after 5 min idle / max 30 min; whole-project restore skips read-only files and lists them; diff vs current with toggle for vs previous; labels renamed/deleted only by author or owner.

- Gate 2: user said `go` (full implementation). Fixed M1 (spec diff granularity), M2 (authors only from log rows), M3 (tests for US3 #3/#6, US7 #4), L1 (duplicate starts fresh history).

## Log
- 2026-10-07 specify: spec.md + checklists/requirements.md written; 2 clarification markers left for gate 1.

- 2026-10-07 clarify: 4 answers encoded into spec.md Clarifications + FR-001/007/014/019, US1/US2/US5.
- 2026-10-07 plan: plan.md, research.md (R1–R14), data-model.md, contracts/http-api.md, contracts/ui.md, quickstart.md.
- 2026-10-07 tasks: tasks.md 50 tasks / 10 phases.
- 2026-10-07 analyze: 0 critical, 0 high, 3 medium, 2 low; fixed after go.
- 2026-10-07 implement phase 1-2 (T001–T012): migration 0004, history.ts (log, baselines, manifests, closeVersion, sweep), tree ops take `actor`, setText minimal fast-diff edit with context, compile closes a `compile` version, project delete removes history. Decisions: every new project (create/import/duplicate via insertProject) closes a `baseline` version at once, and the startup sweep gives one to projects without versions (upgrade); the startup sweep closes all open rows regardless of idle time; `closeVersion` returns null when nothing was closed and takes only `{ restoredFrom }` (authors come from rows only).
- 2026-10-07 implement phase 1-2 (T001–T012): e870c3d; pnpm check 0 errors, pnpm test 258/258 (rerun by me), 4 e2e specs 24/24. API: closeVersion returns null when nothing to close; no userId param.
- 2026-10-07 implement phase 3 US1 (T013–T022): history-diff.ts (Yjs replay attribution, fast-diff fallback when the replay doesn't reproduce both texts or the file is deleted, sole-author attribution for fallbacks), listVersions/getVersion/userRefs in history.ts, GET /history and /history/:vid, client History state, HistoryView/Timeline/Diff, TopBar History toggle. Decisions: the diff response also carries `users: UserRef[]` for the legend (contract updated); the History view covers the whole workspace (sidebar included) as an absolute layer in the project page while the Workspace stays mounted with `visibility: hidden` + `inert` (Workspace.svelte unchanged); ↑/↓ select and load the diff, Enter focuses the diff; types shared in src/lib/history-types.ts (`VersionInfo` = contract `Version`).

- 2026-10-07 implement phase 4 US2 (T023–T027): restore.ts `restoreVersion(pid, vid, userId, fileId?)` (plan against the current tree with per-file roles, conflict/cycle fixpoint that skips clashing changes, tree in one transaction: creates parent-first with new ids, moves, binaries, deletes in one statement, main file; texts via `setText` with the restorer's context; seal `edit` first, `restore` version only when something changed), POST /history/:vid/restore, Restore project (confirm) / Restore this file in HistoryDiff with a skipped-files notice. Decisions: single-file restore reuses a same-named existing folder when the file's old folder is gone (no clash), and is a 409 when another file holds its name; a recreated file has a new id, so “Compare with current” after a project restore still lists it as deleted + added at the same path.
- 2026-10-07 implement phase 3 (T013–T022): 4e98fd2; check 0 errors, test 272/272 (rerun by me), e2e history/layout/presence/sharing 20/20.
- 2026-10-07 implement phase 4 (T023–T027): 903139a; test 279/279, e2e restore/history/permissions/tree 17/17.
- 2026-10-07 fix (me): diff pairs a deleted + re-added file at the same path as one edit; restore reuses the current file at a target path instead of recreating it next to it. Unit test added; restore+history e2e 6/6.

- 2026-10-07 implement phase 5 US3 (T028–T033): compile writes `sync.json` (`pdfId`, `mainPath`, `paths`) next to `output.synctex.gz`; `src/lib/server/synctex.ts` parses it (fixture `tests/fixtures/synctex/multi.*` from a real compile of the multi project), GET /compile/sync/code and /compile/sync/pdf, client `src/lib/synctex.ts`, `SyncStrip` on the editor's right rail (above the PDF collapse tab, inside the editor pane so the layout minimums are unchanged), PdfViewer `showBox`/`visiblePoint`/`onsync`, Ctrl/⌘+Alt+J. Decisions: current pdfTeX writes X/Y Offset 0 with the 1in margin already in the coordinates (R9's "add 1in" is wrong; offsets are read from the preamble); reverse picks the smallest hbox around the point, else the nearest hbox, then the last record left of the point in it; "←" uses the point mid-width, a quarter down the visible part of the current page (left quarter hit paragraph indents from main.tex); no mapping (404) does nothing.
- 2026-10-07 implement phase 6 US4 (T034–T035): PdfViewer tracks `{ page, offset, scale }` (the page at the pane's top edge, 0–1 down it) on scroll (150 ms) and on `pagehide`, restores it on `pagesinit` with an XYZ destination (clamped page → its top), stores `overtree:pdfpos:<projectId>` (PdfPane `projectId`). Decision: the toolbar's page number stays pdf.js's most visible page, which can differ from the stored top-edge page by one.
- 2026-10-07 implement phase 7 US5 (T036–T039): addLabel/renameLabel/deleteLabel in history.ts (trimmed 1–100 chars, 400; author or owner for rename/delete, 403; label of another project 404; broadcast `history`), POST /history/labels, PATCH/DELETE /history/labels/:lid, `History.addLabel/renameLabel/deleteLabel`, LabelDialog (name input, server error inline), LabelChip (Rename…/Delete menu when `canEdit`; delete asks first), "Label…" in the diff header, "Label current version" in the timeline header. Decisions: "Label current version" is a tag icon button with that aria-label/title (the 300px header has no room for the text next to "Labels only"); the label routes for rename/delete pass any member through the project guard and let authorship decide (a label author who became a reader may still rename their own label, matching `canEdit`). check 0 errors, test 309/309, e2e history+restore 7/7.

## Report
