# Implementation Plan: Images, figures, tables and symbols

**Branch**: `015-insert-media` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

## Summary

Paste and drop handlers on the CodeMirror view upload images through the existing upload route into `figures/` next to the main document. Two new form fields make that work: `folder` (a subfolder created when missing) and `replace=rename` (pick a free `-2`, `-3` name). The figure block goes in at a Yjs relative position taken at paste time, so edits made during the upload don't move it. A new `POST /packages` route adds `\usepackage{graphicx|booktabs}` after `\documentclass` as one Yjs insert through Hocuspocus. Insert figure and Insert table are native modal `<dialog>`s; the table uses CodeMirror's snippet tab stops, one per cell. The symbol palette is a panel under the toolbar. Math mode comes from a forward text scan.

## Technical Context

**Language/Version**: TypeScript (strict), Svelte 5 runes, SvelteKit
**Primary Dependencies**: existing only (CodeMirror 6 `snippet()` from `@codemirror/autocomplete`, Yjs relative positions, Hocuspocus direct connections). No new packages.
**Storage**: no schema change, no migration. Images are ordinary binary file entries (content-addressed blobs).
**Testing**: Vitest (`tests/unit/insert-media.test.ts`, `tests/unit/commands.test.ts`), Playwright (`tests/e2e/insert-media.spec.ts`; `toolbar.spec.ts` and `layout.spec.ts` updated for the renamed buttons)

## Design decisions

| Decision | Why |
|---|---|
| Upload through the existing `POST /files` with two optional fields (`folder`, `replace=rename`) | Reuses size/count limits, permission checks, the tree's progress lines and error messages (FR-003). The folder lookup, creation and upload run on the server, so two writers pasting at once don't both create `figures/`. A size check runs before the folder is created, so a refused upload leaves nothing behind. |
| `freeName` on the server inside the upload transaction | A clash check in the browser would race with a collaborator's upload. |
| Figure block placed at a `Y.RelativePosition` taken at paste time | Uploads take a moment; the user and collaborators keep typing. If the tab changed meanwhile, the image stays uploaded and nothing is inserted (`ponytail:`; the upgrade is writing into that file's Y.Text). |
| Packages added on the server (`POST /packages` → `addPackages`) | The main document is often not the open tab. One `transact` computes the insert point from the current text, so it is a single, conflict-free Yjs edit (Principle I), attributed to the user for history. It needs edit access on the main document. Best effort: when refused, the figure still goes in. |
| Figures inserted as plain text with a computed caret; tables with `snippet()` | CodeMirror's snippet parser misplaces tab stops after several escaped braces, so user text (captions, paths) never goes through it. Table templates hold no user text, and tab stops per cell are the point. |
| booktabs, not `\hline` | Better-looking tables by default; the package machinery already exists for graphicx. |
| Clipboard with text + image → text | Word and Excel put a bitmap of the selection on the clipboard beside the text; turning those into figures would break ordinary pasting. |
| Chrome's generic `image.png` counts as "no name" | Every clipboard bitmap arrives with that name; the spec wants `pasted-YYYYMMDD-HHMMSS.png` then. |
| Only PNG/JPG/PDF/EPS uploaded as figures | What `\includegraphics` takes under pdfLaTeX/XeLaTeX/LuaLaTeX; GIF/WebP/SVG would compile-fail. |
| Tree → editor drop reads FileTree's existing `application/x-overtree-id` drag type | No change to the tree. `\input` drops `.tex`; `.bib` becomes `\bibliography{stem}` or `\addbibresource{file}` when the open text loads biblatex. |
| Math mode: forward scan (`src/lib/editor/math.ts`) | The stex StreamLanguage has no math nodes. Rule: from the start, skipping comments and escapes, `$`, `$$`, `\(`, `\[`, and `\begin{equation|align|gather|multline|flalign|alignat|eqnarray|math|displaymath}[*]` open math, and the matching closers end it; the argument of `\text{}`/`\mbox{}`/`\textrm{}`… inside math is text. `ponytail:` a `$` inside verbatim or a macro definition can flip it; the upgrade is a Lezer LaTeX grammar. |
| Dialog focus: native `showModal()` + `trapTab` (`src/lib/focus.ts`) | `showModal` makes the page inert and Escape closes it, but Tab past the last control reaches the browser UI; `trapTab` wraps it. |
| Palette shortcut Ctrl/⌘+Shift+Y | Unbound in Chrome, Safari and Firefox on macOS/Windows; avoids Ctrl+Alt (AltGr on European keyboards). Firefox on Linux uses it for Downloads, but CodeMirror's handler runs first and calls preventDefault. |
| Palette focus: Enter keeps focus in the palette, a click returns it to the text | Keyboard users insert several symbols in a row; mouse users go on typing. |

## Files

New: `src/lib/media.ts` (shared rules: free names, pasted names, relative paths, labels, references, `packageEdit`), `src/lib/editor/figures.ts` (client upload + insert helpers), `src/lib/editor/math.ts`, `src/lib/editor/symbols.ts`, `src/lib/focus.ts`, `src/lib/components/FigureDialog.svelte`, `TableDialog.svelte`, `SymbolPalette.svelte`, `src/routes/api/projects/[pid]/packages/+server.ts`.

Changed: `src/lib/server/files.ts` (`replace: 'rename'`, `findFolder`/`ensureFolder`, `addPackages`), `src/routes/api/projects/[pid]/files/+server.ts` (`folder`, `replace=rename`), `src/lib/project.svelte.ts` (`send` options, `addPackages`), `src/lib/editor/commands.ts` (static Figure/Table replaced by `figuresCommand`, `tableCommand`, `symbolCommand`), `src/lib/components/Toolbar.svelte` (Insert figure / Insert table / Symbols), `src/lib/components/Editor.svelte` (paste/drop handlers, shortcut, error notice).

## Schema changes

None.

## Constitution Check

| Principle | Status | How |
|---|---|---|
| I. Collaboration is the data model | ✅ | Text insertions go through the CodeMirror view bound to Yjs; the package line is a Yjs insert through a Hocuspocus direct connection. Images are content-addressed blobs via the existing upload path. |
| II. Self-hostable by one person | ✅ | No new service, setting or dependency. |
| III. Untrusted compilation | ✅ | No change to compiles. |
| IV. Test the seams | ✅ | Vitest: names, paths, `packageEdit`, `inMath`, symbols, snippet blocks, rename uploads, folder creation, reader/size refusals, `addPackages` reaching a connected provider, both routes. Playwright: every acceptance scenario of US1–US5 except US2-3 (`.bib` drop), which is covered at the unit level by `referenceFor`. Collaborative behaviour is a Yjs edit like any other (no new sync path); the package edit is verified with a live provider in Vitest. |
| V. Simplicity first | ✅ | Upload route extended rather than duplicated; native `<dialog>`; CodeMirror's own snippet fields; a scan instead of a parser (`ponytail:` in `math.ts`). |

## Complexity Tracking

None.
