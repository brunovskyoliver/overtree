# Contract: compile HTTP API

All routes are SvelteKit `+server.ts` endpoints under `src/routes/api/compile/`. Types in [data-model.md](../data-model.md).

## `POST /api/compile`
Body: `{ "stopOnFirstError": boolean }` (compiler comes from `compile_settings`).

Blocks until the compile finishes (or the queued follow-up it joined finishes). Response `200` with `CompileResult`. Never 5xx for compile problems: timeout, oom, unavailable are statuses.

`400` on malformed body.

## `GET /api/compile`
Response `200`: `{ "compiler": Compiler, "last": CompileResult | null }`. Used on page load to show the last PDF and log entries without compiling.

## `PUT /api/compile/settings`
Body: `{ "compiler": "pdflatex" | "xelatex" | "lualatex" }` → `204`. `400` on any other value.

## `GET /api/compile/output.pdf?id=<pdfId>`
The stored PDF, `Content-Type: application/pdf`, `Cache-Control: no-cache`. `404` if none. The `id` query only busts caches.

With `?download=1`: adds `Content-Disposition: attachment; filename="main.pdf"`.

## `GET /api/compile/output.log`
The raw log of the latest compile, `text/plain; charset=utf-8`. `404` if none.

## Configuration (env, with defaults)
| Variable | Default |
|----------|---------|
| `TEXLIVE_IMAGE` | `texlive/texlive:latest-medium` |
| `COMPILE_TIMEOUT_MS` | `20000` |
| `COMPILE_MEMORY` | `512m` |
| `COMPILE_CPUS` | `1` |
| `DOCKER_GID` (compose only) | `0` |
