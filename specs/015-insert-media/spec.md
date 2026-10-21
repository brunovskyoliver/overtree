# Feature Specification: Images, figures, tables and symbols

**Feature Branch**: `015-insert-media`

**Created**: 2026-10-21

**Status**: Implemented

**Input**: User description: "Writers expect to paste a screenshot and get a figure, like Overleaf's insert-figure and table tools. Paste or drop an image into the editor: upload it into a `figures/` folder and insert a `figure` environment with the caret in the caption; add graphicx when missing. Dropping a project file from the tree inserts a reference. An Insert figure dialog (pick or upload an image, caption, label, width), an Insert table dialog with a rows × columns grid picker up to 10 × 10, and a searchable, keyboard-navigable symbol palette that wraps symbols in `$…$` outside math."

## Clarifications

### Decisions made while specifying (no questions asked)

- Tables use booktabs rules (`\toprule`, `\midrule`, `\bottomrule`); `\usepackage{booktabs}` is added to the main document when it is missing, in the same way as graphicx for figures.
- A clipboard that holds text as well as an image (Word, Excel and some PDF viewers put a picture of the selection next to the text) pastes the text, as before. Only an image-only clipboard becomes a figure.
- Dropping a `.bib` file from the tree inserts `\bibliography{name}`, or `\addbibresource{name.bib}` when the open document loads biblatex.
- Figures go into `figures/` in the main document's folder, so the inserted path is always `figures/<name>`.
- LaTeX can include PNG, JPG, PDF and EPS images. Other image formats (GIF, WebP, SVG, …) are refused with a message instead of being uploaded.
- The symbol palette opens under the toolbar and stays open while the writer works; its shortcut is Ctrl/⌘+Shift+Y.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Paste or drop a screenshot and get a figure (Priority: P1)

A writer takes a screenshot, clicks into the document where the figure belongs and pastes. The image is uploaded into the project's `figures/` folder and a complete figure block appears at the caret: centred, 80% of the line width, with an empty caption and a label made from the file name. The caret waits inside the caption, so the writer types it straight away. Dropping an image file from the desktop onto the text does the same at the drop point. If the main document doesn't load the package that `\includegraphics` needs, Overtree adds it.

**Why this priority**: This is the feature's reason to exist. Without it, adding a figure means saving the screenshot, uploading it through the file tree, remembering its name and typing six lines of LaTeX.

**Independent Test**: In a fresh project, paste a PNG screenshot below `\maketitle`, type a caption and recompile: the PDF shows "Figure 1: <caption>" and the file tree has `figures/pasted-<date>-<time>.png`.

**Acceptance Scenarios**:

1. **Given** an editor with the caret on an empty line, **When** they paste an image from the clipboard that has no name of its own (a screenshot), **Then** it is uploaded as `figures/pasted-YYYYMMDD-HHMMSS.png` (the folder is created when missing) and a block `\begin{figure}[htbp]`, `\centering`, `\includegraphics[width=0.8\linewidth]{figures/<name>}`, `\caption{}`, `\label{fig:<name>}`, `\end{figure}` is inserted at the caret with the caret inside `\caption{}`.
2. **Given** the inserted figure, **When** the project is compiled, **Then** it compiles and the PDF shows the image with its caption.
3. **Given** an image that has a name (a file copied in the file manager, or dropped), **When** it is pasted or dropped, **Then** it keeps its name; if `figures/` already has a file of that name, the new one is called `<name>-2`, `<name>-3`, … and nothing is ever overwritten.
4. **Given** a main document whose preamble doesn't load graphicx, **When** a figure is inserted, **Then** `\usepackage{graphicx}` is added on the line after `\documentclass`, once, and collaborators see that edit like any other.
5. **Given** an image file dragged from the desktop, **When** it is dropped on the editor's text, **Then** it is uploaded as in scenario 1 and the figure block is inserted where it was dropped.
6. **Given** a reader (or a file the user may only read), **When** they paste or drop an image, **Then** nothing is uploaded and the document doesn't change; the server refuses such uploads too.
7. **Given** a clipboard holding text and an image, **When** pasted, **Then** the text is pasted as usual. **Given** a GIF or another format LaTeX can't include, or an image over the upload size limit, **When** pasted or dropped, **Then** a message names the problem, nothing is inserted and no empty `figures/` folder is left behind.

---

### User Story 2 - Drag a project file from the tree into the text (Priority: P2)

A writer drags `chapters/intro.tex` from the file tree onto the main document and gets `\input{chapters/intro}` where they dropped it. Dragging an image gives `\includegraphics{…}`, dragging a `.bib` gives the bibliography command. Paths are written relative to the main document's folder, as LaTeX resolves them.

