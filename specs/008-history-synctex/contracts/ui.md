# UI contract (008)

## Top bar

- **History** button (clock icon + "History"), `aria-pressed` while history mode is on. Visible to every member.
- **Layout** menu button (`aria-haspopup="menu"`): items *Side-by-side*, *Editor only*, *PDF only*, *PDF in separate window*; the current one has `aria-checked="true"` (`role="menuitemradio"`).

## Sync strip (between editor and PDF)

Two buttons stacked: `aria-label="Go to PDF location"` (→, title shows `Ctrl/⌘+Alt+J`) and `aria-label="Go to code location"` (←). Disabled with title "Compile first" when there is no PDF. Hidden in editor-only and PDF-only modes; in separate-window mode the → button stays in the editor's toolbar strip and ← lives in the PDF window's toolbar.

- Forward highlight: `div.sync-highlight` over the page, removed after 1 s.
- Double-click on a PDF page performs reverse sync.

## History view (replaces editor + PDF while on)

`section[aria-label="History"]` with three regions:

1. **Changed files** `nav[aria-label="Changed files"]`: one button per FileDiff, badge `added|deleted|edited|renamed`; clicking scrolls the diff to that file.
2. **Diff** `region[aria-label="Diff"]`: header with version time and kind, toggle buttons *Compare with current* / *Changes in this version* (`aria-pressed`), *Download zip* link, *Label…* (E), *Restore project* (E; confirm dialog "Restore the whole project to <time>? Changes after it stay in history."; afterwards a notice listing skipped paths, if any). Per file: path (with "renamed from …"), *Restore this file* when `canRestore`, text diff with `ins[data-user]` / `del[data-user]` colored by author, unchanged runs collapsed with "Show N unchanged lines". Binary: "Binary file changed (old → new size)". Legend of authors (avatar + name + color swatch). Empty: "No differences from the current state."
3. **Timeline** `ol[aria-label="Versions"]` (listbox semantics: `role="listbox"`, items `role="option"`, `aria-selected`): day headings, per version time, avatars, changed file names (first 3 + "N more"), compile icon (`title="Compiled"`), restore line "Restored from <date time>", label chips (rename/delete menu when `canEdit`). Toggle *Labels only*. Loads the next 50 on scroll to the end. ↑/↓ select, Enter opens, Escape leaves history.

Readers see everything except *Restore…* and *Label…*; label chips have no edit menu.

## PDF window route `/project/[id]/pdf`

Full-window `PdfPane` (recompile button, logs, zoom, download) plus the ← button; title `<project title> — PDF · Overtree`. Same access as the project page (non-members: the 005 "no access" page).

## Test hooks

No new browser hooks. E2E tests shorten the version thresholds with the `HISTORY_IDLE_MS`, `HISTORY_MAX_OPEN_MS` and `HISTORY_SWEEP_MS` env vars of the test server, or close versions by compiling.
