# Feature Specification: Project history, restore, SyncTeX & PDF navigation

**Feature Branch**: `008-history-synctex`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "Roadmap item 008 — Project history, restore, SyncTeX & PDF navigation (former 008 + 009 merged). **History and restore.** History panel (the "History" button) with a timeline of versions grouped by time and author, created automatically from Yjs updates plus on every compile. Select a version to see a diff of each changed file against the current state, with additions and deletions colored per author. Name a version (labels). Restore a single file or the whole project to a version; restoring creates a new version instead of rewriting history. Download a zip of any version. Readers can browse history and download versions; only editors and the owner can restore, and per-file permissions from 005 apply to restoring single files. **SyncTeX and PDF navigation.** The arrows between the editor and PDF: jump from cursor position to the matching place in the PDF and from a double-click in the PDF to the source line, across files. PDF pane remembers scroll position across recompiles. Layout menu: side-by-side, editor only, PDF only, PDF in a separate window. History and restore must respect 005's Clerk auth, project roles (owner/editor/reader) and per-file permissions on the server."

## Clarifications

### Session 2026-10-07

- Q: When should consecutive edits be closed off as one automatic version? → A: After 5 minutes with no edits, and at least every 30 minutes during continuous editing.
- Q: If an editor restores the whole project but some files are read-only for them, what should happen? → A: Restore the files they can edit, skip the read-only ones, and list the skipped files.
- Q: What should a selected version's diff compare against? → A: Current state by default, with a toggle for "changes in this version" (compared with the previous version).
- Q: Who can rename or delete a label? → A: The label's author or the project owner; any editor or the owner can add labels.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse history and compare a version with the current state (Priority: P1)

A collaborator opens the History panel from the "History" button in the top bar. They see a timeline of project versions, newest first, grouped by day, each entry showing when it was made, who contributed to it, which files changed, and any label. Selecting a version shows, for each file that differs between that version and the current project, a diff: added text and deleted text are highlighted, tinted with the color of the author who made the change. Closing the panel returns to the editor.

**Why this priority**: Seeing what changed and who changed it is the base every other history action builds on, and it already answers "what happened to my document?" without touching anything.

**Independent Test**: Two users edit a project over time and compile once; a third user (reader) opens History, sees the versions with both authors, selects an older version and sees the diff of each changed file against today.

**Acceptance Scenarios**:

1. **Given** a project where Alice edited `main.tex` and later Bob edited `intro.tex`, **When** any member opens History, **Then** the timeline lists versions newest first, grouped by day, each showing time, author avatar(s)/names and changed file names.
2. **Given** an editing session, **When** a user types for a while and then stops for 5 minutes, **Then** that burst appears as one version, not one entry per keystroke; during continuous editing a version is still closed at least every 30 minutes.
3. **Given** a user clicks Recompile, **When** the compile finishes, **Then** a version is recorded at that moment (marked as a compile point) if anything changed since the previous version.
4. **Given** a version is selected, **When** the diff view opens, **Then** every file that differs from the current state is listed (default), or, with the "changes in this version" toggle, every file the version changed relative to the previous version, and each file's diff shows added and deleted lines/words with each change tinted in its author's color, with a legend mapping colors to names.
5. **Given** a file was added, deleted or renamed between the version and now, **When** the diff is shown, **Then** the file is listed with "added", "deleted" or "renamed from …" instead of a text diff; binary files show "changed" with old/new size.
6. **Given** the user has no access to the project, **When** they request its history in any way, **Then** the server refuses.

---

### User Story 2 - Restore a file or the whole project (Priority: P1)

An editor or the owner picks a version and restores either one file or the whole project to how it was. The restore is applied as a normal change visible live to everyone currently editing, and it is recorded as a new version ("Restored to <version>") so nothing is lost: the state before the restore remains in history and can itself be restored.

**Why this priority**: Recovering lost or broken work is the main reason history exists.

**Independent Test**: Edit a file, take note of the text, make a bad change, restore the file from the earlier version; the text returns, connected collaborators see it immediately, and the timeline gains a "restore" version while the bad version is still listed.

**Acceptance Scenarios**:

