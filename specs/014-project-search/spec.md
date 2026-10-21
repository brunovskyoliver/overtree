# Feature Specification: Search and replace across the project

**Feature Branch**: `014-project-search`

**Created**: 2026-10-21

**Status**: Implemented

**Input**: User description: "Overleaf 6.1 added project-wide search; Overtree only has CodeMirror's in-file search. Cmd/Ctrl+Shift+F (and a search icon in the sidebar) opens a Search view in the left sidebar: query field, toggles for match case, whole word, regex; a replace field; results grouped by file with each matching line and the match highlighted. Arrow keys/Enter navigate; clicking a result opens the file and selects the match. Search every text file, including files not open in tabs. Respect access: readers see results but can't replace. Replace one match, all in a file, all in the project (with a confirm showing counts). Replacements are collaborative edits, credited to the user in history and live for collaborators. Invalid regex shows an inline error. Cap results on large projects."

## Clarifications

### Session 2026-10-21

- Q: Do results update by themselves? → A: Partly. They refresh as the query or an option changes, after the user's own typing in any document (after a pause), after each replace, and when files are added, renamed or deleted. A collaborator's typing doesn't refresh them; "Search again" does. A result that went stale still opens the closest current match, and replacing a single stale match is refused with "search again".
- Q: How is a project-wide replace undone? → A: Through History. Everything changed before it is closed into a version, and the replace becomes a version of its own, credited to the user, so "Restore" on the version before it undoes it. Ctrl/⌘+Z in the editor doesn't undo replacements made from the Search view; it only undoes the user's own typing.
- Q: What is a "word" for whole-word search? → A: A run of letters (any alphabet, so `über` counts), digits and `_`. A match is whole when neither neighbour is one of those, so `\section` matches as a whole word in `\section{…}` but not in `\sections`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find text anywhere in the project (Priority: P1)

