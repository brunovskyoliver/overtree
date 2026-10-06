# Feature 003: Multi-file projects, file tree & LaTeX autocomplete
Stage: done
Updated: 2026-10-06T23:30:00+02:00

## Decisions
- Branch `003-multi-file-autocomplete` created from `002-live-compile-pdf` (not merged to main).
- Screenshots copied to `reference-layout.png` and `reference-autocomplete.png`.
- Orchestrator's uncommitted ROADMAP.md edit (merged rows 003/004) goes into the first commit.
- Gate 1: user answered A,A,A,A (all recommendations): zip import replaces project files after confirmation; upload name clash asks Replace/Cancel, create clash refused; extended text-extension list; limits 50 MB/file, 200 MB zip unpacked, 2,000 files.
- Gate 2: user replied `go`. Applied M1 (SC-002 sample projects with known page counts), M2 (no close shortcut), M3 (FR-023 wording), M4 (zip actions in FR-002), LOW test gaps (sort order, popup flip, aria-activedescendant) folded into T018/T048.

## Log
- 2026-10-06 specify: spec.md (6 stories: tree P1, tabs/previews P1, multi-file compile P1, upload/zip P2, command completion P2, argument completion P2), checklists/requirements.md 16/16.
- 2026-10-06 clarify: 4 answers encoded (Clarifications, FR-003a/006/013/014, US4 scenarios 5-7, edge cases).
- 2026-10-06 plan: plan.md, research.md (R1-R14), data-model.md, contracts/{files-api,ui}.md, quickstart.md. New dep: fflate 0.8. Checked: Hocuspocus 4 has closeConnections/openDirectConnection; texlive medium image has bibtex, biber, biblatex.
- 2026-10-06 tasks: tasks.md, 55 tasks in 9 phases (MVP = phases 1-5).
- 2026-10-06 analyze: 0 CRITICAL, 0 HIGH, 4 MEDIUM, 4 LOW. Checklist requirements.md 16/16.
- 2026-10-06 analyze rerun after gate fixes: no new findings.
- 2026-10-06 implement phase 1-2 (T001-T011): commit b23e20c. Verified: check 0 errors, vitest 72/72. E2E 160/162; the 2 failures are compile-timing flakes (5 s e2e compile timeout under load) that also fail on the 002 commit; pass with retries. Deviations: seed written as a stored Yjs update in ensureProject's transaction (no empty-doc window); ensureProject keyed on the project row; FileError + api() wrapper (server.ts can't import @sveltejs/kit in prod); Dockerfile copies src/lib/files.ts; folders count toward PROJECT_MAX_FILES.
- 2026-10-06 implement phase 3 US1 (T012-T018): commit cefaf93. Verified check 0 errors, vitest 72/72; agent's full e2e 189/189. Fix outside the tree: server.ts tells adapter-node it serves plain HTTP unless ORIGIN/PROTOCOL_HEADER set (same-origin DELETE was 403). Deviations: ConfirmDialog.ask() promise API; clicking a text file already opens it; Backspace also deletes.
- 2026-10-06 implement phase 4 US2 (T019-T025): commit 1c0c4d8. Verified check 0 errors, vitest 72/72; agent's full e2e 208 passed/6 fixme/2 Firefox flakes (perf outline timing; viewer fit-width intermittent 1 in 4 full Firefox runs, passes alone). Deviations: one WebSocket per tab (shared socket breaks provider.disconnect used by sync.spec; ponytail note); background tab catch-up on switch; scrollSnapshot(); preview download is a link.
- 2026-10-06 implement phase 5 US3 (T026-T032; T032 pulled forward for the e2e): commit a9ade1c. Verified check 0 errors, vitest 78/78 (real Docker); agent's full e2e 222 passed/6 fixme/0 failed. Deviations: job renames outputs to output.*; latexmk gets ./$MAIN_FILE; parseLog takes the main name; tarProject rejects paths > 255 bytes (ponytail). MVP (phases 1-5) complete.
- 2026-10-06 implement phase 6 US4 (T033-T040): commit 681fd14. Verified check 0 errors, vitest 85/85; agent's full e2e 249/249 with --retries=2 (first run: 3 real failures fixed in viewer.spec locator, 2 WebKit compile-timeout flakes). Deviations: zip import writes rows + Yjs updates in one SQLite transaction (replaceProject, atomic); small central-directory reader for symlink detection; uploads sequential; export via zipSync (ponytail).
- 2026-10-06 implement phase 7 US5 (T041-T048): commit e90abfe. Verified check 0 errors, vitest 104/104; agent's full e2e 282/282. SC-005 measured 10-30 ms open, <=17 ms per keystroke with 1,000 symbols; SC-006 20/20. Deviations: kind in Completion.type; boosted common commands; `\sec` (secant) dropped so `\sec`+Enter gives \section; exit tab stops; activateOnTypingDelay 0; mirror via StateEffect + transaction filter (one undo step); symbols ?exclude= for live-scanned tabs; test lifts FuzzyMatcher from CM dist. `egin{pro`→proof2 waits for T049.
- 2026-10-06 implement phase 8 US6 (T049-T051): commit dd494d1. Verified check 0 errors, vitest 111/111; agent's full e2e 297/297. Deviations: ref commands accept comma lists; no validFor on argument results; duplicate image paths offered once.
- 2026-10-06 implement phase 9 polish (T052-T054): commit 4c743f6. Samples: thesis-book 17 pages, article-biblatex 2, report-sty 5. vitest 114/114; full e2e 297/297 with --retries=2 (one Firefox timeout-vs-OOM flake while compose smoke shared Docker). docker compose build + compose-smoke.sh pass (smoke now also hits zip export and symbols). README and quickstart updated.
- 2026-10-06 converge: 2 MEDIUM partial gaps (stale symbols for live tabs, untested scroll/undo-after-rename) → T056-T057 appended.
- 2026-10-06 implement phase 10 (T056-T057): commit d4fd331. vitest 115/115; full e2e 303/303 on all three browsers, no retries.
- 2026-10-06 finish: check 0 errors, vitest 115/115, build OK. ROADMAP row 003 → done (T055).

