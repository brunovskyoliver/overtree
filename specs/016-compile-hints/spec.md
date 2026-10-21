# Feature Specification: Friendlier compile errors and code check

**Feature Branch**: `016-compile-hints`

**Created**: 2026-10-21

**Status**: Implemented

**Input**: User description: "TeX errors are cryptic; Overleaf shows hints and inline markers, and has a 'code check'. Error hints for the common errors and warnings in the logs panel; inline markers in the editor after a compile; an instant code check while typing, on by default with a per-user toggle; optional ChkTeX behind a per-project compile option."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understand what an error means and how to fix it (Priority: P1)

A writer compiles and gets "Undefined control sequence". In the logs panel the entry now explains in plain words what went wrong and suggests a concrete fix: `\includegraphics` comes from the graphicx package, so add `\usepackage{graphicx}`. Errors show their hint right away; warnings and typesetting notes keep theirs folded until opened. The panel can show one kind of entry at a time.

**Why this priority**: Raw TeX messages are the biggest hurdle for new LaTeX writers. A hint that names the cause and the fix turns a dead end into a one-line change.

**Independent Test**: Compile a document that uses `\includegraphics` without loading graphicx; the logs panel's error names graphicx and shows `\usepackage{graphicx}` as the fix.

**Acceptance Scenarios**:

1. **Given** a document using `\includegraphics` (or `\url`, `\SI`, `\toprule`) without its package, **When** it compiles, **Then** the error's hint names the command and the package (graphicx, url or hyperref, siunitx, booktabs) and suggests the `\usepackage` line; the hint of an error is shown expanded.
2. **Given** a reference to a label that doesn't exist, **When** it compiles, **Then** the warning's hint names the key, says to check it or add the label, and mentions that new labels show after one more compile; the hint is folded until the writer opens it.
3. **Given** a log with errors, warnings and typesetting notes, **When** the writer picks a filter (Errors, Warnings, Typesetting, ChkTeX, or All), **Then** only that kind of entry is listed.
4. **Given** `\includegraphics{plott.png}` where the project has `plot.png`, **When** it compiles, **Then** the hint says the file doesn't exist at that path and asks "Did you mean plot.png?". The same holds for `\input` of a file that sits in another folder (the suggestion is written the way `\input` takes it, without `.tex`).
5. **Given** a `\usepackage` of a package that isn't installed, **When** it compiles, **Then** the hint says whether the name looks like a typo of a known package (and gives the right name) or the package is missing from this TeX image (and points to the full image described in the README, or to uploading the `.sty`).
6. **Given** any of: Missing $ inserted, Environment X undefined, Missing \begin{document}, Runaway argument / Paragraph ended before / File ended while scanning, Too many }'s / Extra }, \begin{x} ended by \end{y}, Misplaced alignment tab, undefined citation, overfull or underfull box, Emergency stop, **When** it appears in the log, **Then** its entry carries a hint with an explanation and a fix (box warnings in mild wording: usually harmless).

---

### User Story 2 - See problems where they are in the source (Priority: P1)

