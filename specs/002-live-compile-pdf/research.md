# Research: Live compilation & PDF preview

All runtime numbers below come from a spike on the reference machine (macOS, Docker Desktop 29.5) with `texlive/texlive:latest-medium` (0.95 GB compressed, digest `sha256:01f6233f…`).

## R1. Compile sandbox: one `docker run` per job, source in on stdin, outputs out as tar on stdout
- **Decision**: the server spawns the `docker` CLI:
  ```
  docker run -i --rm --name overtree-compile-<uuid>
    --network none --memory <COMPILE_MEMORY> --memory-swap <COMPILE_MEMORY> --cpus <COMPILE_CPUS>
    --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges
    --read-only --tmpfs /tmp:rw,exec,size=256m --user 1000:1000
    -e HOME=/tmp -e TEXMFVAR=/tmp/texmf-var -e max_print_line=10000 -w /tmp
    <TEXLIVE_IMAGE> sh -c 'cat > main.tex; latexmk <engine> -f -interaction=nonstopmode -file-line-error -synctex=1 -no-shell-escape [-halt-on-error] main.tex >&2; tar -c main.pdf main.log main.synctex.gz 2>/dev/null; true'
  ```
  `main.tex` text is written to stdin; stdout is a tar stream with whichever of the three outputs exist. Engine flags: `-pdf` (pdfLaTeX), `-xelatex`, `-lualatex`.
- **Rationale**: stdin/stdout means no shared filesystem between the app and the job, so the same code works on the host (dev, tests) and inside the app container (compose), where a bind-mount path would point at the host instead. Read-only root plus non-root user give a read-only TeX tree. `-f` is needed: without it latexmk stops after a LaTeX error and XeLaTeX never converts its `.xdv` to PDF (spike: no PDF). `max_print_line=10000` (kpathsea env) stops the log from wrapping at 79 columns, which makes parsing reliable.
- **Spike results**: starter-size document: pdfLaTeX 0.70 s, XeLaTeX 1.48 s, LuaLaTeX 0.93 s wall clock, container start included (LuaLaTeX builds its font cache in tmpfs each time; still under 1 s, so no custom image). `\write18` blocked (no file created). No DNS/network inside. `id` = uid 1000.
- **Alternatives**: bind-mount a job dir (breaks under compose sibling containers unless volume-subpath tricks); Docker Engine HTTP API over the socket (more code than the CLI); a long-lived compile worker container (violates "a container per job").

## R2. Limits and their messages
- **Decision**: timeout via `setTimeout(COMPILE_TIMEOUT_MS)` → `docker kill overtree-compile-<uuid>`; status `timeout`. Exit code 137 without our timer firing → status `oom`. Defaults `COMPILE_TIMEOUT_MS=20000`, `COMPILE_MEMORY=512m`, `COMPILE_CPUS=1`. stdout capped at 256 MB (tmpfs size) and stderr discarded beyond 64 KB.
- **Spike**: `\def\x{\x}\x` killed after 5 s → exit 137 in under 1 s after kill. Lua allocation loop → exit 137 (OOM) in 1.3 s.
- **Rationale**: killing the `docker run` client process doesn't stop the container; `docker kill` does, and `--rm` cleans it.

## R3. Docker unavailable
- **Decision**: spawn error `ENOENT` (no CLI) or exit 125 with stderr (daemon down, image missing) → status `unavailable` with the first stderr line as message.
- **Image presence**: compose gets a `texlive` service (`image: texlive/texlive:latest-medium`, `command: ["true"]`, `restart: "no"`) so `docker compose up` pulls the image before the first compile; otherwise `docker run` would pull inside the 20 s budget and time out.

## R4. App in a container launching sibling containers
- **Decision**: Dockerfile copies the static CLI: `COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker`. Compose mounts `/var/run/docker.sock` and adds `group_add: ["${DOCKER_GID:-0}"]` so the `node` user can use the socket. Documented: the socket grants control of the host's Docker; the app code is trusted, the LaTeX is not and only runs inside job containers.
- **Alternatives**: running the app as root (wider blast radius); Docker-in-Docker (privileged container).

## R5. Reading the text to compile
- **Decision**: `hocuspocus.openDirectConnection('main.tex')`, read `document.getText('content').toString()`, `disconnect()`. The collab module publishes `{ hocuspocus, db }` on `globalThis.__overtreeServer` in `attachCollab`, because SvelteKit routes are bundled separately from `server.ts`/the Vite plugin and would otherwise get a second module instance.
- **Client side**: before POSTing, the client waits until `provider.hasUnsyncedChanges` is false so the server has every keystroke.
- **Rationale**: read-only use of the CRDT; no second write path (constitution I). Reuses Hocuspocus' load-from-DB if no tab is connected.