## Report

**What changed** (branch `003-multi-file-autocomplete`, from `002-live-compile-pdf`):
- 5fd7654 docs: spec, plan, research, data model, contracts, tasks (+ orchestrator's ROADMAP merge of 003/004).
- b23e20c phases 1-2: `files`/`project` tables, file service (CRUD, blobs by SHA-256, setText via Hocuspocus), legacy `main.tex` upgraded in place, `/api/files` + `/api/project` routes.
- cefaf93 phase 3 (US1): ARIA file tree with inline create/rename, context menu, drag-to-move, delete confirmation, download, keyboard. Also server.ts plain-HTTP fix (same-origin DELETE was 403 under adapter-node).
- 1c0c4d8 phase 4 (US2): editor tabs (one EditorState + provider + undo per tab), image/PDF previews, outline of the active file, tabs restored on reload.
- a9ade1c phase 5 (US3): whole project tarred into the sandbox, latexmk from the main's folder, Set as main document, log entries open files at the line, PDF named after main; multipart upload route.
- 681fd14 phase 6 (US4): upload by picker/drop with progress and Replace prompt, project zip export, New project from zip (bomb/traversal/symlink safe, atomic replace), body size limits.
- e90abfe phase 7 (US5): completion popup (391 commands, 66 environments, 263 packages, project \newcommand etc.), snippets with tab stops, `\begin`→`\end` mirror, Enter auto-close.
- dd494d1 phase 8 (US6): labels, cite keys, packages, file paths, environment names inside braces.
- 4c743f6 phase 9: three sample thesis projects (17/2/5 pages) compile from zip; README; compose smoke extended.
- d4fd331 phase 10 (convergence): stale-symbol refresh, scroll and undo-after-rename tests.

**How it was verified**: `pnpm check` 0 errors; `pnpm test` 115/115 (real Docker compiles, sandbox escapes, malicious zips); `pnpm test:e2e` 303/303 on Chromium, Firefox, WebKit; `docker compose build` + `scripts/compose-smoke.sh` pass; quickstart steps 2-7 driven by a Playwright script. SC-005 measured 10-30 ms popup open, <=17 ms per keystroke with 1,000 symbols.

**What is left / notes**:
- Known e2e flakes (pre-existing, compile timing under load): logs/options compile specs hitting the 5 s e2e timeout, Firefox perf outline timing, Firefox viewer fit-width. Pass on retry; consider raising the e2e compile timeout for non-timeout specs.
- Documented ceilings (`ponytail:`): blobs never garbage-collected; tar paths <= 255 bytes; job /tmp 256 MB; zip export built in memory; one WebSocket per open tab.
- Behind a TLS proxy, set `ORIGIN` or `PROTOCOL_HEADER=x-forwarded-proto` (README).
- Folders dropped from the OS aren't uploaded (use zip import). Tree changes don't sync live between browser tabs (feature 006).
- Nothing pushed; branch not merged.
