# Feature 002: Live compilation & PDF preview
Stage: done
Updated: 2026-10-06T17:30:00+02:00

## Decisions
- Branch `002-live-compile-pdf` created from `001-editor-workspace-shell` (001 not merged to main yet).
- Reference screenshot copied to `reference-layout.png`.

- Gate 1: user answered 1 A, 2 A, 3 A, 4 B (20 s / 512 MB / 1 CPU), 5 "most efficient and fastest" -> medium TeX Live scheme (B).
- Compile containers are spawned via the Docker socket mounted into the app container (stated at gate 1, no objection).
- Gate 2: user replied `go`. Applied M1 (e2e data dir + clearCompileOutput), M2 (no-line entries not clickable), M3 (SC-004 responsiveness check in T014), M4 (non-main.tex entry test in T020), L1 (removed aux-file edge case). Untested LOW edge cases (two tabs, 100+ pages, app restart) noted for the report.
- Menu outside click closes without moving focus back to the toggle (deviation from research R12; focus stays where the user clicked, which is the WAI-ARIA menu-button norm).
- User moved from Docker Desktop to OrbStack mid-feature; docker context switched to `orbstack` (images were migrated). OrbStack stopped once during the final e2e run; restarted with `orb start` and the suite rerun.

## Log
- 2026-10-06 specify: spec.md (4 stories: compile+PDF P1, errors/logs P1, auto-compile+options P2, PDF viewer P2) + checklists/requirements.md, 16/16 pass.
- 2026-10-06 clarify: 5 answers encoded (Clarifications, FR-004/006/007/009, US3 scenarios, SC-002, assumptions).
- 2026-10-06 plan: spike verified sandbox flags (pdfLaTeX 0.70 s, XeLaTeX 1.48 s, LuaLaTeX 0.93 s; write18 blocked, no network, timeout kill and OOM → 137). plan.md, research.md (R1-R12), data-model.md, contracts/{compile-api,ui}.md, quickstart.md. Image texlive/texlive:latest-medium pulled. New dep: pdfjs-dist 6.4.
- 2026-10-06 tasks: tasks.md, 34 tasks in 7 phases (MVP = phases 1-3).
- 2026-10-06 analyze: 0 CRITICAL, 0 HIGH, 4 MEDIUM, 4 LOW. Checklist requirements.md 16/16.
- 2026-10-06 remediation: spec/tasks updated; analyze rerun: 0 CRITICAL, 0 HIGH.
- 2026-10-06 implement phase 1 setup (244153e) + phase 2 foundational (1860982): T001-T007 [X]; verified check 0 errors, unit 28/28 (11 real-Docker sandbox tests). Notes: OOM under latexmk exits 0, so the job script checks cgroup v2 memory.events oom_kill and exits 137 (research R2 updated); getServer() in collab.ts; runCompile(opts) -> {status,message?,pdf?,log?,synctex?}; added escape-pipe.tex fixture.
- 2026-10-06 implement phase 3 US1 (aaae15e): T008-T014 [X]; verified check 0 errors, unit 29/29, e2e 84/84 (28 per browser). Notes: CompileState in src/lib/compile.svelte.ts (built in +page.svelte), PdfPane {compile, inert}, PdfViewer {url}; e2e helpers setDoc/clearCompileOutput; layout.spec empty-state check now looks for Recompile.
- 2026-10-06 implement phase 4 US2 (80cecb2): T015-T020 [X]; verified check 0 errors, unit 45/45, e2e 105/105 (35 per browser). SC-003 10/10. Notes: warnings after `main.aux` in the log are attributed to main.tex (ponytail heuristic until 003); badge text '1 errors' to be pluralized in US3.
- 2026-10-06 implement phase 5 US3 (47046d4): T021-T025 [X]; verified check 0 errors, unit 46/46, e2e 132/132 (44 per browser); options.spec stable over --repeat-each 3. Parser skips the `==> Fatal error occurred` line; badge label pluralized.
- 2026-10-06 implement phase 6 US4 (ce5279a): T026-T029 [X]; verified check 0 errors, unit 46/46, e2e 156/156 (52 per browser); viewer.spec stable over --repeat-each 3; SC-006 page/zoom/dark 0.4-16 ms. Shared Menu helper src/lib/menu.svelte.ts; twenty-pages.tex fixture regenerated (had escape bytes). Screenshot matches reference top-right.
- 2026-10-06 implement phase 7 compose & polish (857caf7): T030-T033 [X]; check 0 errors, unit 46/46, e2e 156/156; viewer.spec Firefox flake fixed (pageBox retry), 120/120 over 5 repeats; compose smoke PASS (HTTP 200, compile success, %PDF, text survives down/up, loopback only); DOCKER_GID=0 works on Docker Desktop, app stays non-root; smoke now uses project overtree-smoke + down -v trap; app image 620 MB (145 MB content).
- 2026-10-06 converge: 0 CRITICAL, 2 HIGH (daemon-down reported as failure; missing image pulled inside the request with the timeout ineffective), 3 MEDIUM, 4 LOW. T035-T040 appended as Phase 8; F9 (ROADMAP) = T034.
- 2026-10-06 implement phase 8 convergence (27bed85): T035-T040 [X]; `--pull never`, daemon/socket errors -> `unavailable` with "Compiler unavailable:" message, in-container `timeout -s KILL`, kill fallback + startup sweep of overtree-compile-* containers, write/network escape tests, latest joiner's options for the queued compile, client handles failed POST/PUT, Logs icon button. Compose smoke PASS on OrbStack (DOCKER_GID=0 works).
- 2026-10-06 final (OrbStack): check 0 errors, unit 50/50, build OK, e2e 162/162 (54 per browser), no leftover compile containers; ROADMAP row 002 set to done (T034).