**Why this priority**: Saves typing paths that the tree already knows; less frequent than pasting screenshots.

**Independent Test**: Create `intro.tex`, drag it from the tree under `\section{Introduction}`: the line reads `\input{intro}`.

**Acceptance Scenarios**:

1. **Given** a `.tex` file in the tree, **When** it is dropped on the text, **Then** `\input{<path without .tex>}` is inserted at the drop point.
2. **Given** an image in the tree, **When** it is dropped on the text, **Then** `\includegraphics{<path>}` is inserted (and graphicx is added to the main document when missing).
3. **Given** a `.bib` file, **When** it is dropped, **Then** `\bibliography{<path without .bib>}` is inserted, or `\addbibresource{<path>}` when the document uses biblatex. Folders and other files insert nothing.

---

### User Story 3 - Insert figure dialog (Priority: P2)

From the toolbar, "Insert figure" opens a dialog listing the project's images by path. The writer picks one or uploads a new one (it goes into `figures/` like a pasted image and is selected), optionally types a caption, adjusts the label (prefilled from the file name) and the width as a fraction of the line width, and inserts the same figure block at the caret.

**Why this priority**: The discoverable route for writers who don't know they can paste, and the way to reuse an image already in the project.

**Independent Test**: Open the dialog, upload `cat.png`, caption "A cat", width 0.5, Insert: the block has `width=0.5\linewidth`, `figures/cat.png`, `\caption{A cat}`, `\label{fig:cat}`.

**Acceptance Scenarios**:

1. **Given** a project with images, **When** the writer picks one, sets caption, label and width and clicks Insert, **Then** the figure block with those values is inserted at the caret, the caret ends after the caption and focus is back in the text.
2. **Given** the dialog, **When** the writer uploads an image from it, **Then** it is stored in `figures/` (never overwriting) and becomes the selected image with its label prefilled.
3. **Given** the open dialog, **When** the writer presses Escape or Cancel, **Then** it closes and nothing changes; while open, Tab and Shift+Tab stay inside it; Insert is disabled until an image is chosen.

---

### User Story 4 - Insert table with a grid picker (Priority: P2)

"Insert table" opens a 10 × 10 grid. Hovering (or moving with the arrow keys) highlights a block of cells and shows "3 rows × 2 columns"; a click (or Enter) inserts a `table` with a `tabular` of that size, booktabs rules under the first (header) row, an empty caption and a label. The caret is in the first cell; Tab moves to the next cell.

**Why this priority**: Tables are the most tedious LaTeX to type by hand, but less common than figures.

**Independent Test**: Pick 3 × 2, type "Name", Tab, "Value": the first row reads `Name & Value \\`, followed by `\midrule` and two empty rows.

**Acceptance Scenarios**:

1. **Given** the grid, **When** the writer picks 3 rows × 2 columns, **Then** a table with column spec `ll`, `\toprule`, a header row, `\midrule`, two more rows, `\bottomrule`, `\caption{}` and `\label{tab:}` is inserted, the caret in the first cell, Tab moving cell by cell.
2. **Given** a main document without booktabs, **When** a table is inserted, **Then** `\usepackage{booktabs}` is added after `\documentclass`.
3. **Given** the dialog, **When** the writer uses the arrow keys and Enter, **Then** the size follows the keys (from 2 × 2, within 1–10) and Enter inserts it; Escape closes without inserting.

---

### User Story 5 - Symbol palette (Priority: P3)

A "Symbols" toolbar button (or Ctrl/⌘+Shift+Y) opens a panel under the toolbar with categories (Greek, Operators, Relations, Arrows, Delimiters, Misc), each showing symbols as glyphs with the LaTeX command as tooltip. A search box filters by name or command across categories. Choosing a symbol inserts its command at the caret: as it is inside math, wrapped in `$…$` outside math.

**Why this priority**: Helpful for writers who don't remember command names; experienced writers type them with autocomplete.

**Independent Test**: Open the palette, type "alpha", press Enter outside math: `$\alpha$` is inserted; click β inside `$y = |$`: `$y = \beta$`.

**Acceptance Scenarios**:

