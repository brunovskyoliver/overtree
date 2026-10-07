# Quickstart: validate feature 008

## Prerequisites

As in 005 `quickstart.md`: Docker running (compiles need the TeX Live image), pnpm, Playwright browsers. No new services or secrets.

## Environment (new, test-only knobs)

| Variable | Purpose | Default |
|---|---|---|
| `HISTORY_IDLE_MS` | idle time that closes an automatic version | `300000` (5 min) |
| `HISTORY_MAX_OPEN_MS` | longest an automatic version stays open | `1800000` (30 min) |
| `HISTORY_SWEEP_MS` | how often the server checks for versions to close | `30000` |

`playwright.config.ts` sets `HISTORY_IDLE_MS=1500`, `HISTORY_MAX_OPEN_MS=10000`, `HISTORY_SWEEP_MS=500` for the e2e server.

## Automated checks

```bash
pnpm check        # 0 errors
pnpm test         # Vitest, including tests/unit/history*.test.ts, synctex.test.ts, routes-guarded additions
pnpm test:e2e     # Playwright, including history.spec.ts, restore.spec.ts, synctex.spec.ts, pdf-position.spec.ts, layout-menu.spec.ts
```

Data model: [data-model.md](./data-model.md). API: [contracts/http-api.md](./contracts/http-api.md). UI: [contracts/ui.md](./contracts/ui.md).

## Scenarios (map to spec stories)

1. **US1 browse/diff** — two contexts (Alice, Bob) type in `main.tex` and `intro.tex`; wait past the idle threshold; a reader context opens History → two versions with the right avatars; select the older → diff lists both files, Bob's insertions carry Bob's color; toggle *Changes in this version* changes the list.
2. **US1 compile point** — type, click Recompile → newest version has the compile icon; Recompile again without edits → no new version.
3. **US2 restore file** — note text, make a bad edit, restore the file from the earlier version → text back, second context sees it live without reload, timeline has "Restored from …", the bad version is still listed; Ctrl+Z in the second context does not undo the restore.
4. **US2 restore project** — delete a file, rename another, add a third; restore the project → tree and texts match the version, main document as before.
5. **US2 permissions** — reader: no restore buttons, `POST …/restore` → 403. Editor with a read-only override on `chapter2.tex`: no *Restore this file* on it, direct POST → 403; whole-project restore → other files restored, notice lists `chapter2.tex` as skipped.
6. **US3 SyncTeX** — `tests/fixtures/projects/multi` imported and compiled; cursor in `chapters/intro.tex`, press Ctrl/⌘+Alt+J → PDF scrolls, highlight visible; double-click a paragraph from `main.tex` → editor switches to `main.tex` at the line.
7. **US4 PDF position** — `twenty-pages.tex`, scroll to page 5 mid-page, recompile → same page and offset; reload → same place.
8. **US5 labels** — editor labels a version; reader sees it, has no edit menu; another editor cannot delete it (403); owner can.
9. **US6 zip** — download an older version's zip, unzip, compare against that version's files.
10. **US7 layout** — each layout item; reload keeps it; separate window opens, recompile updates it, double-click in it jumps in the main window; closing it returns to side-by-side.
