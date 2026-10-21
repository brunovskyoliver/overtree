# Feature Specification: Track changes (suggest mode)

**Feature Branch**: `013-track-changes`

**Created**: 2026-10-21

**Status**: Implemented

**Input**: User description: "Overleaf-style track changes for LaTeX writers reviewing each other's work: a per-project Track changes switch, every edit recorded as a suggestion while it is on, insertions highlighted in the author's color, deletions applied but shown as a marker with the deleted text, a review panel with Accept / Reject per change and for all, undo keeps working, collaborators see suggestions live."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn track changes on for the whole project (Priority: P1)

A supervisor is about to review a student's thesis. They switch on "Track changes" in the top bar. From that moment every collaborator's edits in the project become suggestions instead of silent changes, and every collaborator sees the switch is on (it is highlighted for everyone), so nobody types without knowing.

**Why this priority**: Without the switch nothing is recorded; it also decides who may change the rules of the review.

**Independent Test**: Owner and an editor have the project open; the owner turns track changes on; within a second the editor's switch shows "on"; the editor turns it off and both see "off".

**Acceptance Scenarios**:

1. **Given** a project with track changes off, **When** an owner or editor clicks "Track changes", **Then** it turns on for everyone in the project, and every open editor shows it as on without a reload.
2. **Given** track changes on, **When** an owner or editor clicks it again, **Then** it turns off for everyone.
3. **Given** a reader, **When** they look at the top bar, **Then** they see whether track changes is on, cannot change it, and the server refuses the change from them.
4. **Given** track changes off, **When** anyone edits, **Then** nothing is recorded as a suggestion.

---

### User Story 2 - Edits become visible suggestions (Priority: P1)

With track changes on, a co-author rewrites a paragraph. Text they type is highlighted in their presence color. Text they delete disappears from the document, so a compile shows the proposed version, and a small marker in their color remains where it was; hovering it shows who deleted what. Replacing a selected word shows as a deletion followed by an insertion. Typing a sentence in one go produces one suggestion, not one per letter. Everyone else in the project sees these suggestions as they happen.

**Why this priority**: This is the feature: reviewers must see exactly what changed and by whom.

**Independent Test**: With tracking on, B types " new" after "alpha" and deletes " beta" in "alpha beta gamma"; A sees " new" highlighted in B's color and a marker whose tooltip reads "B deleted:  beta", within 300 ms of B's keystroke.

**Acceptance Scenarios**:

