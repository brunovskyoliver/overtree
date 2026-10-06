# Feature Specification: Multi-file projects, file tree & LaTeX autocomplete

**Feature Branch**: `003-multi-file-autocomplete`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "003 Multi-file projects, file tree & LaTeX autocomplete. **Files and tree.** File tree with nested folders: create file, create folder, upload (drag-and-drop too), rename, move by drag, delete with confirmation, download. Text files (`.tex`, `.bib`, `.cls`, `.sty`, `.md`, `.txt`) open in the editor as Yjs docs; images and PDFs open in a preview. Editor tabs for open files. Choose the main document from the file's context menu. `\input`/`\include`/`\includegraphics`/`\bibliography` paths resolve against the project tree in compiles. Outline covers the open file. Download the whole project as a zip and create a project by uploading a zip. **Autocomplete.** Completion popup like Overleaf's: typing `\` lists commands with a kind label (`cmd`, `env`, `pkg`), fuzzy matching, keyboard navigation, and snippets with tab stops (`\begin{}` inserts the matching `\end{}`; `\usepackage[]{}` puts the cursor in the braces). Sources: a bundled list of common commands and environments, package names for `\usepackage`, commands defined in the project (`\newcommand`, `\newenvironment`), `\label` keys for `\ref`/`\eqref`/`\autoref`, BibTeX keys from project `.bib` files for `\cite`, and project file paths for `\input`/`\includegraphics`. Auto-closing of `\begin{env}` on Enter. Spell-check is out of scope."

Reference layout: [`reference-layout.png`](./reference-layout.png) (file tree header with new file, new folder, upload and collapse icons; a kebab menu on each tree row; editor tabs above the toolbar). Completion popup: [`reference-autocomplete.png`](./reference-autocomplete.png) (entries such as `\usepackage{}` `pkg`, `\begin{}` `env`, `\item` `cmd`, kind label right-aligned, first entry highlighted).

## Clarifications

### Session 2026-10-06

- Q: What does "create a project from a zip" do while there is only one project? → A: The zip replaces the current project's files, after a confirmation that says how many files will be removed. Feature 005 turns this into "New project from zip".
- Q: What happens when a created, uploaded or imported file has the same name as an existing file in that folder? → A: Upload asks "Replace existing file?" (Replace / Cancel). Creating a file or folder with a taken name is refused inline.
- Q: Which files besides `.tex .bib .cls .sty .md .txt` are text? → A: Also `.bst .bbx .cbx .lbx .clo .def .cfg .dtx .ins .tikz .pgf .csv .tsv .dat .ltx .latex .bbl .json .yaml .yml .lua .py .r`.
- Q: Default upload limits? → A: 50 MB per file, 200 MB unpacked for a project from zip, 2,000 files per project; operators can change all three.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Organize project files in the tree (Priority: P1)

The author builds up a project in the file tree: creates `chapters/` and `figures/` folders, creates `chapters/intro.tex`, renames it, drags it into another folder, deletes a file they no longer need after confirming, and downloads a single file. Folders expand and collapse. Everything survives a reload.

**Why this priority**: Real LaTeX documents are split into several files with figures and a bibliography. Every other part of this feature needs files to exist first.

**Independent Test**: Create a folder and a file inside it, rename the file, move it to the root by drag, delete it, reload; the tree shows the expected state each time.

**Acceptance Scenarios**:

