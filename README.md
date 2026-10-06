# Overtree

A self-hosted LaTeX editor in the spirit of Overleaf. One project with any number of files and folders, a CodeMirror editor with tabs and LaTeX autocomplete, live sync between browser tabs (Yjs + Hocuspocus), a file tree and outline sidebar, a toolbar, and a PDF pane that compiles the project in a throwaway TeX Live container. Text and uploaded files are stored in SQLite.

> **There is no login yet.** Anyone who can reach the port can read and edit the document. The container publishes on `127.0.0.1` by default; only expose it on a network you trust.

## Run with Docker

```sh
docker compose up -d --build     # http://127.0.0.1:3000
docker compose down              # data stays in the overtree-data volume
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `OVERTREE_BIND` | `127.0.0.1` | Host address the port is published on. `OVERTREE_BIND=0.0.0.0` exposes it on the LAN. |
| `PORT` | `3000` | Host port. |
| `DATA_DIR` | `/data` in the image, `./data` otherwise | Where `overtree.db` lives. |
| `UPLOAD_MAX_FILE_MB` | `50` | Largest single uploaded file. |
| `IMPORT_MAX_MB` | `200` | Largest total unpacked size of an imported project zip. |
| `PROJECT_MAX_FILES` | `2000` | Most files and folders in a project (folders count). |
| `ORIGIN` / `PROTOCOL_HEADER` | unset | Set one of these when a TLS proxy sits in front, e.g. `ORIGIN=https://tex.example.org` or `PROTOCOL_HEADER=x-forwarded-proto`. Without either, `server.ts` treats every request as plain HTTP; behind HTTPS that makes SvelteKit's same-origin check refuse deletes and uploads. |

`scripts/compose-smoke.sh` builds the image, compiles the project and fetches the PDF, writes text, restarts the stack and checks the text and the loopback binding. It runs under its own compose project (`overtree-smoke`) and removes its containers and volume when it exits.

## Projects and files

The sidebar's file tree holds the project: folders and files, sorted folders first. Create files and folders from the tree header or a folder's menu, rename (F2), delete (Delete or Backspace), and drag entries between folders. One `.tex` file is the main document (marked in the tree; change it with "Set as main document"). Text files open in editor tabs; images and PDFs open as previews, other binaries offer a download.

- **Upload**: the Upload button, a folder's "Upload here", or drag files from the desktop onto the tree. Uploading a name that exists asks before replacing it. Folders dropped from the desktop are not uploaded; use a zip.
- **Zip**: "Download project as zip" exports every file and folder. "New project from zip" replaces the whole project after a confirmation. A single top folder in the zip (GitHub's `repo-main/`, an Overleaf export) is dropped, `__MACOSX` and `.DS_Store` are skipped, and entries with `..`, absolute paths or symlinks are refused. The main document becomes the root `main.tex`, else the shallowest `.tex` with `\documentclass`.

Limits are set by `UPLOAD_MAX_FILE_MB`, `IMPORT_MAX_MB` and `PROJECT_MAX_FILES` (table above).

## Autocomplete

Typing `\` offers LaTeX commands, plus those defined with `\newcommand` and friends anywhere in the project. `\begin{` lists environments (including the project's `\newenvironment`s) and the matching `\end{}` follows while you type the name. Inside arguments it completes from the project: `\ref{`/`\eqref{` offer labels, `\cite{` offers keys from `.bib` files with their titles, `\includegraphics{` image paths, `\input{`/`\include{` `.tex` files, `\bibliography{`/`\addbibresource{` `.bib` files, and `\usepackage{` package names.

## Compile

Each compile runs `latexmk` on the main document in a fresh container from the TeX Live image: no network, read-only root, non-root user, memory, CPU and time limits. The whole project goes in as a tar on stdin and the PDF and log come back on stdout, so the app and the job share no files. `latexmk` runs bibtex or biber as needed. Log entries in other files open that file at the line.

This needs Docker. Pull the image once (about 1 GB download):

```sh
docker pull texlive/texlive:latest-medium
```

Under compose the `texlive` service pulls it on `up` and exits right away; otherwise the first compile would pull inside its time limit and time out.

| Variable | Default | Meaning |
| --- | --- | --- |
| `TEXLIVE_IMAGE` | `texlive/texlive:latest-medium` | Image each compile runs in. |
| `COMPILE_TIMEOUT_MS` | `20000` | Wall-clock limit per compile. |
| `COMPILE_MEMORY` | `512m` | Memory limit (`--memory` and `--memory-swap`). |
| `COMPILE_CPUS` | `1` | CPU limit. |
| `DOCKER_GID` | `0` | Compose only: group the app joins to use the Docker socket. |

The app container ships the Docker CLI and mounts `/var/run/docker.sock`, so compile jobs are sibling containers on the host's Docker. The app runs as `node`; `group_add: ["${DOCKER_GID:-0}"]` gives it access to the socket. On Docker Desktop and OrbStack the socket inside containers is owned by `root:root`, so the default `0` works. On Linux the socket usually belongs to the `docker` group: set `DOCKER_GID=$(stat -c %g /var/run/docker.sock)`.

> **The socket grants control of the host's Docker**, which is root-equivalent on the host. The app code is trusted; the LaTeX is not, and it only ever runs inside the locked-down job containers.

## Develop

Needs Node 24+ and pnpm 10.

```sh
pnpm install
pnpm dev            # http://localhost:5173
pnpm build && pnpm start   # production server (node server.ts), HOST defaults to 127.0.0.1
```

## Test

```sh
pnpm check          # svelte-check + TypeScript
pnpm test           # vitest unit tests (the sandbox tests need Docker and the TeX Live image)
pnpm exec playwright install chromium firefox webkit   # once
pnpm test:e2e       # Playwright on chromium, firefox and webkit
```