1. **Given** track changes on, **When** a user types, **Then** the new text is highlighted in that user's color with their name on hover, for them and for every collaborator, within 300 ms on a LAN.
2. **Given** track changes on, **When** a user deletes text, **Then** the text is removed from the document (compile and GitHub sync see the proposed version) and a marker in their color stays at that place.
3. **Given** a deletion marker, **When** someone hovers it, **Then** a tooltip shows the author and the deleted text.
4. **Given** a user typing several characters in a row, or deleting with repeated Backspace or Delete, **When** they do, **Then** that is one suggestion, not one per character; another user's adjacent typing is a separate suggestion.
5. **Given** a selection, **When** the user types over it, **Then** it shows as a deletion of the old text followed by an insertion of the new.
6. **Given** suggestions in a file, **When** someone reloads, opens the file later, or comes back from offline editing, **Then** the suggestions are still there and in the right places.
7. **Given** a user deletes text inside a suggested insertion (theirs or someone else's), **When** they do, **Then** the suggestion just gets shorter; if all of its text goes, the suggestion disappears.

---

### User Story 3 - Review: accept or reject (Priority: P1)

The supervisor opens the review panel with the "Review" button. It lists the open file's suggestions in document order with the author, how long ago, and a snippet of the inserted or deleted text. Clicking one selects it in the editor. Accept keeps the change and removes the suggestion; Reject undoes it: inserted text is removed, deleted text comes back where it was. "Accept all" and "Reject all" handle every suggestion of the file at once.

**Why this priority**: Suggestions that cannot be resolved are only noise.

**Independent Test**: B makes one insertion and one deletion; A opens the panel, sees two entries with B's name, accepts the insertion and rejects the deletion; both browsers end with the inserted text kept and the deleted text back, and no markers.

**Acceptance Scenarios**:

1. **Given** suggestions in the open file, **When** the user opens the review panel, **Then** it lists each with author, relative time, kind (inserted or deleted) and a snippet, in document order; with none it says "No changes in this file."
2. **Given** an entry, **When** the user clicks it, **Then** the editor scrolls to the change and selects it.
3. **Given** a suggested insertion, **When** an owner or editor accepts it, **Then** the text stays and the highlight goes for everyone; **When** they reject it, **Then** the text is removed for everyone.
4. **Given** a suggested deletion, **When** an owner or editor accepts it, **Then** the marker goes and the text stays deleted; **When** they reject it, **Then** the deleted text reappears at its place for everyone.
5. **Given** several suggestions, **When** an owner or editor clicks "Accept all" or "Reject all", **Then** every suggestion of the file is accepted or rejected, including a replacement (deletion plus insertion) and suggestions inside other suggestions.
6. **Given** a reader (or an editor without edit rights on this file), **When** they open the panel, **Then** they see the suggestions but no Accept or Reject buttons.

---

### User Story 4 - Undo still works (Priority: P2)

A user who typed a suggestion by mistake presses Ctrl/⌘+Z. The text and its suggestion both go, as if they had never typed. Redo brings both back. Undo only affects the user's own edits, as before.

**Why this priority**: Undo is muscle memory; it must not leave orphaned suggestions.

**Independent Test**: With tracking on, A types "mine " and presses Ctrl/⌘+Z; both browsers show the original text and no suggestion; Ctrl/⌘+Shift+Z shows "mine " highlighted again in both.

**Acceptance Scenarios**:

1. **Given** a tracked insertion of the user's own, **When** they undo, **Then** the text and its suggestion are removed for everyone.
2. **Given** an undone suggestion, **When** the user redoes, **Then** the text and its suggestion come back, in the right place for every collaborator and after a reload.
3. **Given** a tracked deletion of the user's own, **When** they undo, **Then** the text comes back and the deletion marker goes.

---

### Edge Cases

- Restoring a version of a file (history) or replacing a text file by upload writes plain text: the file's suggestions are dropped, since the restored text never had them.
- Duplicating a project copies the current text (the proposed version) without suggestions; the copy starts with track changes off.
- GitHub sync and compile use the current text: deletions are gone, insertions present (the proposed version), like Overleaf.
- Changes merged in from GitHub are not tracked; existing suggestions keep their places around them.
- A collaborator who goes offline before the switch turns on keeps editing untracked until they reconnect and learn the new state.
- Accept and Reject are not on anyone's undo stack.
- Typing inside someone else's suggested insertion creates the typist's own suggestion inside it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each project MUST have one track-changes state, off by default, changeable by owners and editors and visible to everyone in the project, updated live in open editors.
- **FR-002**: While on, every edit a user makes in the editor MUST be recorded as a suggestion attributed to them, with time.
- **FR-003**: Inserted text MUST be highlighted in the author's color; deleted text MUST be removed from the document and shown as a marker whose tooltip names the author and shows the deleted text.
- **FR-004**: Adjacent edits of the same kind by the same author MUST merge into one suggestion; a replacement MUST be a deletion followed by an insertion.
- **FR-005**: Suggestions MUST be part of the file's collaborative document: they sync live (within the 300 ms budget), persist, survive reconnects and offline edits, and are stored with the document's history.
- **FR-006**: A review panel MUST list the open file's suggestions with author, relative time and snippet, scroll to a change on click, and offer Accept and Reject per suggestion plus Accept all and Reject all.
- **FR-007**: Only owners and editors with edit rights on the file MAY accept or reject; the server MUST drop changes from readers.
- **FR-008**: Undo and redo MUST take a user's own suggestion back together with its text.
- **FR-009**: Compile, download and GitHub sync MUST see the proposed text (deletions applied, insertions present).
- **FR-010**: Restoring a file from history MUST leave it without suggestions.

### Key Entities

- **Track-changes state**: on or off, per project.
- **Suggestion**: an insertion (a stretch of the file's text) or a deletion (a place in the text plus the removed text), with author (id, name, color) and time.

## Success Criteria *(mandatory)*

- **SC-001**: A collaborator sees another user's suggestion less than 300 ms after the keystroke on a LAN.
- **SC-002**: After accepting or rejecting every suggestion, all collaborators have identical text and no markers.
- **SC-003**: Every acceptance scenario above runs as an automated test.

## Assumptions

- The switch lives in the top bar next to History; the review panel is a column at the right of the editor.
- Suggestions are per file; the panel shows the open file only.
- Comments on suggestions (Overleaf's review threads) are out of scope.