1. **Given** the project tree, **When** the user clicks "New file" in the tree header, types `intro.tex` and presses Enter, **Then** the file appears in the tree (inside the selected folder, or the root if none is selected), opens in the editor, and is empty.
2. **Given** the project tree, **When** the user clicks "New folder" and names it `chapters`, **Then** an empty folder `chapters` appears and can be expanded and collapsed.
3. **Given** a file or folder, **When** the user picks Rename from its context menu (kebab or right-click) or presses F2 on it, edits the name and presses Enter, **Then** the item is renamed; renaming a folder keeps its contents; an open file keeps its tab, text and undo history.
4. **Given** a file, **When** the user drags it onto a folder (or onto the root area), **Then** the file moves there; the same works for folders, and a folder cannot be dropped into itself or its descendants.
5. **Given** a file or folder, **When** the user picks Delete, **Then** a confirmation names the item (and, for a folder, how many files it contains); confirming removes it, cancelling leaves it.
6. **Given** a file, **When** the user picks Download, **Then** the browser saves that file with its name and unchanged content.
7. **Given** any name that is empty, contains `/`, `\` or a control character, is `.` or `..`, or duplicates a sibling's name, **When** the user confirms it, **Then** the operation is refused with an inline message and nothing changes.
8. **Given** any tree change, **When** the user reloads the page, **Then** the tree is unchanged.
9. **Given** the tree has keyboard focus, **When** the user uses the arrow keys, Enter, F2 and Delete, **Then** they move between rows, expand/collapse folders, open files, rename and delete, with the tree exposed to assistive technology as a tree.

---

### User Story 2 - Open files in tabs and previews (Priority: P1)

Clicking a text file (`.tex`, `.bib`, `.cls`, `.sty`, `.md`, `.txt`) opens it in the editor in a tab; clicking another opens a second tab. Clicking an image or a PDF opens a preview in the editor area instead. The outline shows the sections of the open `.tex` file. Edits to every text file are saved and synced exactly like `main.tex` today.

**Why this priority**: Without opening the files, a multi-file project is unusable.

**Independent Test**: Create `a.tex` and `b.tex`, type in each, switch tabs, close one, reload; text is kept. Upload a PNG and click it; the image shows.

**Acceptance Scenarios**:

1. **Given** the tree, **When** the user clicks a text file, **Then** it opens in a tab above the editor and becomes the active tab; clicking a file that already has a tab switches to it.
2. **Given** several open tabs, **When** the user clicks a tab, **Then** the editor shows that file with its own cursor position, scroll position and undo history.
3. **Given** an open tab, **When** the user clicks its close button (or middle-clicks the tab), **Then** the tab closes and the neighbouring tab becomes active; closing the last tab shows an empty editor area with a hint.
4. **Given** an image (`.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`) or a `.pdf` file, **When** the user clicks it, **Then** a tab opens showing a preview of the image or the PDF pages, with the file's name and a download button.
5. **Given** a file of any other type, **When** the user clicks it, **Then** a tab opens saying the file cannot be previewed, with a download button.
6. **Given** a `.tex` file is active, **When** the outline is shown, **Then** it lists that file's sectioning commands and clicking one jumps to the line in that file; for a non-`.tex` file the outline is empty with a note.
7. **Given** text typed in any text file, **When** the user reloads, **Then** the text is kept and the previously open tabs and active tab are restored.
8. **Given** an open file, **When** it is renamed, moved or deleted from the tree, **Then** its tab follows the new name, or closes on delete.
9. **Given** the active file in the tree, **When** a tab is activated, **Then** the tree highlights that file.

---

### User Story 3 - Compile a multi-file project (Priority: P1)

The project has one main document, shown with a marker in the tree. The author can make any `.tex` file the main document from its context menu. Compiles use the whole project tree, so `\input{chapters/intro}`, `\include`, `\includegraphics{figures/plot}` and `\bibliography{refs}` find their files. Errors in included files can be clicked to open that file at the line.

**Why this priority**: The PDF is the product; a multi-file project that cannot compile is worthless.

**Independent Test**: Create `chapters/intro.tex`, `figures/plot.png` and `refs.bib`; reference them from `main.tex`; compile; the PDF contains the chapter text, the image and the bibliography.

**Acceptance Scenarios**:

1. **Given** `main.tex` includes `\input{chapters/intro}` and `chapters/intro.tex` exists, **When** the user compiles, **Then** the PDF contains the text of `intro.tex`.
2. **Given** `main.tex` contains `\includegraphics{figures/plot}` and `figures/plot.png` exists, **When** the user compiles, **Then** the image appears in the PDF.
3. **Given** `refs.bib` and `\cite{key}` with `\bibliography{refs}`, **When** the user compiles, **Then** the citation and the bibliography appear in the PDF.
4. **Given** a `.tex` file's context menu, **When** the user picks "Set as main document", **Then** the tree marks that file as main, later compiles start from it, and the choice survives a reload; the option is not offered for non-`.tex` files.
5. **Given** the main document is deleted, **When** the user compiles, **Then** the compile fails with a message saying no main document is set and how to set one.
6. **Given** an error in `chapters/intro.tex` line 4, **When** the user clicks the log entry, **Then** that file opens in a tab with the cursor on line 4.
7. **Given** the downloaded PDF, **When** saved, **Then** its file name is the main document's name with `.pdf`.

---

### User Story 4 - Upload files and move whole projects (Priority: P2)

The author uploads files with the Upload button or by dragging files from the desktop onto the tree (onto a folder to upload there). They can download the whole project as a zip and start a project from a zip they have (for example one exported from Overleaf).

**Why this priority**: Figures and bibliography files come from outside the editor; a zip is how projects move between tools. It builds on the tree from US1.

**Independent Test**: Drag a PNG onto the `figures` folder; it appears there. Download the project zip, then create a project from that zip; the tree and file contents match.

**Acceptance Scenarios**:

1. **Given** the tree, **When** the user clicks Upload and picks one or more files, **Then** they are added to the selected folder (or root) and show progress until done.
2. **Given** files dragged from the desktop, **When** they are dropped onto a folder row or onto the empty tree area, **Then** they are uploaded into that folder or the root; the drop target is highlighted while dragging.
3. **Given** an uploaded file with a text extension, **When** it is opened, **Then** it opens in the editor like any other text file and edits are saved.
4. **Given** the project, **When** the user picks "Download project as zip", **Then** a zip with every file and folder of the project (not compile output) is saved.
5. **Given** a zip file, **When** the user picks "New project from zip" and confirms the dialog that says how many current files will be removed, **Then** the project's files are replaced and the tree contains the zip's files and folders, text files are editable, and the main document is chosen automatically (`main.tex` if present, otherwise the first `.tex` file at the shallowest level that contains `\documentclass`).
6. **Given** a file named like an existing file in the target folder, **When** it is uploaded, **Then** the user is asked "Replace existing file?"; Replace swaps the content (an open tab shows the new content), Cancel skips that file.
7. **Given** a file larger than the upload limit, or a zip that is not a valid zip, **When** it is uploaded, **Then** it is refused with a message and nothing changes.

---

### User Story 5 - Command completion while typing (Priority: P2)

Typing `\` opens a completion popup below the cursor listing LaTeX commands, environments and packages with a kind label on the right (`cmd`, `env`, `pkg`). Typing more letters narrows the list by fuzzy match. Arrow keys move the highlight, Enter or Tab accepts, Escape closes. Accepted snippets place the cursor where the next input goes: `\begin{}` fills in the matching `\end{}`, `\usepackage[]{}` puts the cursor in the braces, Tab jumps to the next field. Pressing Enter right after `\begin{itemize}` closes the environment.

**Why this priority**: Saves typing and helps users who don't remember exact command names. It is a layer on top of the editor and depends on nothing else in this feature except the project scan in US6.

**Independent Test**: In an empty line type `\sec`, see `\section{}` with `cmd`, press Enter, type a title; type `\begin{itemize}` and Enter, see `\end{itemize}` below the cursor.

**Acceptance Scenarios**:

1. **Given** the editor, **When** the user types `\`, **Then** a popup lists common commands, environments and packages, each with its kind label, first entry highlighted.
2. **Given** the popup is open, **When** the user types `sbsc`, **Then** `\subsection{}` is among the top matches (fuzzy match), and matched characters are highlighted.
3. **Given** the popup is open, **When** the user presses Down/Up, Enter/Tab or Escape, **Then** the highlight moves, the entry is inserted, or the popup closes without inserting.
4. **Given** the user accepts `\begin{}`, **When** they type `figure`, **Then** the matching `\end{figure}` is written as they type and Tab moves the cursor into the environment body.
5. **Given** the user accepts `\usepackage[]{}`, **When** it is inserted, **Then** the cursor is inside `{}`; Tab moves to `[]`, and Tab again leaves the snippet.
6. **Given** the cursor is right after `\begin{itemize}` with no matching `\end{itemize}` below, **When** the user presses Enter, **Then** a new indented line is created and `\end{itemize}` is inserted on the line after it; if a matching `\end` already follows, no second one is added.
7. **Given** a project file contains `\newcommand{\R}{\mathbb{R}}` or `\newenvironment{proof2}`, **When** the user types `\R` or `\begin{pro`, **Then** `\R` (`cmd`) or `proof2` (`env`) is offered.
8. **Given** the user is typing in a comment (after `%`) or in a non-LaTeX file (`.md`, `.txt`), **When** they type `\`, **Then** no popup opens.
9. **Given** the user presses Ctrl+Space, **When** the cursor is after a partial command, **Then** the popup opens.

---

### User Story 6 - Argument completion from the project (Priority: P2)

Inside the braces of certain commands the popup offers project data instead of commands: package names in `\usepackage{}`, label keys in `\ref{}`/`\eqref{}`/`\autoref{}` (and `\pageref`, `\cref`), BibTeX keys in `\cite{}` (and variants such as `\citep`, `\citet`), file paths in `\input{}`/`\include{}`/`\includegraphics{}`/`\bibliography{}`, environment names in `\begin{}`/`\end{}`.

**Why this priority**: Labels, citation keys and file paths are the things people mistype; completing them prevents broken references. Depends on the project files of US1–US4.

**Independent Test**: Add `\label{sec:intro}` to one file and `@article{knuth84,...}` to `refs.bib`; in another file type `\ref{` and `\cite{`; see the keys offered.

**Acceptance Scenarios**:

1. **Given** `\label{sec:intro}` in any `.tex` file of the project, **When** the user types `\ref{` or `\eqref{` or `\autoref{`, **Then** `sec:intro` is offered.
2. **Given** `refs.bib` contains an entry with key `knuth84`, **When** the user types `\cite{kn`, **Then** `knuth84` is offered with the entry's title or author as detail; after a comma in `\cite{a,` the next key is completed.
3. **Given** `\usepackage{` is typed, **When** the user types `ams`, **Then** `amsmath`, `amssymb` and `amsthm` are offered with `pkg`.
4. **Given** `chapters/intro.tex` and `figures/plot.png` exist, **When** the user types `\input{` or `\includegraphics{`, **Then** the matching project paths are offered (`.tex` files for `\input`/`\include`, image and PDF files for `\includegraphics`, `.bib` files for `\bibliography`), relative to the project root.
5. **Given** a label or bib key is added in one file, **When** the user switches to another file and triggers completion, **Then** the new key is offered without a reload.

### Edge Cases

- Creating a file or folder whose name already exists in that folder: refused inline. Uploading one: "Replace existing file?" (Replace / Cancel). Replacing a text file with an upload replaces its whole text.
- Cancelling the zip-import confirmation: nothing changes.
- Moving a file into a folder that already has a file with that name: refused with a message.
- Deleting a folder with open files: their tabs close.
- Deleting the main document: the tree shows no main marker; compiles fail with a clear message until one is set (US3-5).
- Renaming the main document or moving it: it stays the main document.
- Renaming a file's extension from text to binary or the reverse (e.g. `notes.txt` → `notes.png`): refused; the kind of a file is fixed at creation (see Assumptions).
- A zip containing paths with `..`, absolute paths or symbolic links: those entries are skipped; nothing is written outside the project.
- A zip with a single top-level folder wrapping everything (common in exports): the wrapper folder is removed so files land at the root.
- A zip with OS junk (`__MACOSX/`, `.DS_Store`): skipped.
- A very large zip (more files or bytes than the limit, or a "zip bomb" that expands far beyond its size): refused before anything is written.
- Text files that are not valid UTF-8: uploaded as non-editable files (download only).
- A file path referenced in `\input` without extension (`\input{chapters/intro}`): resolved by LaTeX's normal rules (`.tex` added); file completion offers the path without `.tex` for `\input`/`\include` and without the extension for `\includegraphics` when the user picks it, matching common style.
- Completion popup when the list is empty (no match): popup closes.
- Many labels/keys (500+): popup stays responsive.
- Completion while the popup would leave the editor area: the popup flips above the cursor.
- Two browser tabs on the same project: text edits sync live (as today); tree changes made in one tab appear in the other after a reload at the latest (live tree updates come in feature 006).

## Requirements *(mandatory)*

### Functional Requirements

**Files and tree**

- **FR-001**: The project MUST hold any number of files in nested folders; the file tree MUST show folders (collapsible) and files, sorted folders first, then by name.
- **FR-002**: The tree header MUST offer New file, New folder, Upload, Download project as zip and New project from zip; each row MUST offer a context menu (kebab button and right-click) with Rename, Delete, Download, and, for `.tex` files, Set as main document.
- **FR-003**: Names MUST be validated: non-empty, no `/` or `\`, no control characters, not `.` or `..`, at most 255 characters, unique among siblings (case-insensitive). Invalid names MUST be refused with an inline message.
- **FR-003a**: Creating a file or folder with a sibling's name MUST be refused inline; uploading a file with a sibling's name MUST ask "Replace existing file?" with Replace and Cancel.
- **FR-004**: Files and folders MUST be movable by drag-and-drop within the tree; moving a folder into itself or a descendant MUST be refused.
- **FR-005**: Delete MUST ask for confirmation naming the item and, for folders, the number of files inside.
- **FR-006**: Files with extension `.tex`, `.bib`, `.cls`, `.sty`, `.md`, `.txt`, `.bst`, `.bbx`, `.cbx`, `.lbx`, `.clo`, `.def`, `.cfg`, `.dtx`, `.ins`, `.tikz`, `.pgf`, `.csv`, `.tsv`, `.dat`, `.ltx`, `.latex`, `.bbl`, `.json`, `.yaml`, `.yml`, `.lua`, `.py`, `.r` (case-insensitive) that are valid UTF-8 MUST be text files: stored and edited as collaborative documents through the same sync and storage path as `main.tex` in feature 001. All other files MUST be stored as immutable blobs.
- **FR-007**: Renaming or moving a text file MUST keep its content, its edit history and any open editor state.
- **FR-008**: Clicking a text file MUST open it in an editor tab; clicking an image or PDF MUST open a preview tab; other files MUST open a tab with a "no preview" message. Every preview tab MUST offer download.
- **FR-009**: Editor tabs MUST show the file name, mark the active tab, be closable, and keep per-file cursor, scroll and undo state while the page is open. Open tabs and the active tab MUST be restored after a reload (per browser).
- **FR-010**: The outline MUST list the sectioning commands of the active `.tex` file and jump within that file.
- **FR-011**: Files MUST be uploadable through a file picker and by dropping files from the operating system onto the tree (into the folder under the pointer, or the root). Upload progress MUST be visible.
- **FR-012**: Each file MUST be downloadable on its own; the whole project MUST be downloadable as a zip of all files and folders.
- **FR-013**: A project MUST be creatable from an uploaded zip: after a confirmation stating how many current files will be removed, the zip's contents replace all project files, with unsafe entries (`..`, absolute paths, links) skipped, OS junk skipped, a single wrapper folder removed, and size and file-count limits enforced before anything is stored.
- **FR-014**: Uploads MUST be limited to 50 MB per file, 200 MB unpacked per zip import and 2,000 files per project by default; operators MUST be able to change the limits through configuration.
- **FR-015**: All tree changes MUST be stored on the server and survive reloads and restarts.
- **FR-016**: The tree MUST be keyboard operable (arrows, Enter, F2, Delete, Home/End) and exposed with tree semantics to assistive technology; menus MUST behave like the existing compile menu.

**Compile**

- **FR-017**: The project MUST have exactly zero or one main document, chosen among `.tex` files; the tree MUST mark it. A new project has `main.tex` as main.
- **FR-018**: A compile MUST use the full project tree (current text of every text file and every binary file at its path) and start from the main document, so relative paths in `\input`, `\include`, `\includegraphics`, `\bibliography`, `\addbibresource` and similar resolve against the project root.
- **FR-019**: A compile with no main document MUST fail with a message telling the user to set one.
- **FR-020**: Log entries that name a project text file and a line MUST be clickable and open that file at that line.
- **FR-021**: The downloaded PDF MUST be named after the main document.
- **FR-022**: The isolation guarantees of feature 002 (no network, no shell escape, limits) MUST hold for multi-file compiles; files outside the project MUST stay unreachable.

**Autocomplete**

- **FR-023**: In `.tex`, `.cls`, `.sty` (LaTeX) files, typing `\` followed by letters MUST open a completion popup; Ctrl+Space MUST open it on demand. No completion inside comments or in files other than `.tex`, `.cls` and `.sty`.
- **FR-024**: Each entry MUST show its insertion text and a kind label: `cmd`, `env` or `pkg` (and for argument completions: `label`, `cite`, `file`).
- **FR-025**: Matching MUST be fuzzy (characters in order, not necessarily adjacent), ranked so prefix matches come first, with matched characters highlighted.
- **FR-026**: The popup MUST support Up/Down, Page Up/Down, Enter and Tab to accept, Escape to close, and mouse click.
- **FR-027**: Snippets MUST insert placeholders with tab stops; `\begin{}` MUST mirror the environment name into a matching `\end{}`; `\usepackage[]{}` MUST place the cursor in the braces first.
- **FR-028**: Bundled sources MUST include at least 300 common commands, 40 common environments and 200 common package names.
- **FR-029**: Project sources MUST include commands and environments defined in any project text file (`\newcommand`, `\renewcommand`, `\providecommand`, `\DeclareMathOperator`, `\newenvironment`, `\def`), `\label` keys from all `.tex` files, entry keys from all `.bib` files, and project file paths; they MUST reflect the current text of every file within 2 seconds of a change, without reload.
- **FR-030**: Argument completion MUST offer labels in `\ref`, `\eqref`, `\autoref`, `\pageref`, `\cref`, `\Cref`, `\nameref`; bib keys in `\cite` and its common variants (`\citep`, `\citet`, `\parencite`, `\textcite`, `\autocite`, `\nocite`), including after commas; package names in `\usepackage` and `\RequirePackage`; file paths in `\input`, `\include`, `\includegraphics`, `\bibliography`, `\addbibresource`; environment names in `\begin` and `\end`.
- **FR-031**: Pressing Enter directly after `\begin{name}` (cursor at end of the line) MUST insert an indented empty line and `\end{name}` below, unless a matching unclosed `\end{name}` already follows.
- **FR-032**: The popup MUST match the dark theme of the reference screenshot, be keyboard accessible, and announce the active option to assistive technology.

### Key Entities

- **Project**: the set of files and folders, a main document reference and the compile settings from feature 002. Still a single project until feature 005 (zip import replaces its files).
- **Folder**: name, parent folder (or root).
- **File entry**: name, parent folder, kind (text or binary), created/updated time. A text file points to its collaborative document; a binary file points to a content-addressed blob (hash, size, media type).
- **Collaborative document**: the shared text of one text file (as in feature 001), keyed by a stable file identity that does not change on rename or move.
- **Blob**: immutable bytes stored once per content hash.
- **Open tabs** (per browser): ordered list of open file identities and the active one.
- **Completion entry**: label, insertion snippet, kind, optional detail; sources: bundled lists, project scan (definitions, labels, bib keys, paths).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create a folder, create a file in it, rename and move it in under 30 seconds without reading documentation.
- **SC-002**: Three sample thesis-style projects packed as zips (chapters, figures, a bibliography; one using biblatex) can be imported and compile with no manual fixes to their known page counts, 3 of 3.
- **SC-003**: Downloading a project as a zip and importing that zip yields a project with byte-identical files (text and binary).
- **SC-004**: Switching between open tabs shows the other file in under 100 ms for files up to 5,000 lines.
- **SC-005**: The completion popup appears within 100 ms of typing `\` and narrows within 50 ms per keystroke, with 1,000 project labels and keys loaded.
- **SC-006**: In a sample of 20 common commands typed by their first 3 letters, the intended command is in the top 3 entries for at least 18.
- **SC-007**: No zip entry or uploaded file name can create a file outside the project's storage, verified by an automated test with malicious zips.
- **SC-008**: Every acceptance scenario above passes as an automated test.

## Assumptions

- Single user, single project until feature 005; tree changes are not pushed live to other open tabs (feature 006). Text edits keep syncing live as in feature 001.
- File kind is decided by extension at creation/upload and does not change on rename (renaming across kinds is refused).
- Existing data from features 001/002 (`main.tex` document, compile output, compiler setting) is kept: after upgrade the project contains `main.tex` with its text and history, set as main.
- Compile output (PDF, log) stays a single "latest" per project, as in feature 002; it is not part of the project zip.
- Deleting files is permanent (version history arrives in feature 008); the confirmation dialog is the safeguard.
- The bundled command, environment and package lists are curated static data shipped with the app; they do not query the installed TeX distribution.
- Project-defined commands are found by pattern scanning the source text, not by running TeX; definitions built by macros are not found.
- File path completion lists project files only, not files from the TeX distribution.
- Image previews show the image at fit-to-pane size; PDF previews reuse the PDF viewer from feature 002 (pages, zoom), without dark pages being mandatory.
- Spell-check is out of scope.