1. **Given** an editor selects a version, **When** they click "Restore this file" on one file in the diff, **Then** that file's content becomes the version's content, other files are untouched, and a new version labeled as a restore is added.
2. **Given** an editor selects a version, **When** they click "Restore project" and confirm, **Then** every text and binary file and the folder structure match that version: files that did not exist then are removed, files deleted since are recreated, renamed/moved files go back to their old names/places; a single new restore version is added.
3. **Given** another user has the restored file open, **When** the restore happens, **Then** they see the new content live within normal collaboration latency without reloading, and their own undo history does not let them undo the other user's restore.
4. **Given** a reader, **When** they view a version, **Then** restore actions are not offered, and a restore request sent directly to the server is refused.
5. **Given** an editor who has a per-file override making `chapter2.tex` read-only for them, **When** they try to restore that file, **Then** it is refused (not offered in the UI, refused by the server).
6. **Given** that same restricted editor restores the whole project, **When** the restore runs, **Then** every file they may edit is restored, the read-only files are left unchanged, and the result lists the skipped files by path
7. **Given** a restore, **When** it completes, **Then** the history still contains every version that existed before it (history is never rewritten).

---

### User Story 3 - Jump between source and PDF (SyncTeX) (Priority: P2)

With a compiled PDF on screen, the user clicks the "→" arrow between the editor and the PDF to scroll the PDF to the place matching the cursor and briefly highlight it. Double-clicking a spot in the PDF (or clicking the "←" arrow, which uses the top of the visible PDF page) opens the source file that produced it — whichever file of the project that is — and puts the cursor on the matching line.

**Why this priority**: Daily-use navigation for writing long documents; independent from history.

**Independent Test**: In a two-file project (`main.tex` includes `chapter.tex`), put the cursor on a paragraph in `chapter.tex`, press →; the PDF scrolls to that paragraph with a highlight. Double-click a paragraph produced by `main.tex`; the editor switches to `main.tex` at that line.

**Acceptance Scenarios**:

1. **Given** a successful compile and the cursor on line N of an included file, **When** the user clicks "→" (or the keyboard shortcut), **Then** the PDF scrolls so the matching location is visible and highlighted for about a second.
2. **Given** a compiled PDF, **When** the user double-clicks text in the PDF, **Then** the editor opens the source file for that text and places the cursor at the start of the matching line, scrolled into view.
3. **Given** the source has been edited since the last compile, **When** the user navigates, **Then** navigation uses the last compile's mapping (best effort) and does not error.
4. **Given** no compiled PDF or no mapping is available (compile failed, mapping missing), **When** the user tries to navigate, **Then** the arrows are disabled or a short "compile first" message is shown.
5. **Given** a reader, **When** they use navigation, **Then** it works the same as for editors (navigation is read-only).
6. **Given** a double-click maps to a file the user cannot open (e.g. a TeX system package), **Then** nothing changes and no error dialog appears.

---

### User Story 4 - PDF keeps its place across recompiles (Priority: P2)

After a recompile, the PDF pane stays on the same page and scroll offset (and zoom) the user was looking at, instead of jumping back to page 1.

**Why this priority**: Live compile is unusable on long documents if every recompile resets the view.

**Independent Test**: Scroll to page 5 halfway down, edit and recompile; the PDF still shows page 5 at the same offset.

**Acceptance Scenarios**:

1. **Given** the user is viewing page 5, **When** a recompile produces a new PDF with at least 5 pages, **Then** the view stays at the same page and relative offset with the same zoom.
2. **Given** the new PDF has fewer pages than the current position, **When** it loads, **Then** the view goes to the last page.
3. **Given** the user reloads the browser tab, **When** the project opens, **Then** the PDF returns to the last viewed position for that project on that device.

---

### User Story 5 - Name versions (Priority: P3)

An editor or the owner gives a version a label such as "Submitted to journal". Labeled versions stand out in the timeline and can be filtered to ("labels only"). Labels can be renamed or removed.

**Why this priority**: Helpful for finding milestones, but history is usable without it.

**Independent Test**: Label a version, reload, see the label in the timeline; filter to labels only; remove the label.

**Acceptance Scenarios**:

1. **Given** an editor, **When** they add a label to a version, **Then** the label, its author and time show in the timeline for every member.
2. **Given** a reader, **When** they view labels, **Then** they see them but cannot add, rename or delete (server enforces).
5. **Given** an editor who did not create a label, **When** they try to rename or delete it, **Then** it is refused; the label's author and the owner can.
3. **Given** "labels only" is toggled, **Then** only labeled versions are listed.
4. **Given** a user wants to mark the current state, **When** they choose "Label current version", **Then** a version is recorded now (if needed) and labeled.

---

### User Story 6 - Download any version as a zip (Priority: P3)

Any member, including readers, downloads a zip of the whole project as it was at a selected version.

**Why this priority**: Useful for archiving submissions, but an existing current-state zip already covers the common case.

**Independent Test**: Download the zip of an older version, unzip it, compare the files to that version's contents.

**Acceptance Scenarios**:

1. **Given** any member selects a version, **When** they click "Download zip", **Then** they receive a zip whose folder structure, text and binary files match that version exactly.
2. **Given** a non-member, **When** they request a version zip, **Then** the server refuses.

---

### User Story 7 - Choose the editor/PDF layout (Priority: P3)

A Layout menu in the top bar offers: side-by-side (default), editor only, PDF only, and PDF in a separate window. In the separate-window mode the PDF opens in its own browser window that keeps updating on recompile and still supports both SyncTeX directions with the main window; the main window shows the editor full width. The choice is remembered per device.

**Why this priority**: Comfort feature; the current side-by-side layout already works.

**Independent Test**: Switch through each layout, reload to confirm it persists, open the separate window, recompile and see it update, double-click in it to jump in the main editor.

**Acceptance Scenarios**:

1. **Given** the Layout menu, **When** the user picks "Editor only" or "PDF only", **Then** the other pane is hidden and the visible one uses the full width; "Side-by-side" restores both.
2. **Given** "PDF in separate window", **When** chosen, **Then** a new window shows the PDF for this project, the main window shows the editor full width, recompiles update the separate window, and → / double-click navigation works between the two windows.
3. **Given** the separate window is closed by the user, **Then** the main window returns to side-by-side.
4. **Given** the browser blocks the popup, **Then** the user sees a message and the layout stays unchanged.

### Edge Cases

- A file was deleted and later a new file with the same path and kind was created (by hand or by a restore): diffs show it as one edited file at that path, and restoring the project or that file to a version before the deletion puts the old content into the file at that path.
- Restoring a version while another user is typing in the same file: the restore and their concurrent keystrokes both apply (collaborative merge); nothing crashes and both users end up with the same text.
- Restoring a project whose main file setting pointed at a file that no longer exists: the main-file setting is restored together with the tree.
- Very large projects or long histories: the timeline loads incrementally (most recent first, more on scroll) and stays responsive.
- A version made by a user who was later removed from the project or deleted: the author's name and color still show.
- Changes made by restore are attributed to the user who ran the restore.
- Compile with no changes since the last version: no empty version is created.
- Per-file read-only for a user does not hide the file from history: readers of a file can still see its diffs and download it.
- SyncTeX across `\input`/`\include` in subfolders resolves to the right project file path.
- Two windows/tabs of the same user with different layouts: each device/tab remembers its own last choice; the latest choice wins on reload.

## Requirements *(mandatory)*

### Functional Requirements

**Version recording**

- **FR-001**: The system MUST record project versions automatically from collaborative edits, grouping consecutive edits into one version that closes after 5 minutes without edits, and at least every 30 minutes during continuous editing.
- **FR-002**: The system MUST record a version every time a compile is requested if the project changed since the previous version, and mark it as a compile point.
- **FR-003**: Each version MUST record the time, the set of users who contributed changes to it, the files changed, and enough information to reconstruct the full project (folder structure, text contents, binary files, main-file setting) at that version.
- **FR-004**: The system MUST record file-tree changes (create, rename, move, delete, upload/replace binary) as part of versions, attributed to the user who made them.
- **FR-005**: The system MUST keep every version for the lifetime of the project; deleting the project deletes its history.

**Browsing and diff**

- **FR-006**: Users MUST be able to open a History panel listing versions newest first, grouped by day, showing time, contributors, changed files, compile-point marker and labels; the list loads incrementally.
- **FR-007**: Selecting a version MUST show a per-file diff between that version and the current state by default, for every changed file, with insertions and deletions highlighted; a toggle MUST switch to "changes in this version" (the version compared with the previous version).
- **FR-008**: Each highlighted change MUST carry the color and name of the user who authored it, using the same per-user colors as live collaboration cursors, with a legend.
- **FR-009**: Added, deleted, renamed/moved and binary files MUST be shown as such rather than as text diffs.

**Restore**

- **FR-010**: Editors and the owner MUST be able to restore a single file to its content at a selected version, including recreating it if it has since been deleted.
- **FR-011**: Editors and the owner MUST be able to restore the whole project (tree, text, binaries, main-file setting) to a selected version after a confirmation step.
- **FR-012**: A restore MUST be applied as a regular collaborative change that connected users see live, and MUST create a new version labeled as a restore that references the source version; existing versions are never modified or removed.
- **FR-013**: The restore change MUST be attributed to the restoring user, and must not appear in other users' personal undo stacks.

**Labels and download**