## Report

### What changed
Branch `002-live-compile-pdf`, built on top of `001-editor-workspace-shell`:
- **Docs** (b917427): spec with 5 clarifications, plan, research R1–R12 (sandbox flags proven in a spike first), data model, contracts, tasks.
- **Phase 1–2** (244153e, 1860982): `pdfjs-dist` 6.4, shared compile types, 20 LaTeX fixtures, `compile_settings` table, `runCompile()`. Each job is one `docker run` of `texlive/texlive:latest-medium` with `--network none`, 512 MB / 1 CPU / 128 pids, read-only root, uid 1000, all capabilities dropped and `-no-shell-escape`. The source goes in on stdin and the PDF, log and SyncTeX file come back as a tar on stdout. Running out of memory is detected through cgroup v2 `memory.events`.
- **Phase 3, US1** (aaae15e): `POST/GET /api/compile`, `output.pdf`, `output.log`. Compiles run one at a time with at most one queued, and the last output is stored atomically under `$DATA_DIR/compile/main/`. Recompile button and pdf.js viewer; the old PDF stays visible until the new one is parsed.
- **Phase 4, US2** (80cecb2): log parser (SC-003 10/10), logs panel with click-to-line, raw log and an error badge.
- **Phase 5, US3** (47046d4): options menu (auto compile, pdfLaTeX/XeLaTeX/LuaLaTeX, stop on first error). The compiler is saved on the server; the other two are saved per browser. Auto-compile runs 2 s after local typing stops; Ctrl/⌘+Enter and Ctrl/⌘+S also compile.
- **Phase 6, US4** (ce5279a): PDF toolbar with previous/next, a page field, zoom in/out, fit width/page and fixed percentages, dark pages and download. Zoom and page position survive a recompile.
- **Phase 7** (857caf7): Dockerfile includes the static docker CLI; compose mounts the socket with `group_add: DOCKER_GID` and has a `texlive` service that pulls the image ahead of time. The smoke test now also compiles. README has a compile section.
- **Phase 8, convergence** (27bed85): a dead daemon or missing image shows "Compiler unavailable: …", and images are never pulled inside a request. The time limit is also enforced inside the container, and leftover job containers are removed at startup. Added tests for writes outside the job and for network access. The client handles failed requests, and Logs is now an icon button.

### How it was verified
- `pnpm check`: 0 errors. `pnpm test`: 50/50. Sandbox tests run against real Docker and cover all three engines, fontspec, shell escape, reading host files, writes to `/usr/local` and `/etc`, network, timeout, out-of-memory, missing image, dead socket, plus the coalescing test and the 10 SC-003 error logs.
- `pnpm test:e2e`: 162/162 on Chromium, Firefox and WebKit (54 each), covering every acceptance scenario of US1–US4, SC-001/002/004/006/007, and the analysis remediations. Timing-sensitive specs held up under `--repeat-each 3–5`.
- Measured: pdfLaTeX 0.7 s, XeLaTeX 1.5 s, LuaLaTeX 0.9 s for a starter-size document; viewer actions 0.4–16 ms on 20 pages.
- `scripts/compose-smoke.sh`: PASS on Docker Desktop and again on OrbStack (HTTP 200, compile success, `%PDF`, text survives down/up, published on loopback only). App image 620 MB (145 MB content).
- Screenshot of the PDF pane compared against `reference-layout.png`.

### What is left
- Nothing is open in tasks.md. Not pushed, no PR. Feature 001 is still unmerged into `main`, so a PR for 002 would stack on 001.
- Not tested by design: two tabs each showing their own compile, 100+ page PDFs, and the last PDF surviving an app restart (it is read from disk, but only a page reload is tested).
- Known limits, marked with `ponytail:` comments: warnings are attributed to `main.tex` once `main.aux` appears in the log (needs real file tracking in 003); out-of-memory detection needs cgroup v2 (on v1 it shows as a plain failure); a brief re-render flash when a new PDF replaces the old; outside-click on a menu doesn't return focus to its toggle.
- Security note: the app container gets the Docker socket, i.e. control of the host's Docker. Untrusted LaTeX only runs inside the locked-down job containers. Keep the port on loopback until accounts (005).
- On Linux hosts set `DOCKER_GID=$(stat -c %g /var/run/docker.sock)`.