After a compile, every error and warning with a place in a project file appears in the editor on its line: a marker in the gutter, an underline under the command or key it is about (the whole line when it can't tell), and a tooltip on hover with the message and the hint. The markers stay attached to their text as the writer (or a collaborator) edits, until the next compile replaces them; a compile that no longer reports the problem removes its marker.

**Why this priority**: Seeing the problem in the source saves the trip through the log, and the underline shows exactly which token is wrong.

**Independent Test**: Compile the graphicx document from US1; line with `\includegraphics` shows an error marker and an underline under `\includegraphics`; hovering it shows the message and the graphicx hint.

**Acceptance Scenarios**:

1. **Given** a compile with an error on line N of a project file, **When** the file is open, **Then** line N has an error marker in the gutter and the command the error is about is underlined; hovering it shows the message, the explanation and the fix.
2. **Given** an entry in the logs panel with a file and line, **When** the writer clicks it, **Then** the file opens with the cursor on that line (as before).
3. **Given** compile markers, **When** the writer adds lines above them, **Then** each marker moves with its text.
4. **Given** compile markers, **When** the writer fixes the problem and compiles again, **Then** the markers of the fixed problems are gone from the text and the gutter.
5. **Given** two collaborators, one with compile markers, **When** the other inserts lines above a marked line, **Then** the first one's marker moves with its text.

---

### User Story 3 - Catch structural slips while typing (Priority: P2)

While the writer types, an instant code check marks structural mistakes without a compile: a `\begin{itemize}` closed by `\end{enumerate}`, an `\end` with no `\begin`, a `\begin` never closed, a `{` never closed or a `}` with no `{`, and inline math `$` (also `$$`, `\(`, `\[`) left open. The check runs a moment after typing stops. It is on by default and can be switched off in the editor settings, per device.

**Why this priority**: The cheapest errors to fix are the ones caught before compiling; but it's an addition on top of the compile feedback.

**Independent Test**: Type `\begin{itemize} … \end{enumerate}`; both lines are marked before any compile; change `enumerate` to `itemize` and the markers go away.

**Acceptance Scenarios**:

1. **Given** a document with `\begin{itemize}` closed by `\end{enumerate}`, **When** the writer stops typing, **Then** both are underlined as errors with a message naming the other end and its line, without any compile.
2. **Given** that mismatch, **When** the writer changes `\end{enumerate}` to `\end{itemize}`, **Then** the markers disappear, again without a compile.
3. **Given** the code check switched off in the editor settings, **When** the document has such a mistake, **Then** no code-check marker is shown, also after a reload; switching it on shows them again.
4. **Given** escaped characters (`\{`, `\$`, `\%`), comments, `\verb` and verbatim-like environments, or `\begin`/`\end`/`$` inside a `\newcommand`/`\def`/`\newenvironment` definition, **When** checked, **Then** they don't produce markers.

---

### User Story 4 - Optional style checks with ChkTeX (Priority: P3)

A project can turn on "Check with ChkTeX" in the compile options. Each compile then also runs ChkTeX on the document (following its `\input`s) and lists its warnings in the logs panel under their own ChkTeX filter and as warning markers at their exact column. It's off by default. If the TeX image has no ChkTeX, the option says so and can't be turned on.

**Why this priority**: Useful polish for experienced writers (quotes, dashes, spacing), noisy for others; hence opt-in.

**Independent Test**: Turn the option on, compile a line with `"hi"`; the logs panel's ChkTeX filter lists warning 18 for that line and the quote is underlined.

**Acceptance Scenarios**:

1. **Given** a project, **When** the compile options open, **Then** "Check with ChkTeX" is unchecked; an editor can check it and it stays checked after a reload (it's the project's setting, shared by all collaborators).
2. **Given** the option on, **When** the document compiles, **Then** ChkTeX's warnings appear under a ChkTeX filter in the logs panel (with their number) and as warning markers on the exact characters.
3. **Given** a TeX image without ChkTeX, **When** the compile options open, **Then** the option says "ChkTeX isn’t in this TeX image" and can't be turned on.

### Edge Cases

- An entry in a file that isn't a project text file (a package's `.sty`) gets a hint in the logs but no editor marker.
- A file opened after the compile gets its markers once it has loaded.
- An entry whose line is past the end of the document (the text got shorter) is marked on the last line.
- TeX reports a missing package one line late (at the line after `\usepackage`): the marker looks back up to two lines for the package name.
- A missing `\input` file in nonstop mode ends with an emergency stop at the `\input` line: the "not found" error is placed there, and the emergency stop's own hint says to fix the error before it.
- Readers see markers and hints too; only editors can change the ChkTeX option.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Log entries for the errors and warnings listed in US1 MUST carry a plain-language explanation and a suggested fix, from one table of rules.
- **FR-002**: Undefined-command hints MUST name the command and, for well-known commands, the package that defines it; for unknown ones suggest a close known command when there is one.
- **FR-003**: File-not-found hints MUST distinguish packages/classes (typo of a known name, file elsewhere in the project, or missing from the image with a pointer to the full image) from project files (closest existing path).
- **FR-004**: Reference and citation hints MUST name the key.
- **FR-005**: The logs panel MUST show hints under their entries (errors expanded, others collapsed) and offer per-level filters.
- **FR-006**: After a compile, entries with a project text file and line MUST appear in the editor as gutter marker, underline and hover tooltip with message and hint.
- **FR-007**: Compile markers MUST move with local and remote edits and be replaced by the next compile's.
- **FR-008**: The code check MUST run in the browser, debounced, and mark unmatched/mismatched environments, unbalanced braces and unclosed math.
- **FR-009**: The code check MUST be on by default and switchable per device in the editor settings.
- **FR-010**: ChkTeX MUST be a per-project compile option, off by default, run only inside the compile job's sandbox, and disabled with an explanation when the image lacks it.

### Key Entities

- **Hint**: explanation, optional fix, optional token (the text the marker underlines).
- **Log entry**: gains a hint, the `l.<n>` context TeX printed, and for ChkTeX a column and length; a new level "chktex".
- **Compile settings**: gain "run ChkTeX" per project.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Each error fixture in the hint test set (real logs from the TeX image) gets a hint.
- **SC-002**: Code-check markers appear within about half a second after typing stops.
- **SC-003**: Turning on ChkTeX adds no noticeable time to a small document's compile (it runs in milliseconds inside the same job).

## Assumptions

- Hints are in English, like the rest of the UI.
- "Per-user" for the code check toggle means per device, like the other editor settings (font size, spelling).
- Jumping from a logs entry goes to the line the compile reported; markers in the editor show where that text is now.
