# Feature Specification: References from DOI, arXiv and Zotero

**Feature Branch**: `017-references`

**Created**: 2026-10-21

**Status**: Implemented

**Input**: User description: "Overleaf and OpenAI Prism let writers pull citations in without hand-writing BibTeX. An Add reference dialog (toolbar button, also offered from the `\cite{` completion): paste a DOI or an arXiv id, preview the entry with an editable key, pick the .bib, insert, optionally cite at the cursor. Zotero: connect a library with user ID and API key, search it, multi-select, insert with the same de-duplication."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a reference from a DOI or arXiv id (Priority: P1)

A writer has a DOI from a paper's web page, or an arXiv link. In the editor they click "Add reference" in the toolbar (or pick "Add reference…" at the end of the suggestions while typing `\cite{`), paste the DOI or link and click "Look up". Overtree shows the BibTeX entry it found, with a citation key it made up from the first author, the year and the first word of the title (`smith2021deep`). The writer can change the key, chooses which `.bib` file gets the entry (preselected: the one the main document loads) and adds it. Overtree can also put `\cite{smith2021deep}` at the cursor in the same step.

**Why this priority**: Looking up one paper by DOI is the most common way a citation enters a document, and hand-writing or copy-pasting BibTeX is where errors creep in.

**Independent Test**: In a project whose main document ends with `\bibliographystyle{plain}\bibliography{references}` and has no `.bib` yet, look up a DOI, add it with "Also insert \cite" on, type `\cite{` and see the new key suggested, compile and see the formatted reference in the PDF.

**Acceptance Scenarios**:

1. **Given** an editor in a LaTeX file, **When** they paste a DOI in any common form (`10.1234/x`, `doi:10.1234/x`, `https://doi.org/10.1234/x`) and look it up, **Then** they see the BibTeX entry with title, authors and year, under a key of the form author-year-word.
2. **Given** an arXiv id or link (`2101.00001`, `arXiv:2101.00001v2`, `https://arxiv.org/abs/2101.00001`), **When** they look it up, **Then** the entry carries the arXiv id, `archivePrefix = {arXiv}` and the primary category; it is a journal article when arXiv knows the published version, otherwise a preprint (`@misc`).
3. **Given** the preview, **When** the writer edits the key to one already used in the project or to one BibTeX can't take (spaces, commas, braces…), **Then** they see why and can't add until it is fixed.
4. **Given** the main document loads a `.bib` (`\bibliography{…}` or `\addbibresource{…}`), **When** the dialog opens, **Then** that file is preselected; when it loads one that doesn't exist yet, or the project has no `.bib` at all, the choice is that file (or `references.bib` next to the main document) marked "new file", created on adding. A `.bib` the main document doesn't load is offered with a hint that it must be loaded to cite from it.
5. **Given** the writer adds the entry, **When** it is added, **Then** it is appended to the chosen file as an ordinary edit: collaborators with the file open see it appear live and it is part of the project's history like typing.
6. **Given** "Also insert \cite at the cursor" is ticked, **When** the entry is added, **Then** `\cite{key}` is inserted at the cursor; when the dialog was opened from inside `\cite{…}`, only the key is inserted there, replacing a half-typed key. Undo removes the citation in one step.
7. **Given** a key was just added, **When** the writer types `\cite{`, **Then** the new key is suggested.
8. **Given** the entry was added to a `.bib` the main document loads, **When** the project is compiled, **Then** the citation and the bibliography entry appear in the PDF.
9. **Given** a reader of the project, **When** they look at the toolbar, **Then** "Add reference" is disabled, and the server refuses lookups and inserts from them.

---

### User Story 2 - Add references from a Zotero library (Priority: P2)

A writer keeps their library in Zotero. In the Add reference dialog's Zotero tab they connect their library once with their Zotero user ID and a private API key (from zotero.org/settings/keys). Afterwards the tab lists their most recently changed items and lets them search by title, author or year, tick several items and add them all to a `.bib` in one go, with the same key, file and citation choices as for a DOI.

**Why this priority**: Writers with a curated library don't want to look papers up one by one, but it needs a one-time setup and only serves Zotero users.

**Independent Test**: Connect with a user ID and API key, search "knuth", tick "The TeXbook", add it; `references.bib` gets the entry and `\cite{knuth1986texbook}` appears at the cursor. Disconnect; the connect form is back.

**Acceptance Scenarios**:

1. **Given** a user without a connection, **When** they enter their user ID and a valid API key that can read their library, **Then** the tab shows "Connected as <Zotero username>" and their items.
2. **Given** a wrong key, a key of another Zotero user, or a key without library access, **When** they connect, **Then** they see which of these it is and nothing is stored.
3. **Given** a connected user, **When** they search, **Then** they see matching items (title, authors, year, proposed key); notes and attachments are not listed.
4. **Given** several ticked items, **When** they add them, **Then** all go into the chosen `.bib` in one edit and, when asked, `\cite{a,b,…}` is inserted at the cursor.
5. **Given** a saved connection, **When** anyone inspects the pages or API responses, **Then** the API key is never there; it is stored encrypted on the server, used only for the user's own searches, and never logged.
6. **Given** a connected user, **When** they click "Disconnect", **Then** the stored key is deleted (the key itself stays valid at Zotero until the user revokes it there).
7. **Given** the key was revoked at Zotero, **When** the user searches, **Then** they are told to disconnect and connect again.
8. **Given** a connection, **When** the same user opens any of their projects, **Then** the library is available there too (one connection per Overtree user, not per project).