A writer wants every place a term appears across `main.tex`, the chapters and the bibliography. They press Ctrl/⌘+Shift+F (or the magnifier in the file tree's header). The left sidebar switches to a Search view with the cursor in the query field. As they type, results appear grouped by file: each group shows the file's path and how many matches it has, and below it every matching line with its line number and the match highlighted. Toggles next to the field turn on case matching, whole-word matching and regular expressions. Clicking a result, or moving to it with the arrow keys and pressing Enter, opens that file in a tab, even one that wasn't open, with the match selected and scrolled into view.

**Why this priority**: Finding is the core of the feature and has value without replace.

**Independent Test**: In a project with `main.tex` open and `chapters/intro.tex` never opened, search "needle": one result in `chapters/intro.tex`; clicking it opens that file with "needle" selected.

**Acceptance Scenarios**:

1. **Given** the project is open, **When** the user presses Ctrl/⌘+Shift+F or clicks "Search project" in the file tree header, **Then** the sidebar shows the Search view (expanding the sidebar if it was collapsed) with the query field focused.
2. **Given** a query, **When** the user stops typing for a moment, **Then** every text file of the project (`.tex`, `.bib`, `.cls`, `.sty`, `.md`, `.txt` and the other text types the project treats as editable) is searched, including files not open in tabs, and the summary says "N matches in M files".
3. **Given** results, **When** the user clicks a match, **Then** its file opens in a tab and becomes active, the match is selected and scrolled to the middle of the editor, and the editor has focus.
4. **Given** "Match case" or "Whole word" is turned on, **When** results refresh, **Then** only matches with the same case, or with no letter, digit or `_` right before or after, are listed.
5. **Given** results, **When** the user presses ↓ in the query field, **Then** focus moves to the first match; ↓/↑ move between matches (↑ on the first goes back to the field), Home/End jump to the first/last, and Enter opens the focused match like a click.
6. **Given** "Regular expression" is on, **When** the query is a valid pattern, **Then** matches follow the pattern (case and whole word still apply) and matches of zero length are ignored.
7. **Given** "Regular expression" is on, **When** the query is not a valid pattern, **Then** an inline error under the field gives the reason, no results are listed, nothing is sent to the server, and fixing the pattern brings the results back.
8. **Given** a search with more than 2,000 matches, **When** the results come back, **Then** the first 2,000 (in file path order) are listed and the summary says only the first 2,000 are shown.
9. **Given** the Search view, **When** the user presses Escape or the close button, **Then** the sidebar shows the file tree and outline again; reopening the Search view shows the last query and results.
10. **Given** the user edits a document, or files are added, renamed or deleted, **When** they pause, **Then** the results refresh by themselves; "Search again" refreshes on demand (for example after a collaborator's edits).

---

### User Story 2 - Replace matches, from one to the whole project (Priority: P1)

The writer renames a macro or fixes a recurring typo. With the replacement typed in the "Replace with" field, they can replace a single match (the button that appears on the match row), every match in one file (the button on the file's header), or every match in the project with "Replace all", which first asks for confirmation with the counts. Replacements show up at once for everyone who has those files open, like a collaborator's typing, and history credits them to the person who replaced.

**Why this priority**: Replace is the main reason to search across files, and the multi-file replace is where the in-file search falls short.

**Independent Test**: Two users have `main.tex` open; user A replaces "alpha" with "omega" in all files after confirming "Replace 3 matches in 2 files"; user B sees `main.tex` change without reloading and finds `chapters/intro.tex` changed when opening it.

**Acceptance Scenarios**:

1. **Given** results and a replacement, **When** the user replaces one match, **Then** only that occurrence changes, the note says "Replaced 1 match.", and the results refresh.
2. **Given** results, **When** the user clicks "Replace all in <file>", **Then** every match in that file changes, and no other file does.
3. **Given** results, **When** the user clicks "Replace all", **Then** a confirmation says how many matches in how many files will be replaced and with what, how many matches in read-only files won't change, and that the change can be restored from History; Cancel changes nothing.
4. **Given** the user confirms, **When** the replace runs, **Then** every match in every file the user may edit is replaced (including matches past the 2,000 listed), the note says "Replaced N matches in M files." (plus how many read-only matches were skipped), and collaborators with those files open see the change live.
5. **Given** "Regular expression" is on, **When** the replacement contains `$1`, `$<name>` or `$&`, **Then** they are filled in with the match's groups or the whole match; with regular expressions off, the replacement is used literally.
6. **Given** a replacement, **When** History is opened afterwards, **Then** the change is credited to the user who replaced; a "Replace all" in the project is a version of its own that can be undone by restoring the version before it.
7. **Given** the list is from an older search (the file changed since), **When** the user replaces a single match that is no longer there, **Then** nothing changes, the user is told the match changed and to search again, and the results refresh.
8. **Given** the user typed a new query that hasn't been searched yet, **When** they click "Replace all", **Then** the search runs first and the confirmation shows the counts for the query as typed.

---

### User Story 3 - Access rules apply to search and replace (Priority: P1)

A reviewer with read-only access searches the project to check terminology; they see all results but cannot change anything. An editor who has been made reader on one chapter (a per-file permission) can replace everywhere except in that chapter, and the interface says why.

**Why this priority**: Replace writes to many files at once; it must not get around the permissions from feature 005.

**Independent Test**: A project reader searches "alpha": results from every file, each marked "read only", every replace button disabled with the reason in its tooltip, and the server refuses a direct replace request.

**Acceptance Scenarios**:

1. **Given** a project reader, **When** they search, **Then** they see results from every file they can open, each file marked "read only".
2. **Given** a project reader, **When** they look at the replace buttons, **Then** all of them, including "Replace all", are disabled and their tooltip says "Read only: you can view this file but not edit it."; a replace request sent to the server anyway is refused.
3. **Given** an editor with a per-file Reader permission on `chapters/intro.tex`, **When** they search, **Then** that file's results are marked "read only" with replace disabled, other files can be replaced, and "Replace all" in the project replaces only in the files they may edit and reports the skipped matches.
4. **Given** someone who is not a member of the project, **When** they call search or replace, **Then** the server answers as if the project didn't exist.

---

### Edge Cases

- An empty query lists nothing and sends nothing.
- A match that spans lines (regex with `\n`) is listed on the line it starts on, showing that line's part; replacing it replaces the whole match.
- Long lines are cut around the match ("…") so the match stays visible in a narrow sidebar.
- A file deleted while results are shown disappears from the list on the next refresh; clicking a result of a file that no longer exists does nothing.
- A result whose text moved since the search (someone typed above it) opens the nearest current match in that file; if none is left, the cursor goes to where it was.
- Binary files (images, PDFs) are never searched.
- Replacing with an empty replacement deletes the matches.
- The search runs on the server's current copy of each document, which includes everything collaborators have typed and synced.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Ctrl/⌘+Shift+F and a "Search project" button in the file tree header MUST open a Search view in the left sidebar with the query field focused; Escape or a close button MUST return to the file tree and outline.
- **FR-002**: The Search view MUST have a query field, toggles for match case, whole word and regular expression, a "Replace with" field and a "Replace all" button.
- **FR-003**: A search MUST cover the current text of every text file of the project that the user can open, open in a tab or not.
- **FR-004**: Results MUST be grouped by file in path order, each group showing the path, the match count and a "read only" mark when the user can't edit the file; each match MUST show its line number and an excerpt of its line with the match highlighted.
- **FR-005**: Clicking a match, or Enter on it, MUST open its file in a tab with the match selected and in view.
- **FR-006**: ↓/↑/Home/End MUST move between matches, and ↓ from the query field MUST enter the list.
- **FR-007**: An invalid regular expression MUST show an inline error with the reason and no results, never an error page or a broken view.
- **FR-008**: Results MUST refresh as the query or options change (debounced), after the user's own edits (after a pause), after each replace and after tree changes; a "Search again" button MUST refresh on demand.
- **FR-009**: The user MUST be able to replace one match, all matches in one file, or all matches in the project; the project-wide replace MUST ask for confirmation showing the match and file counts, including how many read-only matches will be skipped.
- **FR-010**: Replacements MUST be collaborative edits of the documents: live for everyone with the file open, credited to the replacing user in history, with no other way of writing text.
- **FR-011**: A project-wide replace MUST be recorded as a history version of its own (earlier unsaved-to-history changes closed into the version before it).
- **FR-012**: A search MUST list at most 2,000 matches and say so when it cut the list.
- **FR-013**: Replace MUST be disabled, with the reason, for files where the user's effective role is reader (project role or per-file permission); the server MUST refuse such replacements and skip such files in a project-wide replace.
- **FR-014**: A single-match replace MUST check the match is still there in the current text and refuse otherwise.
- **FR-015**: In regular-expression mode, `$1`…`$99`, `$<name>`, `$&`, `` $` ``, `$'` and `$$` in the replacement MUST expand like JavaScript's `String.replace`; otherwise the replacement is literal.

### Key Entities

- **Search**: query plus the three options; not stored.
- **Match**: file, position in the document, line number, excerpt.
- **Replacement**: the matches it covers (one, a file, the project), the replacement text, the user; recorded only as the document edits it makes and their history version.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a project of 50 text files, results for a query appear within 1 second of the user pausing.
- **SC-002**: A project-wide replace appears in collaborators' open editors within the usual 300 ms of being applied.
- **SC-003**: 100% of replacements show up in History under the replacing user's name.
- **SC-004**: No replacement ever changes a file the user can't edit (verified by automated tests for project readers and per-file readers).

## Assumptions

- Overleaf's search is the model for the layout: a sidebar view rather than a dialog.
- Search state (query, options) isn't remembered across page loads.
- Searching file names (as opposed to contents) is out of scope; the file tree already shows them.
- Undoing a replacement with Ctrl/⌘+Z is out of scope; History restore covers project-wide replaces.
