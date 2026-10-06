# Feature Specification: Editor workspace shell

**Feature Branch**: `001-editor-workspace-shell`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "SvelteKit app with the three-pane layout from the reference screenshot: left sidebar (file tree on top, file outline below, resizable split), CodeMirror 6 editor in the middle with LaTeX syntax highlighting, line numbers, bracket matching, search, and a formatting toolbar (bold, italic, section, link, figure, table), PDF pane on the right. Dark theme. One project with a single `main.tex`, already stored as a Yjs document synced over WebSocket and persisted to SQLite, so a page reload keeps the text and undo/redo works through `Y.UndoManager`. File outline lists `\section`/`\subsection`/`\subsubsection` and jumps to the line on click. Panes collapse with the arrow handles. Docker Compose file runs the app."

Reference layout: [`reference-layout.png`](./reference-layout.png).

## Clarifications

### Session 2026-10-06

- Q: Can the user drag the borders between sidebar, editor and PDF pane to change their widths? → A: Yes, both vertical borders are draggable with minimum widths; the collapse arrows sit on the same borders.
- Q: Should pane sizes and collapsed state survive a reload? → A: Yes, remembered per browser (local storage).
- Q: What should Undo do right after a page reload? → A: Undo history is per browser session; after a reload it starts empty, the text is kept.
- Q: How much of the top bar and editor chrome from the screenshot belongs in this feature? → A: Top bar with app name and project name; editor tab strip showing `main.tex`; no menus or icon rail.
- Q: Who can reach the app by default, given there is no login yet? → A: Compose publishes the port on `127.0.0.1` only; an environment variable opens it to the network.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Write LaTeX and keep it (Priority: P1)

An author opens the app and lands directly in the project's `main.tex`. They type LaTeX in a code editor that colors commands, braces, comments and math, shows line numbers and highlights matching brackets. They reload the page, or close the browser and come back later, and the text is exactly as they left it. Undo and redo step through their edits.

**Why this priority**: Without durable editing there is no product. Every later feature (compile, multi-file, collaboration) builds on this document.

**Independent Test**: Start the app, type text, reload the page, confirm the text is unchanged; type, undo, redo and confirm each step.

**Acceptance Scenarios**:

1. **Given** a fresh installation, **When** the user opens the app, **Then** the editor shows `main.tex` with starter content and the cursor is ready for typing.
2. **Given** the user has typed text, **When** they reload the page, **Then** the same text appears, including the last characters typed before the reload.
3. **Given** the app was stopped and started again, **When** the user opens it, **Then** the previously saved text is shown.
4. **Given** the user made several edits, **When** they press Undo (keyboard shortcut or toolbar button) repeatedly, **Then** edits are reverted in reverse order, and Redo re-applies them.
5. **Given** LaTeX content, **When** it is displayed, **Then** commands, braces/arguments, comments and math are visually distinct, line numbers are shown, and the bracket matching the one at the cursor is highlighted.
6. **Given** the same project is open in two browser tabs, **When** the user types in one, **Then** the other tab shows the change without reloading.

---

### User Story 2 - Workspace layout (Priority: P1)

The author sees the three-pane workspace from the reference screenshot in a dark theme: a sidebar on the left with the file tree on top and the file outline below, the editor in the middle, and the PDF pane on the right. They can drag the divider between file tree and outline, collapse the sidebar or the PDF pane with the arrow handles on the pane borders, and bring them back.

**Why this priority**: The layout is the frame every later feature plugs into; getting it right once avoids rework.

**Independent Test**: Open the app, verify the three panes, drag the sidebar split, collapse and expand each side pane.

**Acceptance Scenarios**:

1. **Given** the app is open, **When** the page loads, **Then** the sidebar (file tree listing `main.tex`, file outline), editor and PDF pane are visible side by side in a dark color scheme.
2. **Given** the sidebar is visible, **When** the user drags the horizontal divider between file tree and outline, **Then** the two sections resize and neither can shrink below a usable minimum height.
3. **Given** the sidebar is expanded, **When** the user activates its collapse handle, **Then** the sidebar hides and the editor takes the space; activating the handle again restores it at its previous width.
4. **Given** the PDF pane is expanded, **When** the user activates its collapse handle, **Then** the PDF pane hides and the editor takes the space; activating the handle again restores it.
5. **Given** no compiled PDF exists yet (compilation arrives in a later feature), **When** the PDF pane is shown, **Then** it displays a clear empty state instead of a blank or broken area.
6. **Given** the user drags the border between sidebar and editor or between editor and PDF pane, **When** they release it, **Then** the panes take the new widths, and no pane shrinks below its minimum width.
7. **Given** the user resized or collapsed panes, **When** they reload the page in the same browser, **Then** the same sizes and collapsed states are restored.
8. **Given** a keyboard-only user, **When** they tab through the workspace, **Then** every handle, toolbar button, file tree item and outline entry is reachable, has a visible focus state and an accessible name.

