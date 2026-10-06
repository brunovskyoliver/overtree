# Implementation Plan: Live compilation & PDF preview

**Branch**: `002-live-compile-pdf` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-live-compile-pdf/spec.md`

## Summary

A Recompile split button at the top of the PDF pane POSTs to `/api/compile`. The server reads `main.tex` from the Hocuspocus document (read-only), runs one locked-down `docker run` of `texlive/texlive:latest-medium` per job with `latexmk` (source on stdin, `main.pdf`/`main.log`/`main.synctex.gz` back as a tar on stdout), parses the log into errors/warnings/bad boxes, stores the outputs under `$DATA_DIR/compile/main/` and returns a `CompileResult`. Compiles are serialized per project with at most one queued follow-up. The client renders the PDF with pdf.js `PDFViewer` (page nav, zoom, fit, dark pages, download), shows a logs panel with click-to-line entries and an error badge, and auto-compiles 2 s after local typing stops when enabled.

## Technical Context

**Language/Version**: TypeScript 6 (strict), Node 24, Svelte 5 runes, SvelteKit 3 (unchanged from 001)

**Primary Dependencies**: new: `pdfjs-dist` 6.4. Existing: Hocuspocus 4, CodeMirror 6, `y-codemirror.next`, Drizzle + better-sqlite3, paneforge. Runtime: Docker CLI + daemon, image `texlive/texlive:latest-medium`.

**Storage**: SQLite table `compile_settings`; files in `$DATA_DIR/compile/main/` ([data-model.md](./data-model.md))

**Testing**: Vitest: log parser (fixtures from real logs), compile runner against real Docker (success per engine, 10 error cases for SC-003, timeout, OOM, shell escape, network, host files, unavailable image), coalescing. Playwright: every acceptance scenario on Chromium, Firefox and WebKit.

**Target Platform**: Linux container for the app (with the Docker socket) or the host in dev; desktop browsers ≥ 1024 px

**Project Type**: single SvelteKit web app (unchanged)

**Performance Goals**: starter document PDF < 5 s after click (spike: 0.7–1.5 s); auto-compile PDF < 7 s after typing stops; viewer actions < 200 ms on 20 pages

**Constraints**: no network, no shell escape, read-only TeX tree, 20 s / 512 MB / 1 CPU per job (env-configurable); app never runs TeX itself; no new text write path

**Scale/Scope**: one project, one file, one compile at a time per project

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
|-----------|--------|-----|
| I. Collaboration is the data model | PASS | Compile reads the Yjs doc through a Hocuspocus direct connection and never writes it. Compile output is not text content. |
| II. Self-hostable by one person | PASS | Still `docker compose up`: app + TeX image (prefetch service). Env vars with defaults. No queue service: in-process promise chain. |
| III. Untrusted compilation | PASS | Container per job, `--network none`, `-no-shell-escape`, memory/CPU/pids/time limits, read-only rootfs + non-root user, all capabilities dropped. App process only spawns the Docker CLI. |
| IV. Test the seams | PASS | Vitest hits real Docker for the sandbox seam; Playwright covers all acceptance scenarios. |
| V. Simplicity first | PASS | pdf.js `PDFViewer` instead of a custom renderer; Docker CLI instead of an API client; hand-written menu (no UI library); no aux-file cache. |
| Tech constraints | PASS | `latexmk`, pdfLaTeX/XeLaTeX/LuaLaTeX selectable, SyncTeX on, pdf.js in the browser. |

Post-design re-check: PASS. Note: mounting the Docker socket into the app container gives the app control over the host's Docker. That is the documented way to start per-job containers (research R4) and does not run untrusted code outside job containers, so it is not a principle violation.

## Project Structure

### Documentation (this feature)

```text
specs/002-live-compile-pdf/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── compile-api.md
│   └── ui.md
├── reference-layout.png
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── compile-types.ts          # Compiler, CompileResult, LogEntry (shared)
│   ├── log-parser.ts             # parseLog(log) -> LogEntry[] (pure)
│   ├── compile.svelte.ts         # client compile state: settings, in-flight/pending, auto-compile timer
│   ├── components/
│   │   ├── PdfPane.svelte        # bar (RecompileButton, logs, download, PdfToolbar) + viewer/logs switch
│   │   ├── RecompileButton.svelte# split button, badge, options menu
│   │   ├── PdfViewer.svelte      # pdf.js PDFViewer wrapper, page/zoom/dark, position keeping
│   │   ├── PdfToolbar.svelte     # page nav, zoom, dark toggle
│   │   └── LogsPanel.svelte      # entries, status banner, raw log
│   ├── editor/types.ts           # EditorHandle unchanged; editor gains onLocalEdit + compile keymap
│   └── server/
│       ├── collab.ts             # + publish { hocuspocus, db } on globalThis
│       ├── schema.ts             # + compile_settings
│       └── compile.ts            # runCompile (docker), compileProject (coalescing, storage), settings
├── routes/api/compile/
│   ├── +server.ts                # GET, POST
│   ├── settings/+server.ts       # PUT
│   ├── output.pdf/+server.ts     # GET
│   └── output.log/+server.ts     # GET
drizzle/0001_*.sql                # generated migration
Dockerfile                        # + docker CLI
compose.yaml                      # + socket, group_add, texlive prefetch service, env
tests/
├── fixtures/latex/               # .tex inputs for error cases and sandbox escapes
├── unit/log-parser.test.ts, compile.test.ts
└── e2e/compile.spec.ts, logs.spec.ts, options.spec.ts, viewer.spec.ts
```

**Structure Decision**: compile logic is server-only in `src/lib/server/compile.ts`, called from SvelteKit routes. It reaches Hocuspocus and the DB through `globalThis.__overtreeServer`, set by `attachCollab` (the routes run in a separately bundled module graph). `compile.ts` is not imported by `server.ts`, so it may use `$lib` aliases, but it keeps relative `.ts` imports for consistency with the other server modules.

## Complexity Tracking

No constitution violations.
