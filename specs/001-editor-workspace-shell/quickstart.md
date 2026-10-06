# Quickstart: Editor workspace shell

## Prerequisites
Node 24+, pnpm 10, Docker (for the compose check), Playwright browsers (`pnpm exec playwright install chromium firefox webkit`).

## Develop
```sh
pnpm install
pnpm dev            # http://localhost:5173, collab on ws://localhost:5173/collab
```
Data goes to `./data/overtree.db` (override with `DATA_DIR`).

## Automated checks
```sh
pnpm check          # svelte-check + tsc strict
pnpm test           # vitest: outline, toolbar commands, collab sync + persistence
pnpm test:e2e       # playwright: all spec acceptance scenarios (builds and runs server.ts on a temp DATA_DIR)
```

## Manual validation (maps to spec)
1. Open the app → three panes, dark theme, `main.tex` with starter text (US1-1, US2-1).
2. Type, reload → text kept (US1-2). Second tab → edits appear live (US1-6).
3. Drag borders, collapse both side panes, reload → layout restored (US2).
4. Add `\subsection{X}` → outline updates; click an entry → cursor jumps (US3).
5. Select a word → Bold/Italic/Link; Figure/Table on an empty line; Cmd/Ctrl+F (US4).

## Container
```sh
docker compose up --build -d     # http://127.0.0.1:3000
docker compose down && docker compose up -d   # text still there (US5)
OVERTREE_BIND=0.0.0.0 docker compose up -d   # expose on the LAN
```
