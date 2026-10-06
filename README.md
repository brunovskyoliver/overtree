# Overtree

A self-hosted LaTeX editor in the spirit of Overleaf. This version is the workspace shell: one shared `main.tex` with a CodeMirror editor, live sync between tabs (Yjs + Hocuspocus), a file tree and outline sidebar, a toolbar, and a placeholder PDF pane. Text is stored in SQLite. Compiling to PDF comes later.

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

`scripts/compose-smoke.sh` builds the image, writes text, restarts the stack and checks the text and the loopback binding.

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
pnpm test           # vitest unit tests
pnpm exec playwright install chromium firefox webkit   # once
pnpm test:e2e       # Playwright on chromium, firefox and webkit
```
