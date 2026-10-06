# Feature 001: Editor workspace shell
Stage: done
Updated: 2026-10-06T14:00:00+02:00

## Decisions
- Committed the Spec Kit scaffolding to `main` as the initial commit (4c9bc44), then branched `001-editor-workspace-shell`.
- Reference screenshot copied to `reference-layout.png` in the feature dir.

- Gate 1: user replied `ok`, all five clarify recommendations accepted (draggable pane borders; layout in local storage; session-only undo; top bar + tab strip, no menus; loopback-only port by default).
- Gate 2: user replied `go all`. Applied C1 (update log + snapshot compaction instead of snapshot-only), M1 (HOST defaults to 127.0.0.1, Docker sets 0.0.0.0), M2 ($env/dynamic/public for test hooks), M3 (no $lib/$env aliases in server modules), L1. Docker Desktop: start with `open -a Docker` at phase 7.

## Log
- 2026-10-06 specify: spec.md + checklists/requirements.md written; all checklist items pass.

- 2026-10-06 clarify: 5 answers encoded in spec.md (Clarifications, FR-008/010/017/018, US2 scenarios 6-7).
- 2026-10-06 plan: plan.md, research.md, data-model.md, contracts/{collab,ui}.md, quickstart.md. Stack: Hocuspocus 4 on /collab in-process, paneforge, stex mode, Drizzle+better-sqlite3.
- 2026-10-06 tasks: tasks.md, 41 tasks in 8 phases (MVP = phases 1-3).
- 2026-10-06 analyze: 1 CRITICAL (snapshot-only persistence vs constitution I "persists updates and snapshots"), 0 HIGH, 3 MEDIUM, 2 LOW. Checklist requirements.md 16/16. Docker Desktop daemon not running.
- 2026-10-06 remediation: research, data-model, contracts/collab, plan, tasks updated; analyze rerun: 0 CRITICAL, 0 HIGH.
- 2026-10-06 implement phase 1 setup (87b8696) + phase 2 foundational (e58d758): T001-T012 [X]; pnpm check 0 errors, pnpm test 5/5, build + node server.ts boot OK (verified). Notes: SvelteKit 3 has no svelte.config.js (adapter in vite.config.ts); openDb(dataDir)/attachCollab(httpServer, dataDir?) -> {hocuspocus, wss, db}; seed written to updates directly.
- 2026-10-06 implement phase 3 US1: T013-T020 [X]; pnpm check 0 errors, pnpm test 5/5, e2e 18/18 (6 each chromium/firefox/webkit). Notes: SvelteKit 3 env is `src/env.ts` (defineEnvVars) + `$app/env/public`, not `$env/dynamic/public`; Editor setup in onMount ($effect looped on the bindable write); T015 covered by the existing restart case in collab.test.ts; e2e workers 1, tests reset the doc to SEED in afterEach.
- 2026-10-06 implement phase 3 US1 (08fe91e): T013-T020 [X] (T015 covered by existing collab restart test); verified pnpm check 0 errors, pnpm test 5/5, pnpm test:e2e 18/18 (6 each chromium/firefox/webkit). EditorHandle {view, undoManager, provider} via bindable `editor` prop; test hooks via src/env.ts + $app/env/public.
- 2026-10-06 implement phase 4 US2: T021-T025 [X]; pnpm check 0 errors, pnpm test 5/5, pnpm test:e2e 33/33 (11 each chromium/firefox/webkit). Notes: paneforge 1.0.2 autoSaveId restores collapsed panes on reload (stored as `paneforge:overtree:layout:main|sidebar`, 100 ms debounced write); collapse buttons live in the editor pane edges (not inside the separator, which would start a drag); outline body is a snippet `outline` on Workspace, placeholder in +page.svelte; the Tab test does not cover outline entries yet (phase 5 adds them).
- 2026-10-06 implement phase 4 US2 (c51b5eb): T021-T025 [X]; verified check 0 errors, unit 5/5, e2e 33/33 (11 per browser); screenshot matches reference layout. paneforge autoSaveId keys are prefixed `paneforge:`.
- 2026-10-06 implement phase 5 US3 (7c93411) + phase 6 US4 (737e41e): T026-T034 [X]; verified check 0 errors, unit 16/16, e2e 60/60 (20 per browser). Visual nit: left collapse tab overlaps editor gutter, fix in polish.
- 2026-10-06 implement phase 7 US5 (439ac1a) + phase 8 polish (9a9c0e5): T035-T040 [X]; verified check 0 errors, unit 16/16, e2e 63/63 (21 per browser incl. perf: load 42-93 ms, keystroke avg 3.5-9.7 ms, outline 211-300 ms), scripts/compose-smoke.sh PASS (HTTP 200, text survives down/up, bound to 127.0.0.1 only). Image 465 MB. Dockerfile pins pnpm 10.33.0. Collapse tabs no longer cover the gutter.
- 2026-10-06 converge: 0 CRITICAL/HIGH, 2 MEDIUM, 4 LOW. F2 (smoke result unrecorded) resolved by the line above; F6 (lineWrapping) justified in research R4; T042-T045 appended as Phase 9.
- 2026-10-06 implement phase 9 convergence (5a852cd): T042-T045 [X]; collapsed sidebar inert, layout reload test covers sidebar split + collapse, outline handles `\\section` and `\LaTeX{}`, comment fixed.
- 2026-10-06 final: check 0 errors, unit 17/17, e2e 66/66 (22 per browser), build OK; ROADMAP row 001 set to done (T041).

