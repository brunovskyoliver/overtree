# Contract: compile and PDF UI

Layout follows `reference-layout.png`: one bar at the top of the PDF pane (34 px, same line as the editor tab strip).

Left side: `[Recompile ▾]` split button, logs button (document icon), download button.
Right side: dark-pages toggle (half-circle icon), previous page, next page, page input `[n] / N`, zoom out, zoom in, zoom menu `86% ▾` (Fit width, Fit page, 50/75/100/125/150/200/400 %).

## Recompile button
- Label `Recompile`; while compiling: `Compiling…`, disabled, `aria-busy="true"`.
- Badge: red pill with the error count of the last result when > 0, `aria-label="N errors"`.
- Dropdown toggle `aria-label="Compile options"`, menu items:
  - `Auto compile` (`menuitemcheckbox`)
  - group `Compiler`: `pdfLaTeX`, `XeLaTeX`, `LuaLaTeX` (`menuitemradio`)
  - `Stop on first error` (`menuitemcheckbox`)
- Keyboard in the editor: `Mod-Enter`, `Mod-s` → compile.

## Logs panel
- Toggled by the logs button (`aria-pressed`); replaces the PDF view inside the pane; the PDF viewer stays mounted (hidden) so closing the panel shows it instantly.
- Header: counts per level. Sections: Errors, Warnings, Typesetting (bad boxes).
- Entry: level color stripe, `file:line` (if known), message. Entries with `file === 'main.tex'` and a line are buttons: click → cursor at line start (clamped to last line), scroll centered, editor focus, logs panel closes. Others are plain list items.
- Status banner for `timeout`, `oom`, `unavailable`, `failure` with `message`.
- `Raw log` disclosure: `<pre>` with the log fetched from `/api/compile/output.log`.

## PDF area
- Empty state (no PDF ever): "Click Recompile or press Ctrl/⌘+Enter to see your PDF." Page/zoom/download controls disabled.
- After a failed compile with an older PDF present: old PDF stays; a toast-like banner "Compile failed, showing the previous PDF. See logs." with a button to open the logs.

## Test ids / hooks
- `data-testid="pdf-viewer"` on the scroll container; pages are pdf.js `.page[data-page-number]`.
- `window.__overtree.compile` (only with `PUBLIC_TEST_HOOKS`): `{ state, last }` for assertions.
