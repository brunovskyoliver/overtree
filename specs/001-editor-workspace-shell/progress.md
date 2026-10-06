# Feature 001: Editor workspace shell
Stage: implement
Updated: 2026-10-06T12:45:00+02:00

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

## Report
