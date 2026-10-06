# Tasks: Live compilation & PDF preview

**Input**: Design documents from `specs/002-live-compile-pdf/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: required by the constitution (IV): Vitest at the server seams, Playwright for every acceptance scenario on Chromium, Firefox and WebKit. Sandbox tests run against real Docker with `texlive/texlive:latest-medium`.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Add `pdfjs-dist@^6.4` as a dependency (`pnpm add pdfjs-dist`) and confirm `pnpm build` still passes in package.json
- [X] T002 [P] Create shared types `Compiler`, `CompileStatus`, `LogEntry`, `CompileResult` exactly as in data-model.md in src/lib/compile-types.ts
- [X] T003 [P] Add `tests/fixtures/latex/` with `ok.tex` (starter-like, 1 page), `three-pages.tex` (3 pages, `\newpage`), `twenty-pages.tex` (20 pages, lipsum-free filler text), `fontspec.tex` (uses `fontspec` with `TeX Gyre Termes`, needs XeLaTeX/LuaLaTeX), `loop.tex` (`\def\x{\x}\x`), `oom.tex` (LuaLaTeX `\directlua` allocation loop), `escape-shell.tex` (`\immediate\write18{touch /tmp/pwned}` then `\IfFileExists{/tmp/pwned}{PWNED}{safe}`), `escape-read.tex` (`\input{/data/overtree.db}` and `\input{/etc/hostname}` printed), and the ten SC-003 error cases `err-undefined-cmd.tex`, `err-missing-brace.tex`, `err-missing-dollar.tex`, `err-undefined-env.tex`, `err-missing-package.tex`, `err-missing-file.tex`, `err-runaway.tex`, `err-undefined-ref.tex`, `err-undefined-cite.tex`, `err-overfull.tex`, each with a comment on the first line naming the expected level and line

## Phase 2: Foundational

- [X] T004 Publish `{ hocuspocus, db }` on `globalThis.__overtreeServer` (typed in src/app.d.ts) inside `attachCollab` in src/lib/server/collab.ts, plus an exported `getServer()` helper that throws a clear error when unset
- [X] T005 Add table `compile_settings` (`project` text PK, `compiler` text not null) to src/lib/server/schema.ts and generate the migration with `pnpm db:generate` into drizzle/
- [X] T006 Implement `runCompile({ source, compiler, stopOnFirstError, image?, timeoutMs?, memory?, cpus? })` in src/lib/server/compile.ts: spawn `docker run` with exactly the flags in research R1 (container name `overtree-compile-<uuid>`), write source to stdin, collect stdout (cap 256 MB) and parse the tar stream (ustar: 512-byte headers, name at 0..100, octal size at 124..136, data padded to 512) into `{ pdf?, log?, synctex? }`; timeout → `docker kill` → status `timeout`; exit 137 without timeout → `oom`; spawn `ENOENT` or exit 125 → `unavailable` with the first stderr line; otherwise `success` if a PDF came back, else `failure`. Defaults from env `TEXLIVE_IMAGE` (`texlive/texlive:latest-medium`), `COMPILE_TIMEOUT_MS` (`20000`), `COMPILE_MEMORY` (`512m`), `COMPILE_CPUS` (`1`)
- [X] T007 Unit tests for the sandbox seam in tests/unit/compile.test.ts (real Docker, `describe` timeout 60 s): `ok.tex` with each of pdflatex/xelatex/lualatex → `success` with a PDF starting `%PDF`; `fontspec.tex` succeeds with xelatex and lualatex; `escape-shell.tex` → PDF text/log shows `safe`, log has no `runsystem(...)executed`; `escape-read.tex` → the app's DB file is not readable (not mounted) and `/etc/hostname` is the container's; a fixture that does `\input{|"curl example.com"}` fails; `loop.tex` with `timeoutMs: 3000` → `timeout` within 5 s and no container named `overtree-compile-*` left (`docker ps -a`); `oom.tex` with lualatex and `memory: '256m'` → `oom`; image `overtree/does-not-exist` → `unavailable`

**Checkpoint**: the sandbox runs and is proven locked down.

## Phase 3: User Story 1 - Compile and see the PDF (P1) 🎯 MVP

**Goal**: Recompile button compiles `main.tex` and the PDF shows; the last PDF survives reloads.

**Independent Test**: open app, click Recompile, PDF with the starter title appears; reload, PDF still there.

- [X] T008 [US1] Implement `compileProject({ stopOnFirstError })` in src/lib/server/compile.ts: read `main.tex` via `getServer().hocuspocus.openDirectConnection('main.tex')` (read `getText('content')`, then `disconnect()`), read the compiler from `compile_settings` (default `pdflatex`), run `runCompile`, write `output.pdf`/`output.synctex.gz` (only when a PDF was produced), `output.log` and `result.json` into `$DATA_DIR/compile/main/` via temp file + `rename`; `pdfId` = this id when a PDF was produced, else the previous `result.json`'s `pdfId`; coalescing per research R6 (`running` + at most one `queued`); `entries: []` for now
- [X] T009 [US1] Add `getLastResult()` and `getCompiler()` in src/lib/server/compile.ts and routes `GET`/`POST` in src/routes/api/compile/+server.ts, `GET` in src/routes/api/compile/output.pdf/+server.ts (`application/pdf`, `Cache-Control: no-cache`, `?download=1` → `Content-Disposition: attachment; filename="main.pdf"`, 404 if none) and `GET` in src/routes/api/compile/output.log/+server.ts (`text/plain; charset=utf-8`, 404 if none), per contracts/compile-api.md; POST body `{ stopOnFirstError: boolean }`, 400 when malformed
- [X] T010 [US1] Unit test coalescing in tests/unit/compile.test.ts: three concurrent `compileProject` calls start only two Docker runs (spy on `runCompile` or count containers), and a compile after editing the doc through a provider sees the new text
- [X] T011 [US1] Client compile state in src/lib/compile.svelte.ts: class `CompileState` with `$state` fields `compiling`, `last: CompileResult | null`, `compiler`; `load()` (GET /api/compile), `compile()` (waits until `provider.hasUnsyncedChanges` is false, one request in flight, a `pending` flag triggers exactly one follow-up), `pdfUrl` derived from `last.pdfId`; expose on `window.__overtree.compile` when `PUBLIC_TEST_HOOKS`
- [X] T012 [US1] PdfViewer in src/lib/components/PdfViewer.svelte: pdf.js `PDFViewer` + `EventBus` in a positioned scroll container `data-testid="pdf-viewer"`, worker from `pdfjs-dist/build/pdf.worker.min.mjs?url`, `pdf_viewer.css` imported; on `url` change load the new document first (`getDocument(url).promise`), then `setDocument`, so the old pages stay visible until the new PDF is parsed; default scale `page-width`; destroy the old document after swap
- [X] T013 [US1] Recompile button (no menu yet) in src/lib/components/RecompileButton.svelte (`Recompile` / `Compiling…`, disabled + `aria-busy` while compiling) and the PDF pane bar in src/lib/components/PdfPane.svelte (layout per contracts/ui.md, empty state "Click Recompile or press Ctrl/⌘+Enter to see your PDF."), a banner for `timeout`/`oom`/`unavailable`/`failure` showing `message`, and "Compile failed, showing the previous PDF." when an older PDF remains; wire `CompileState` from src/routes/+page.svelte through src/lib/components/Workspace.svelte to PdfPane; drop the old "no focusables" `ponytail:` comment and make the PDF pane `inert` while collapsed like the sidebar
- [X] T014 [US1] E2E in tests/e2e/compile.spec.ts: scenario 1 (click → compiling state → PDF `.page` visible < 5 s, page text contains the title), 2 (button disabled with `aria-busy` while compiling), 3 (edit title, recompile, new text in PDF), 4 (reload shows the PDF without a POST), 5 (`escape-shell` content typed into the doc → PDF shows `safe`), 6 (with `COMPILE_TIMEOUT_MS` the e2e server uses 5000: loop document → "timed out" banner); plus SC-007: during a second compile and after a compile of a broken document (no `\begin{document}`) the previous `.page` canvas stays visible; SC-004: while the loop document compiles, a second browser context loads the app and an edit there syncs to the first within 1 s; set `COMPILE_TIMEOUT_MS=5000` in the Playwright `webServer.env` in playwright.config.ts and export the e2e data dir as `process.env.OVERTREE_E2E_DATA_DIR` from the config so tests can delete `compile/main/` to get the no-PDF state (helper `clearCompileOutput()` in tests/e2e/helpers.ts); afterEach resets the doc to SEED

**Checkpoint**: MVP: compile and view.

## Phase 4: User Story 2 - Errors and warnings (P1)

**Goal**: parsed log entries, click to line, error badge, raw log.

**Independent Test**: add `\foo` on line 12, recompile, badge `1`, entry `main.tex:12`, click → cursor on line 12.

- [X] T015 [P] [US2] Implement `parseLog(log: string): LogEntry[]` in src/lib/log-parser.ts per research R7 (file-line errors, `!` errors with `l.<n>` fallback and dedupe, LaTeX/Package/Class warnings with `on input line N` and `(pkg)` continuation lines, Overfull/Underfull boxes with `at line(s) N`), strip leading `./` from file names
- [X] T016 [US2] Unit tests in tests/unit/log-parser.test.ts: compile the ten `err-*.tex` fixtures through `runCompile` once (`beforeAll`, real Docker), save the logs, and assert level and line for each per its first-line comment; SC-003 requires ≥ 9/10 correct, the test asserts all 10 and documents any accepted miss; plus small inline-string cases for dedupe and continuation lines
- [X] T017 [US2] Fill `entries: parseLog(log)` in `compileProject` in src/lib/server/compile.ts
- [X] T018 [US2] LogsPanel in src/lib/components/LogsPanel.svelte per contracts/ui.md: counts header, Errors/Warnings/Typesetting sections, entries with `file === 'main.tex'` and a line are buttons that move the cursor to the line start (clamped to the last line), scroll centered, focus the editor and close the panel; others are plain items; `Raw log` disclosure fetching /api/compile/output.log into a `<pre>`; the status banner from T013 also shows here
- [X] T019 [US2] Logs button (`aria-pressed`) and error badge (`aria-label="N errors"`, hidden when 0) in src/lib/components/PdfPane.svelte and src/lib/components/RecompileButton.svelte; the viewer stays mounted but hidden while the logs show
- [X] T020 [US2] E2E in tests/e2e/logs.spec.ts: scenarios 1–7 of US2 (undefined command on line 12 → badge 1 and entry line 12; click → cursor line 12 and editor focused; warnings-only doc (undefined `\ref`, overfull box) → listed under Warnings/Typesetting, no badge; failure without PDF keeps old PDF; old PDF visible while compiling; raw log shows full text containing `This is pdfTeX`; fix → badge gone), plus the edge cases: entry for a line past the end jumps to the last line, entry without a line is not a button, an entry whose file is not `main.tex` (e.g. a warning from a package/class file) is listed but not a button

## Phase 5: User Story 3 - Auto-compile and compile options (P2)

**Goal**: options menu, compiler saved on the server, auto-compile after 2 s idle, shortcuts.

**Independent Test**: enable auto-compile, type, wait ~2 s, compile runs without a click; XeLaTeX compiles `fontspec.tex`.

- [X] T021 [US3] Route `PUT /api/compile/settings` in src/routes/api/compile/settings/+server.ts (body `{ compiler }`, `204`, `400` for anything but `pdflatex`/`xelatex`/`lualatex`) and `setCompiler()` (upsert `compile_settings` row `project = 'main'`) in src/lib/server/compile.ts
- [X] T022 [US3] Extend `CompileState` in src/lib/compile.svelte.ts: `autoCompile` and `stopOnFirstError` persisted in local storage key `overtree:compile` (`{ autoCompile, stopOnFirstError }`, both default `false`), `setCompiler()` calling the PUT route, `onLocalEdit()` restarting a 2000 ms timer that calls `compile()` when `autoCompile` is on, `stopOnFirstError` sent in the POST body
- [X] T023 [US3] Editor hooks in src/lib/components/Editor.svelte: an `updateListener` calling an `onLocalEdit` prop for `docChanged` updates without the `ySyncAnnotation` (remote Yjs changes don't count), and a keymap `Mod-Enter` / `Mod-s` calling an `onCompile` prop (`preventDefault`, return true); wire both from src/routes/+page.svelte
- [X] T024 [US3] Options menu in src/lib/components/RecompileButton.svelte per research R12 and contracts/ui.md: toggle `aria-label="Compile options"`, `aria-haspopup="menu"`, `aria-expanded`; `menuitemcheckbox` Auto compile and Stop on first error; `menuitemradio` group pdfLaTeX/XeLaTeX/LuaLaTeX; arrow keys, Home/End, Enter/Space, Escape and outside click close and return focus
- [X] T025 [US3] E2E in tests/e2e/options.spec.ts: scenarios 1–8 of US3 (auto on: compile starts ~2 s after the last keystroke, measured from the POST timestamp; typing every 500 ms for 4 s triggers no compile until the pause; auto off: no POST after 4 s idle; edits during a compile lead to exactly one follow-up POST and the final PDF matches the latest text; XeLaTeX and LuaLaTeX compile `fontspec.tex` content, pdfLaTeX fails it; stop on first error → log has one error and the run halted (`==> Fatal error occurred`/`Emergency stop` in the raw log); options survive reload, compiler also in a second browser context; Ctrl/⌘+Enter and Ctrl/⌘+S start a compile and Ctrl/⌘+S doesn't open the browser save dialog), plus SC-002 (PDF updated ≤ 7 s after typing stops) and menu keyboard navigation

## Phase 6: User Story 4 - Read the PDF (P2)

**Goal**: page navigation, zoom, fit, dark pages, download, position kept across recompiles.

**Independent Test**: three-page document: next page, page input 3, zoom in/out/fit, dark pages, download `main.pdf`.

- [X] T026 [US4] PdfToolbar in src/lib/components/PdfToolbar.svelte bound to PdfViewer state (page number, page count, scale value, dark): previous/next page, page input (Enter jumps, invalid input restored), `/ N`, zoom out/in (`decreaseScale`/`increaseScale`), zoom menu (Fit width, Fit page, 50/75/100/125/150/200/400 %) showing the current percentage; all disabled when no PDF; accessible names on every button
- [X] T027 [US4] Extend src/lib/components/PdfViewer.svelte: expose `pageNumber`, `pagesCount`, `scaleValue`, `scalePercent` via `pagechanging`/`scalechanging`/`pagesinit`; re-apply `page-width`/`page-fit` on pane resize with a `ResizeObserver`; keep scale and page across a new PDF (restore on `pagesinit`, page clamped to the new count, FR-019); dark pages class applying `filter: invert(1) hue-rotate(180deg)` to `.page` canvases, persisted in local storage key `overtree:pdf` (`{ dark }`, default `false`)
- [X] T028 [US4] Download button in src/lib/components/PdfPane.svelte: `<a href="/api/compile/output.pdf?id=…&download=1" download="main.pdf">`, disabled state (no href, `aria-disabled`) when there is no PDF
- [X] T029 [US4] E2E in tests/e2e/viewer.spec.ts: scenarios 1–8 of US4 with `three-pages.tex` content (next page, input 3 + Enter, `/ 3`, scroll updates input, zoom in/out changes percentage and canvas width, fit width/page sizes against the pane, fit kept after dragging the PDF pane border, dark toggle sets the filter and survives reload, download event with suggested filename `main.pdf`, controls disabled with no PDF (after `clearCompileOutput()` and a reload), page 2 at 150 % kept after recompile and clamped when the document shrinks to 1 page), plus SC-006 (page/zoom/dark each < 200 ms on `twenty-pages.tex`)

## Phase 7: Compose & polish

- [X] T030 Dockerfile: `COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker` into the runtime stage; compose.yaml: mount `/var/run/docker.sock:/var/run/docker.sock`, `group_add: ["${DOCKER_GID:-0}"]`, pass `TEXLIVE_IMAGE`, `COMPILE_TIMEOUT_MS`, `COMPILE_MEMORY`, `COMPILE_CPUS` through with the defaults, and add the `texlive` prefetch service (`image: ${TEXLIVE_IMAGE:-texlive/texlive:latest-medium}`, `command: ["true"]`, `restart: "no"`)
- [X] T031 Extend scripts/compose-smoke.sh: after `up`, `POST /api/compile` with `{"stopOnFirstError":false}` returns `status: success`, then `GET /api/compile/output.pdf` starts with `%PDF`; run it and record the result
- [X] T032 [P] README.md: compile section (Docker requirement, image pull, env vars and defaults from contracts/compile-api.md, the Docker socket note and `DOCKER_GID`)
- [X] T033 Run quickstart.md end to end (`pnpm check`, `pnpm test`, `pnpm test:e2e`, compose smoke) and capture a screenshot of the PDF pane against reference-layout.png
- [X] T034 Set row 002 to `done` in specs/ROADMAP.md

## Dependencies & Execution Order

- Setup (T001–T003) → Foundational (T004–T007) → US1 (T008–T014) → US2, US3, US4 in any order (all build on US1's CompileState and PdfPane) → Compose & polish.
- Within US1: T008 → T009 → T010; T011 → T012 → T013 → T014.
- US2: T015 ∥ T018 start, T016 after T015, T017 after T015, T019 after T018, T020 last.
- US3: T021 ∥ T023, T022 after T021, T024 after T022, T025 last.
- US4: T027 → T026 → T028 → T029.

## Parallel examples

- Setup: T002 and T003 together.
- US2: T015 (parser) alongside T018 (panel markup against a hand-written `LogEntry[]`).

## Implementation Strategy

MVP = Phases 1–3 (compile and see the PDF, sandbox proven). Then US2 (errors, also P1), US3, US4, compose last. Each phase ends with `pnpm check`, `pnpm test` and the e2e specs it adds passing on all three browsers.

## Phase 8: Convergence

- [X] T035 Classify Docker failures as `unavailable` in src/lib/server/compile.ts: run with `--pull never` (missing image fails fast with exit 125 instead of pulling inside the request); any non-zero exit with no tar output whose stderr names a Docker client/daemon problem (`Cannot connect`, `failed to connect`, `permission denied`, `Error response from daemon`, `No such image`) → `unavailable`; message prefixed `Compiler unavailable: ` with the most specific stderr line (prefer a line starting `docker:` or containing `Error response`, else the last non-empty line); unit tests in tests/unit/compile.test.ts for a dead socket (`DOCKER_HOST=unix:///nonexistent.sock` passed via the spawn env option) and a missing image asserting the `Compiler unavailable:` prefix (F1, F2, F3)
- [X] T036 Robust time limit in src/lib/server/compile.ts: wrap the engine in coreutils `timeout -s KILL <timeoutSeconds + 2>` inside the job script so the container ends itself even if the app dies, keep `docker kill` from the Node timer, and if the child hasn't closed 3 s after the kill, kill the child process and resolve as `timeout`; on module load, remove stale containers once (`docker ps -aq --filter name=overtree-compile-` → `docker rm -f`), ignoring errors (F2, F4)
- [X] T037 Sandbox tests in tests/unit/compile.test.ts + fixtures in tests/fixtures/latex/: `escape-write.tex` writes with `\immediate\openout` to `/usr/local/pwned.tex` and `/etc/pwned.tex` and reports via `\typeout` whether the file can be read back → absent; `escape-network.tex` (LuaLaTeX) tries `require("socket")` TCP connect to `1.1.1.1:53` inside `pcall` and `\typeout`s the result → fails (SC-005, F5)
- [X] T038 Coalescing in src/lib/server/compile.ts: the queued run uses the options of the latest caller that joined it, not the first (F6)
- [X] T039 Client error handling in src/lib/compile.svelte.ts: a non-OK POST or a fetch rejection sets a client-side failure result (status `failure`, message `Compile request failed (<status or error>)`, previous `pdfId` and entries kept) so the PdfPane banner shows it, no unhandled rejection; `setCompiler` reverts `compiler` when the PUT fails (F7)
- [X] T040 Logs button in src/lib/components/PdfPane.svelte becomes a document icon button with `aria-label="Logs"` and `title="Logs"`, as in contracts/ui.md and reference-layout.png; existing tests that find it by name keep passing (F8)