---

### User Story 3 - Navigate by outline (Priority: P2)

The author sees a file outline listing every section, subsection and subsubsection heading of `main.tex`, indented by level. Clicking an entry moves the cursor to that heading and scrolls it into view. The outline updates as they type.

**Why this priority**: Navigation matters once documents grow; the editor is usable without it.

**Independent Test**: Load a document with mixed heading levels, check the outline entries and order, click an entry and verify the cursor line.

**Acceptance Scenarios**:

1. **Given** `main.tex` contains `\section{Intro}`, `\subsection{Background}` and `\subsubsection{Details}`, **When** the outline is shown, **Then** it lists "Intro", "Background", "Details" in document order with increasing indentation.
2. **Given** the outline lists a heading far down the document, **When** the user clicks it, **Then** the editor scrolls to that line, places the cursor there and takes focus.
3. **Given** the user types a new `\section{Methods}`, **When** they pause typing, **Then** "Methods" appears in the outline within one second.
4. **Given** a heading is commented out (`% \section{Old}`), **When** the outline is built, **Then** it is not listed.
5. **Given** the cursor is inside a section, **When** the outline is shown, **Then** the entry for the section containing the cursor is highlighted.

---

### User Story 4 - Format with the toolbar and search (Priority: P2)

Above the editor a toolbar offers undo, redo, bold, italic, section, link, figure and table, plus a search button. Each formatting button inserts the matching LaTeX around the selection or at the cursor. Search opens find-and-replace inside the editor.

**Why this priority**: Saves typing and matches the reference, but authors can type the same LaTeX by hand.

**Independent Test**: Select text and press each toolbar button; open search, find and replace a word.

**Acceptance Scenarios**:

1. **Given** the word `important` is selected, **When** the user presses Bold, **Then** it becomes `\textbf{important}` and the selection still covers `important`; Italic does the same with `\textit{...}`.
2. **Given** nothing is selected, **When** the user presses Bold, **Then** `\textbf{}` is inserted with the cursor between the braces.
3. **Given** a selection or cursor, **When** the user presses Section, **Then** `\section{...}` is inserted (wrapping the selection if any) with the cursor in the braces.
4. **Given** a selection, **When** the user presses Link, **Then** `\href{}{selection}` is inserted with the cursor in the URL braces.
5. **Given** the cursor on an empty line, **When** the user presses Figure or Table, **Then** a complete `figure` (with `\includegraphics`, `\caption`, `\label`) or `table` (with a small `tabular`, `\caption`, `\label`) environment is inserted and the cursor lands on the first placeholder.
6. **Given** the editor is focused, **When** the user presses the search button or the platform's find shortcut, **Then** a find/replace panel opens; matches are highlighted and the user can step through them and replace one or all.
7. **Given** a toolbar insertion, **When** the user presses Undo once, **Then** the whole insertion is reverted.

---

### User Story 5 - Run it with one command (Priority: P3)

A self-hoster clones the repository and starts the whole app with one container command. The document data survives container restarts and rebuilds.

**Why this priority**: Required by the project's self-hosting principle, but only matters once there is something to run.

**Independent Test**: Run the compose command on a clean machine, open the app, type, restart the containers, confirm the text persists.

**Acceptance Scenarios**:

1. **Given** a machine with a container runtime, **When** the operator runs the compose up command, **Then** the app becomes reachable in the browser on a documented port without further setup.
2. **Given** the app has saved text, **When** the containers are stopped, removed and started again, **Then** the text is still there.

---

### Edge Cases

