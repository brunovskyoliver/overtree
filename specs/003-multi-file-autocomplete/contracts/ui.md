# Contract: UI

Layout per [`reference-layout.png`](../reference-layout.png); popup per [`reference-autocomplete.png`](../reference-autocomplete.png). Dark theme tokens from `app.css`.

## File tree (`FileTree.svelte`)
- Header: "File tree" title, then icon buttons with accessible names: **New file**, **New folder**, **Upload**, **Download project as zip**, **New project from zip** (the last two may sit in an overflow menu "More").
- Rows: `role="treeitem"`, `aria-level`, `aria-expanded` on folders, `aria-selected` on the selected row; children in `role="group"`. Indent 16 px per level. Folder chevron + folder icon; file icon by kind (text, image, PDF, other). The main document shows a small "main" marker (`aria-label` includes "main document").
- The active tab's file is highlighted (accent background as in the reference); the keyboard-focused row has a focus ring.
- Each row has a kebab button (`aria-label="Actions for <name>"`, `aria-haspopup="menu"`), visible on hover/focus/selected. Right-click opens the same menu at the pointer. Items: Rename, Download, Set as main document (`.tex` only; disabled when already main), Delete. Folders: New file here, New folder here, Upload here, Rename, Delete.
- Inline name input for New file/New folder/Rename: Enter commits, Escape cancels, blur commits. An error shows below the input (`role="alert"`) and the input stays open.
- Keyboard: Up/Down, Home/End, Right (expand / first child), Left (collapse / parent), Enter (open file / toggle folder), F2 (rename), Delete (delete with confirmation), Shift+F10 or ContextMenu key (open menu).
- Drag: rows are `draggable`. The drop target (folder row, or the tree's empty area = root) is outlined while hovering; an invalid target shows no highlight. OS file drops use the same targets and upload.
- Upload progress: a list under the header, one line per file with name and a `<progress>`, removed when done; errors stay with a dismiss button.

## Dialogs (`ConfirmDialog.svelte`, native `<dialog>`)
- Delete: "Delete `chapters`?" + "This folder contains 3 files." + buttons **Delete** (danger) / **Cancel** (focused by default).
- Replace: "Replace existing file `plot.png`?" **Replace** / **Cancel**.
- Zip import: "Replace the project with `thesis.zip`?" + "This removes all 12 current files." **Replace project** / **Cancel**.

## Tabs (`EditorTabs.svelte`)
- `role="tablist"`; each tab `role="tab"`, `aria-selected`, file icon + name + close button (`aria-label="Close <name>"`). Middle-click closes. Active tab has the accent top border (as today). Overflow scrolls horizontally.
- Sync status badge ("Saved"/"Offline") stays at the right of the tab strip and reflects the active tab.
- Ctrl/Cmd+Alt+W is not bound (browsers own Ctrl+W); closing is by button or middle-click.
- No tabs: editor area shows "Open a file from the file tree."

## Preview (`FilePreview.svelte`)
- Header line with file name and **Download** button. Image: centered, fit to pane. PDF: `PdfViewer` with zoom/page controls. Other: "No preview for this file type." + Download.
- The formatting toolbar is hidden for previews and for non-LaTeX text files.

## Outline
- Follows the active tab. Non-`.tex` active file or preview: "No outline for this file."

## Logs
- Entries with `fileId` are buttons; clicking opens/activates the file's tab and moves the cursor to the line. Entries without a project file stay plain text.

## Completion popup
- Below the cursor (flips above near the bottom). Width ~ 500 px, max 8 rows visible, monospace label, kind label right-aligned in muted color, active row in the accent green (`--accent`). Matched characters underlined or bold.
- Labels show the snippet with empty placeholders (`\usepackage{}`, `\begin{}`, `\item[]`), as in the screenshot.
- Keys: Up/Down, PageUp/PageDown, Enter or Tab accept, Escape close, Ctrl+Space open. While in a snippet, Tab/Shift+Tab move between fields, Escape leaves the snippet.
- ARIA: CodeMirror's `listbox` with `aria-activedescendant`; options carry the kind in their accessible text.