---

### User Story 3 - No duplicate entries (Priority: P2)

A project grows over months and several people add references. When someone looks up a paper that is already in one of the project's `.bib` files, under whatever key, Overtree says so and offers to cite the existing key instead of adding a second entry.

**Why this priority**: Duplicate entries under different keys produce duplicate bibliography items and inconsistent citations, a common mess in shared projects.

**Independent Test**: With `@article{mine, doi = {10.1234/deep.2021}}` in `refs.bib`, look up `10.1234/DEEP.2021`: the dialog says "Already in refs.bib as mine." and offers "Cite mine".

**Acceptance Scenarios**:

1. **Given** a work in any `.bib` of the project with the same DOI (in any letter case or link form), the same arXiv id (any version, or arXiv's own DOI), or for works without either the same title and year, **When** it is looked up or listed from Zotero, **Then** it is marked as already present with its file and key, and is not added again.
2. **Given** a duplicate in the DOI tab, **When** the writer clicks "Cite <key>", **Then** `\cite{key}` is inserted and no file changes.
3. **Given** ticked Zotero items of which some are already present, **When** they are added, **Then** only the new ones are appended and the citation uses the existing keys for the others.
4. **Given** a proposed key already used by a different work, **When** the entry is prepared, **Then** a letter is appended (`smith2021deepa`, `…b`); keys compare case-insensitively, like BibTeX.

---

### Edge Cases

- A DOI that doesn't exist: "No DOI … was found. Check it for typos." An arXiv id that doesn't exist: "arXiv has no paper …".
- doi.org or arXiv rate-limits: "… is rate-limiting requests. Wait a minute and try again."
- The server can't reach the service, or it doesn't answer within 8 seconds: a message saying so; nothing is added.
- A DOI whose registry has no BibTeX: said so.
- An answer larger than 2 MB is refused.
- doi.org redirects to the registration agency's service (Crossref, DataCite, mEDRA); a redirect anywhere else is refused, so a lookup can never make the server fetch an arbitrary address.
- Text that is neither a DOI nor an arXiv id: "Paste a DOI … or an arXiv id or link."
- An arXiv title containing `&` or `%` is escaped so the compile doesn't break.
- The chosen `.bib` was deleted while the dialog was open: "That .bib file is gone. Pick another one."
- Two people add the same new key at nearly the same time: the second gets a letter appended.
- A user with edit access to the project but not to any `.bib` (per-file permissions) and nowhere to create one: "There is no .bib file here you can edit."
- Restoring an old version (feature 008) removes added entries like any edit.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Editors and the owner MUST be able to open "Add reference" from the editor toolbar and from the citation suggestions inside `\cite{…}` and similar commands.
- **FR-002**: The system MUST accept DOIs and arXiv ids in their common pasted forms and fetch a BibTeX entry for them from doi.org or the arXiv API.
- **FR-003**: The system MUST propose a citation key `<first author surname><year><first significant title word>` in plain lower-case letters, unique in the project, and let the user edit it with validation.
- **FR-004**: The system MUST de-duplicate against every `.bib` of the project by DOI, arXiv id, or title and year.
- **FR-005**: The user MUST choose the target `.bib`; the default MUST follow the main document's bibliography commands, creating the file when needed.
- **FR-006**: Adding MUST be a normal collaborative edit of the `.bib` (live for others, in history, undone by restore).
- **FR-007**: The user MUST be able to have `\cite{…}` inserted at the cursor in the same step.
- **FR-008**: New keys MUST be offered by `\cite{` completion right after adding.
- **FR-009**: Each user MUST be able to connect and disconnect one Zotero library; the API key MUST be stored encrypted, MUST NOT be returned to any browser or written to logs, and MUST be deleted on disconnect.
- **FR-010**: Connected users MUST be able to search their library and add several items at once.
- **FR-011**: The server MUST only contact the fixed services (and doi.org's registration agencies), with a time limit and a size limit, and MUST report not found, rate limiting and unreachable services in plain language.
- **FR-012**: Readers MUST NOT be able to look up or add references; the server MUST enforce it.

### Key Entities

- **Reference entry**: one BibTeX entry: type, key, fields. Identified as a work by DOI, arXiv id, or title and year.
- **Bibliography target**: a `.bib` file of the project, or one to create, and whether the main document loads it.
- **Zotero connection**: per Overtree user: Zotero user ID, Zotero username, encrypted API key.

## Success Criteria *(mandatory)*

- **SC-001**: From pasting a DOI to having it cited in the text takes under 15 seconds and no typing of BibTeX.
- **SC-002**: A paper added twice by two collaborators ends up once in the project's `.bib` files.
- **SC-003**: A project compiled right after adding a reference to the file the main document loads shows the citation, with no "undefined citation" warnings.
- **SC-004**: No Zotero API key can be read from any browser-facing response or page after it was saved.