1. **Given** the caret outside math, **When** a symbol is chosen, **Then** `$\cmd$` is inserted and the caret is after it.
2. **Given** the caret inside math (`$…$`, `$$…$$`, `\(…\)`, `\[…\]` or a math environment such as `equation` or `align`), **When** a symbol is chosen, **Then** the bare command is inserted (with a space before a following letter, so `\alpha x` doesn't become `\alphax`); inside `\text{…}` within math counts as outside.
3. **Given** the palette, **When** the writer uses only the keyboard, **Then** the shortcut opens it with the search focused, Arrow Down enters the symbol grid, arrows move between symbols, Enter inserts and keeps focus in the palette, Escape closes it and returns focus to the text; a mouse click inserts and returns focus to the text. Each symbol has an accessible name and a tooltip with its command.
4. **Given** a reader, **Then** the palette, figure and table buttons are disabled and the shortcut does nothing.

---

### Edge Cases

- The writer keeps typing or a collaborator edits while an upload is running: the figure goes where the paste happened, carried through those edits.
- The writer switches to another file before the upload finishes: the image stays uploaded and nothing is inserted into the other file.
- Several images pasted or dropped at once: each is uploaded, their figure blocks are inserted one after the other and the caret goes to the first caption.
- Two pastes within the same second get the same timestamp name: the second becomes `…-2.png`.
- A file (not a folder) named `figures` already exists next to the main document: the upload is refused with a message.
- No main document is set: figures go into a root `figures/` folder and no package is added.
- The writer may edit the current file but not the main document: the figure is inserted, the package line is not added (the compile log will say what's missing).
- The main document's class is beamer: graphicx is not added (beamer loads it).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Pasting an image-only clipboard into an editable LaTeX file MUST upload the image(s) and insert a figure block per image at the caret.
- **FR-002**: Dropping image files from the desktop onto the editor text MUST do the same at the drop point. Dropped files that are not images keep the editor's previous behavior.
- **FR-003**: Uploads MUST go into a folder `figures` in the main document's folder, created when missing, reusing the existing upload rules (size limit, file count limit, permissions, error messages).
- **FR-004**: Uploaded figures MUST keep their name when they have one; images without a name MUST be called `pasted-YYYYMMDD-HHMMSS.<ext>` in the writer's local time. A name clash MUST produce `-2`, `-3`, … and never overwrite.
- **FR-005**: The figure block MUST be `figure[htbp]` with `\centering`, `\includegraphics[width=<w>\linewidth]{<path>}` (w = 0.8 by default), `\caption{…}` and `\label{fig:<label>}`, the caret at the end of the caption. The path MUST be relative to the main document's folder; the label is the file name without extension, reduced to letters, digits, `-` and `_`.
- **FR-006**: Inserting a figure or `\includegraphics` MUST add `\usepackage{graphicx}` after `\documentclass` when the main document doesn't load it; inserting a table MUST do the same for booktabs. The change MUST be a single collaborative edit, visible to everyone with the document open.
- **FR-007**: Only image formats LaTeX includes (PNG, JPG/JPEG, PDF, EPS) are uploaded; other image formats MUST be refused with a message naming them.
- **FR-008**: Dropping a project file from the tree onto the text MUST insert `\includegraphics{…}` for images, `\input{…}` for `.tex` and `\bibliography{…}` / `\addbibresource{…}` for `.bib`, with paths relative to the main document's folder.
- **FR-009**: The toolbar MUST offer "Insert figure", "Insert table" and "Symbols". The figure and table tools MUST be modal dialogs that keep focus inside, close on Escape and have accessible names.
- **FR-010**: The table picker MUST offer every size from 1 × 1 to 10 × 10 by pointer and keyboard and insert a booktabs table with the caret in the first cell and a tab stop per cell.
- **FR-011**: The symbol palette MUST have the six categories, a search over names and commands, keyboard navigation (arrows, Enter, Escape), a tooltip with each command, and MUST wrap the command in `$…$` outside math mode.
- **FR-012**: Readers and read-only files MUST NOT be able to paste or drop images or use the insert tools; the server MUST refuse their uploads and package edits.
- **FR-013**: Each insertion MUST be a single undo step.

### Key Entities

- **Figure image**: an uploaded binary file in a `figures` folder next to the main document; nothing about it is stored beyond the existing file entry.
- **Symbol**: a glyph, a LaTeX command and a searchable name, in one of six categories (static data shipped with the app).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a screenshot on the clipboard to a compiled PDF that shows it takes one paste, the caption and one recompile, with no file dialog and no typed LaTeX besides the caption.
- **SC-002**: The figure block appears within 1 s of the paste for an image under 1 MB on a LAN.
- **SC-003**: Every action in the figure, table and symbol tools is reachable with the keyboard alone.
- **SC-004**: No paste, drop or dialog ever overwrites an existing project file.

## Assumptions

- The main document is the root of the LaTeX run, so paths relative to its folder are what `\includegraphics` and `\input` resolve (the compile runs in that folder).
- Writers who want a different folder or float placement edit the inserted block; there is no setting for it.
- Symbols needing amssymb (`\mathbb`, `\nexists`, `\Box`, …) are not paired with an automatic `\usepackage{amssymb}`; most templates load it already.