- **FR-014**: Editors and the owner MUST be able to add labels to versions and label the current state; only the label's author or the project owner may rename or delete a label (server-enforced); all members see labels; the timeline can be filtered to labeled versions.
- **FR-015**: Any project member MUST be able to download a zip of the project as of any version.

**Access control (server-enforced)**

- **FR-016**: Every history, diff, label, restore and version-download request MUST verify the signed-in session and the user's project role on the server; non-members are refused, disabled users are refused.
- **FR-017**: Readers (and link-readers) MUST be able to browse history, view diffs and download versions, and MUST be refused on restore and label changes.
- **FR-018**: Single-file restore MUST be refused when the user's effective permission on that file (per-file/folder overrides from 005, evaluated at the file's target path) is read-only; the UI MUST not offer it.
- **FR-019**: Whole-project restore by a user with read-only files MUST restore only the files they may edit (including tree changes that touch only editable paths), leave read-only files unchanged, and return the list of skipped paths.
- **FR-020**: The owner MUST never be restricted by per-file overrides.

**SyncTeX and PDF navigation**

- **FR-021**: The control between the editor and the PDF MUST offer "→" (source to PDF) and "←" (PDF to source); "→" also has a keyboard shortcut.
- **FR-022**: Source-to-PDF MUST scroll the PDF to the location matching the cursor's file and line, and highlight it briefly.
- **FR-023**: Double-clicking in the PDF MUST open the matching source file of the project and place the cursor on the matching line; this works for any project file included by the main document, including files in subfolders.
- **FR-024**: Navigation MUST use the most recent successful compile's mapping, work for readers, and degrade gracefully (disabled control or short message) when no mapping exists.
- **FR-025**: The PDF pane MUST keep page, offset and zoom across recompiles, clamp to the last page when the document shrinks, and restore the last position for the project after a reload on the same device.

**Layout**

- **FR-026**: A Layout menu MUST offer side-by-side, editor only, PDF only, and PDF in a separate window; the choice persists per device.
- **FR-027**: The separate PDF window MUST update on recompile, keep its own scroll position across recompiles, and support both navigation directions with the main window; closing it returns the main window to side-by-side.

### Key Entities *(include if feature involves data)*

- **Version**: A point in a project's timeline. Has time, kind (edits, compile point, restore), contributing users, changed files, optional reference to the version it restored, and enough data to reconstruct the project at that point.
- **Version file entry**: A file's state at a version: path, kind, text content or binary reference, and whether it was added/changed/deleted/renamed relative to the previous version.
- **Label**: A user-given name attached to a version, with author and time; a version can have one or more labels.
- **Change attribution**: For text diffs, which user authored each inserted or deleted span, so diffs can be colored per author.
- **Source map (per compile)**: The mapping between PDF positions and project source file/line produced by the most recent successful compile.
- **Viewer preferences (per device)**: chosen layout and last PDF position per project.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member can find and open a version from earlier the same week and see its diff in under 30 seconds.
- **SC-002**: The History panel shows the first page of versions within 1 second for a project with 1,000 versions.
- **SC-003**: Restoring a single file or a whole project of up to 50 files completes and is visible to all connected collaborators within 2 seconds.
- **SC-004**: After any restore, 100% of previously existing versions are still listed and restorable.
- **SC-005**: 100% of restore and label-change attempts by readers, and of restores on read-only files, are refused by the server in automated tests.
- **SC-006**: Source-to-PDF and PDF-to-source jumps land on the correct page and within 2 lines of the target in at least 95% of attempts on a multi-file test document.
- **SC-007**: After a recompile, the PDF view is at the same page and offset as before in 100% of cases where that page still exists.
- **SC-008**: A downloaded version zip is byte-identical (per file) to the project at that version.

## Assumptions

- Builds on 005: Clerk sessions, project roles (owner/editor/reader, link roles), per-file/folder overrides and per-user colors already exist and are reused unchanged.
- The compile step already produces the source-map data (SyncTeX) alongside the PDF; this feature only exposes and uses it.
- History starts when this feature is deployed: edits made before have no versions except one initial "baseline" version per existing project capturing its state at upgrade time.
- Binary files are already stored immutably by content, so versions can reference old binaries without copying them.
- Diffs show character-level insertions and deletions inline within the lines they touch.
- Per-author coloring in the diff is based on who authored each piece of text in the history between the selected version and now; text whose author is unknown (e.g. pre-history baseline) is shown in a neutral color.
- Layout and PDF position preferences are stored in the browser (per device), not on the server.
- Duplicating a project does not copy its history: the copy starts with one baseline version.
- Comments/chat (010) and storage cleanup/backups (011) are out of scope; history storage grows without automatic pruning in this feature.
