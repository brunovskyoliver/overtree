# Quickstart: Live compilation & PDF preview

## Prerequisites
- Docker running, image pulled once: `docker pull texlive/texlive:latest-medium` (about 1 GB download).
- `pnpm install`.

## Dev
```sh
pnpm dev
```
Open the app, click **Recompile**: the starter document's PDF appears within a few seconds. Type `\foo` on a line, press Ctrl/⌘+Enter: the button shows a badge `1`; open the logs (document icon) and click the entry: the cursor jumps to that line.

## Tests
```sh
pnpm check
pnpm test        # parser + real-Docker sandbox tests (needs the image)
pnpm test:e2e    # all acceptance scenarios, three browsers
```
Expected: all green. Sandbox tests assert: no `\write18`, no network, no access to host files, timeout at `COMPILE_TIMEOUT_MS`, OOM at `COMPILE_MEMORY`, `unavailable` for a missing image. See [contracts/compile-api.md](./contracts/compile-api.md) for statuses.

## Compose
```sh
docker compose up --build
```
The `texlive` service pulls the TeX image and exits; the app mounts `/var/run/docker.sock`. On Linux hosts where the socket's group is not root, set `DOCKER_GID=$(stat -c %g /var/run/docker.sock)`. `scripts/compose-smoke.sh` additionally POSTs `/api/compile` and checks for a PDF.