## Report

### What changed
The repo went from Spec Kit scaffolding to a working SvelteKit 3 app on branch `001-editor-workspace-shell`:
- **Phase 1–2** (87b8696, e58d758): SvelteKit + adapter-node, Vitest, Playwright. The Hocuspocus 4 server is attached in-process at `/collab`, with a Vite plugin for dev and `server.ts` for prod. SQLite via Drizzle holds an append-only `updates` log plus compacted `documents` snapshots, and the starter text is seeded server-side exactly once.
- **Phase 3, US1** (08fe91e): CodeMirror 6 editor (stex highlighting, line numbers, bracket matching, search) bound through `y-codemirror.next` with `Y.UndoManager`; undo/redo buttons; tab strip with a Saved/Connecting…/Offline badge.
- **Phase 4, US2** (c51b5eb): three-pane dark workspace on paneforge. Every border can be dragged, the sidebar and PDF pane collapse with the arrow tabs, and the layout is remembered per browser. File tree and the PDF empty state.
- **Phase 5, US3** (7c93411): live outline (section/subsection/subsubsection, starred and optional-argument forms, comments skipped) with click-to-jump and a highlight on the current section.
- **Phase 6, US4** (737e41e): toolbar Bold/Italic/Section/Link/Figure/Table (one undo step each) and a search button.
- **Phase 7, US5** (439ac1a): Dockerfile (node:24-bookworm-slim, pnpm 10.33.0 pinned), `compose.yaml` bound to 127.0.0.1 by default (`OVERTREE_BIND` to expose), `scripts/compose-smoke.sh`.
- **Phase 8, polish** (9a9c0e5): perf test, README, the collapse tabs no longer cover the gutter.
- **Phase 9, convergence** (5a852cd): collapsed sidebar is inert, more layout-reload coverage, outline parser edge cases.

### How it was verified
- `pnpm check`: 0 errors. `pnpm test`: 17/17 (sync between two providers, restart persistence, crash recovery from the update log alone, compaction, seed once, doc-name rejection, outline parser, toolbar commands).
- `pnpm test:e2e`: 66/66, 22 each on Chromium, Firefox and WebKit, covering every acceptance scenario, two-context sync under 300 ms, offline/reconnect, and the 5,000-line perf budgets (load 42–93 ms, keystroke avg 3.5–9.7 ms, outline update 211–300 ms).
- `scripts/compose-smoke.sh`: PASS (HTTP 200, text survives `down`/`up`, published on 127.0.0.1 only). Image is 465 MB.
- Screenshots compared against `reference-layout.png`.

### What is left
- Nothing open in tasks.md. Not pushed and no PR opened.
- Known limits: a heading title that continues onto the next line is cut at the line end. Undo history resets on reload (by design). No login: keep the port on loopback until feature 005.
- The local `overtree:latest` Docker image remains; the smoke-test volume was removed.