- The real-time connection to the server drops while the user is typing: the editor stays usable, a visible indicator shows the document is not synced, and edits made while offline are saved once the connection returns.
- The page is reloaded within a second of the last keystroke: the last keystroke is still persisted (no lost tail of edits).
- The document is empty: the outline shows an empty-state message, not an error.
- A heading uses a starred form (`\section*{Preface}`) or an optional short title (`\section[Short]{Long title}`): it is listed, using the long title.
- A heading title contains nested braces or commands (`\section{The \emph{best} way}`): the outline shows the title text readably.
- Very large document (5,000+ lines): typing, scrolling and outline updates stay responsive.
- The browser window is narrow: panes keep minimum widths; collapsing the side panes gives the editor the full width.
- The database file is missing on start: the app creates it and seeds `main.tex` with starter content.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide exactly one project containing exactly one text file, `main.tex`, created with starter content on first start.
- **FR-002**: The system MUST store `main.tex` as a collaboratively editable document whose changes are sent to the server as they happen and persisted durably, with no separate save action.
- **FR-003**: The system MUST restore the latest persisted content on page reload and after a server restart.
- **FR-004**: Two browser sessions open on the project MUST see each other's edits without reloading.
- **FR-005**: The editor MUST provide LaTeX syntax highlighting, line numbers, matching-bracket highlighting, and find/replace.
- **FR-006**: Undo and redo MUST be available via keyboard shortcuts and toolbar buttons and MUST revert/re-apply the current user's own edits in order; a toolbar insertion counts as one undo step.
- **FR-007**: The toolbar MUST offer Bold, Italic, Section, Link, Figure and Table actions that insert the LaTeX described in User Story 4, wrapping the selection where one exists.
- **FR-008**: The workspace MUST show a left sidebar (file tree above file outline), the editor in the middle, and a PDF pane on the right, in a dark theme modeled on the reference layout, under a top bar showing the app name and project name, with a tab strip above the editor showing `main.tex`. Top-bar menus and the left icon rail are out of scope.
- **FR-009**: The divider between file tree and file outline MUST be draggable, with minimum heights for both sections.
- **FR-010**: The sidebar and the PDF pane MUST each collapse and expand via arrow handles on their borders; the editor fills freed space. Both vertical borders (sidebar|editor, editor|PDF) MUST be draggable to resize, with minimum widths per pane.
- **FR-011**: The file tree MUST list `main.tex` as the selected, open file. (Creating, renaming and deleting files is out of scope; see feature 003.)
- **FR-012**: The file outline MUST list `\section`, `\subsection` and `\subsubsection` headings (including starred forms) in document order, indented by level, skipping commented-out lines, and MUST update within one second of edits.
- **FR-013**: Clicking an outline entry MUST move the editor cursor to that heading's line, scroll it into view and focus the editor.
- **FR-014**: The PDF pane MUST show an empty state explaining that compilation is not available yet. (Compilation and PDF rendering are feature 002.)
- **FR-015**: The editor MUST show a visible indicator when the document is not connected to the server, and MUST sync edits made while disconnected once the connection returns.
- **FR-016**: All interactive controls MUST be keyboard reachable with visible focus and accessible names; the file tree and outline MUST expose tree/list semantics to assistive technology.
- **FR-017**: The whole application MUST start with a single container compose command, with document data stored on a persistent volume and the port configurable with a working default. By default the port MUST be published on the loopback interface only (`127.0.0.1`); an environment variable opens it to other hosts.
- **FR-018**: Pane widths, the sidebar split position and collapsed states MUST be remembered per browser and restored on reload.

### Key Entities

- **Project**: The single workspace; has a name shown in the top bar and contains one file.
- **File (`main.tex`)**: A named text document in the project; its content is the shared, persisted document state.
- **Outline entry**: Derived from the file content, not stored: heading level (section / subsection / subsubsection), title text, line number.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a page reload, 100% of text typed up to one second before the reload is present.
- **SC-002**: After stopping and restarting the app, the document content is identical to before the stop.
- **SC-003**: An edit made in one browser tab appears in a second tab on the same machine in under 300 ms.
- **SC-004**: The workspace is interactive (editor accepts typing) within 2 seconds of opening the app on a local network.
- **SC-005**: Clicking an outline entry places the cursor on the heading's line in 100% of cases for documents up to 5,000 lines.
- **SC-006**: A new operator gets the app running from a fresh clone with one command and no manual configuration.
- **SC-007**: Every acceptance scenario in this spec is covered by an automated test.

## Assumptions

- Single user, no login: anyone who can reach the app can edit the one project, so it listens on loopback only by default. Accounts arrive in feature 005; the app is not meant to be exposed publicly before then.
- The PDF pane is a placeholder with an empty state; compiling and rendering PDFs is feature 002.
- The file tree is read-only and lists only `main.tex`; file operations are feature 003.
- Undo history lives for the browser session; after a reload, undo starts fresh (the text itself is kept). (Confirmed in Clarifications.)
- Top-bar menus, history, share, layout and the left icon rail from the reference are not part of this feature; the top bar shows the app and project name only, plus an editor tab strip with `main.tex`. (Confirmed in Clarifications.)
- Desktop browsers (current Chrome, Firefox, Safari) with a window at least 1024 px wide; mobile layouts are out of scope.
- Starter content of `main.tex` is a short article with title, author, date and one `\section`, like the reference screenshot.
