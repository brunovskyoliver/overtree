# Overtree

A self-hosted LaTeX editor in the spirit of Overleaf. This version is the workspace shell: one shared `main.tex` with a CodeMirror editor, live sync between tabs (Yjs + Hocuspocus), a file tree and outline sidebar, a toolbar, and a PDF pane that compiles the document in a throwaway TeX Live container. Text is stored in SQLite.

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

`scripts/compose-smoke.sh` builds the image, compiles the document and fetches the PDF, writes text, restarts the stack and checks the text and the loopback binding. It runs under its own compose project (`overtree-smoke`) and removes its containers and volume when it exits.

## Compile

Each compile runs `latexmk` in a fresh container from the TeX Live image: no network, read-only root, non-root user, memory, CPU and time limits. The document goes in on stdin and the PDF comes back on stdout, so the app and the job share no files.

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

The app container ships the Docker CLI and mounts `/var/run/docker.sock`, so compile jobs are sibling containers on the host's Docker. The app runs as `node`; `group_add: ["${DOCKER_GID:-0}"]` gives it access to the socket. On Docker Desktop the socket inside containers is owned by `root:root`, so the default `0` works. On Linux the socket usually belongs to the `docker` group: set `DOCKER_GID=$(stat -c %g /var/run/docker.sock)`.

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