## R6. Coalescing compiles
- **Decision**: server keeps per project `running?: Promise<Result>` and `queued?: Promise<Result>`. A request while running joins `queued` (created once as `running.then(run)`); otherwise starts a run. Client keeps one request in flight and a `pending` flag that triggers one more POST after it returns.
- **Rationale**: FR-003 and edge case "never more than one queued", both across tabs (server) and within a tab (client).

## R7. Log parsing
- **Decision**: own parser `parseLog(log)` in `src/lib/log-parser.ts` (pure, shared by server and tests). With `-file-line-error` and unwrapped lines:
  - error: `^(.+?):(\d+): (.+)$` → file (strip leading `./`), line, message; also `^! (.+)$` (errors without file-line, e.g. emergency stop); the following `l.<n> …` line supplies a line if missing. Dedupe the `!`-form if the same message was already captured.
  - warning: `^(LaTeX|Package (\S+)|Class (\S+)) Warning: (.+?)(?: on input line (\d+))?\.?$`, continuation lines starting with `(pkg)` joined.
  - typesetting: `^(Overfull|Underfull) \\[hv]box .*?(?:at lines? (\d+)(?:--\d+)?)?$`.
  - `LaTeX Warning: There were undefined references.` and `Label(s) may have changed` stay as warnings.
- **Rationale**: Overleaf's `latex-log-parser` is not published as a maintained npm package; with unwrapped, file-line-error logs the rules above are ~60 lines. SC-003 is tested against real logs from the container (10 cases).
- **Alternatives**: parse latexmk's stderr summary (incomplete).

## R8. PDF viewer
- **Decision**: `pdfjs-dist` 6.4 (`build/pdf.mjs` + worker via `?url` import of `pdfjs-dist/build/pdf.worker.min.mjs`) and its `PDFViewer` from `pdfjs-dist/web/pdf_viewer.mjs` with `EventBus` and `pdf_viewer.css`. It gives lazy page rendering (100+ pages), `currentPageNumber`, `pagesCount`, `currentScaleValue` (`'page-width'`, `'page-fit'`, numbers), `increaseScale()/decreaseScale()`, and `pagechanging`/`scalechanging` events. Fit modes are re-applied on pane resize via `ResizeObserver` → `viewer.currentScaleValue = mode`.
- **Keeping position across PDFs**: before `setDocument`, remember `currentPageNumber` and `currentScaleValue`; on `pagesinit` restore scale, then page clamped to `pagesCount` (FR-019).
- **Last PDF stays visible**: the new document is loaded (`getDocument().promise`) before `setDocument` is called, so the old pages stay until the new PDF is parsed. ponytail: a brief re-render flash when swapping; double-buffer two viewers if it bothers users.
- **Dark pages**: CSS `filter: invert(1) hue-rotate(180deg)` on `.page` canvases, toggled by a class (instant, no re-render). Persisted in local storage.
- **Alternatives**: own canvas loop with `PDFPageProxy.render` (re-implements lazy rendering, scroll tracking, text layer).

## R9. Compile options storage
- **Decision**: compiler in SQLite table `compile_settings (project text pk, compiler text)`, read with the last result, written by `PUT /api/compile/settings`. Auto-compile and stop-on-first-error in local storage key `overtree:compile` (JSON). Viewer dark mode in `overtree:pdf` (JSON `{dark}`); zoom is per session (FR-019 only asks to keep it across recompiles).
- **Rationale**: clarification Q1. A table with a `project` key is what feature 005 extends.

## R10. Persisting the last output
- **Decision**: `$DATA_DIR/compile/main/` holds `output.pdf`, `output.log`, `output.synctex.gz` and `result.json`. Files are written to a temp name and `rename`d. A new PDF replaces the old one only when one was produced (FR-009/010). `GET /api/compile` returns `result.json` plus the compiler setting.

## R11. Auto-compile trigger
- **Decision**: a CodeMirror `updateListener` in the editor reports local edits (docChanged and no `ySyncAnnotation`, i.e. not a remote Yjs change). The compile state restarts a 2 s timer on each; when it fires and auto-compile is on, it compiles. Shortcut keymap `Mod-Enter` and `Mod-s` call compile (and `preventDefault` the browser save).

## R12. Menu
- **Decision**: hand-written dropdown: button `aria-haspopup="menu"` + `aria-expanded`; `role="menu"` with `menuitemcheckbox` (auto-compile, stop on first error) and a `group` of `menuitemradio` (compilers). Arrow keys move focus, Enter/Space toggles, Escape and outside click close and return focus to the toggle.
- **Rationale**: no component library in the project; the menu is ~60 lines.
