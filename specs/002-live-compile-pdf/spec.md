# Feature Specification: Live compilation & PDF preview

**Feature Branch**: `002-live-compile-pdf`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "Recompile button with dropdown (auto-compile on/off, compiler: pdfLaTeX / XeLaTeX / LuaLaTeX, stop on first error). Compilation runs `latexmk` inside a TeX Live container per job, with no network, no shell-escape, and time/memory limits. Auto-compile triggers a few seconds after typing stops. PDF pane renders with pdf.js: page navigation, zoom in/out/fit, dark-mode toggle for the page, download PDF. Logs panel lists errors and warnings parsed from the `.log`, each clickable to jump to file and line, with an error badge on the Recompile button. Last good PDF stays visible while a new compile runs or fails."

Reference layout: [`reference-layout.png`](./reference-layout.png) (Recompile button, logs and download icons top-left of the PDF pane; page-dark toggle, page navigation and zoom top-right).

## Clarifications

### Session 2026-10-06

- Q: Where are the compile options stored? → A: The compiler is saved with the project on the server; auto-compile and stop-on-first-error are saved per browser.
- Q: If a compile has errors but still produces a PDF, which PDF is shown? → A: The new PDF, with its errors listed; the previous PDF is kept only when no PDF was produced.
- Q: Auto-compile idle delay and default? → A: 2 seconds after typing stops; auto-compile is off by default.
- Q: Default per-job limits? → A: 20 s wall clock, 512 MB memory, 1 CPU; operators can change them through configuration.
- Q: Which TeX installation do compiles use? → A: The medium TeX Live scheme (smaller download, covers common documents; the full scheme can follow in feature 011).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Compile and see the PDF (Priority: P1)

The author clicks Recompile above the PDF pane. The button shows that a compile is running, and a few seconds later the PDF of `main.tex` appears in the pane, rendered page by page. The PDF reflects the text as it was when the compile started.

**Why this priority**: Seeing the typeset result is the reason to use a LaTeX editor. Every other part of this feature refines this loop.

**Independent Test**: Open the app with the starter document, click Recompile, confirm the PDF shows the document's title and sections.

**Acceptance Scenarios**:

1. **Given** the starter document, **When** the user clicks Recompile, **Then** the button shows a compiling state and the rendered PDF appears in the pane within 5 seconds.
2. **Given** a compile is running, **When** the user looks at the Recompile button, **Then** it is disabled and labelled as compiling until the compile ends.
3. **Given** a PDF is shown, **When** the user edits the text and recompiles, **Then** the pane shows the new PDF.
4. **Given** a PDF was compiled earlier, **When** the user reloads the page, **Then** the last PDF is shown again without recompiling.
5. **Given** a document that tries to run a shell command, read files outside the project, or reach the network, **When** it is compiled, **Then** the attempt fails and nothing outside the compile job is affected.
6. **Given** a document that loops forever or exhausts memory, **When** it is compiled, **Then** the compile is stopped at the time or memory limit and the user sees a "compile timed out" or "out of memory" message.

---

### User Story 2 - Errors and warnings (Priority: P1)

When a compile reports problems, the Recompile button carries a badge with the error count. The author opens the logs panel and sees a list of errors and warnings, each with its message, file and line. Clicking an entry moves the editor cursor to that line. The raw log is also available for anything the list misses. If the compile fails, the previous good PDF stays visible.

**Why this priority**: LaTeX errors are frequent. Without readable errors and a jump to the line, a failed compile is a dead end.

**Independent Test**: Introduce an undefined command, recompile, confirm the badge, the error entry with the right line, and that clicking it puts the cursor on that line.

**Acceptance Scenarios**:

1. **Given** a document with an undefined control sequence on line 12, **When** it is compiled, **Then** the Recompile button shows an error badge with count 1 and the logs panel lists an error naming the command and line 12.
2. **Given** the logs panel lists an entry with a line, **When** the user clicks it, **Then** the editor scrolls to that line, places the cursor there and takes focus.
3. **Given** a compile produces warnings only (e.g. an undefined reference, an overfull box), **When** the user opens the logs panel, **Then** warnings are listed separately from errors and the badge does not show an error count.
4. **Given** a good PDF is shown, **When** the next compile fails without producing a PDF, **Then** the previous PDF stays visible and the user is told the compile failed.
5. **Given** a good PDF is shown, **When** a new compile is running, **Then** the previous PDF stays visible until the new one is ready.
6. **Given** any compile finished, **When** the user opens the raw log view, **Then** the full log text is shown.
7. **Given** an error is fixed and the document recompiled, **When** the compile succeeds, **Then** the badge disappears and the entry is gone from the list.

---

### User Story 3 - Auto-compile and compile options (Priority: P2)

The dropdown next to Recompile holds the compile options: auto-compile on/off, the compiler (pdfLaTeX, XeLaTeX, LuaLaTeX) and "stop on first error". With auto-compile on, a compile starts by itself a short time after the author stops typing.

**Why this priority**: Auto-compile makes the preview feel live, and some documents need XeLaTeX or LuaLaTeX for fonts. Both build on the manual compile from US1.

**Independent Test**: Turn auto-compile on, type, wait, confirm a compile ran without clicking. Switch to XeLaTeX, compile a document that needs it, confirm success.

**Acceptance Scenarios**:

1. **Given** auto-compile is on, **When** the user stops typing, **Then** a compile starts 2 seconds later without a click.
2. **Given** auto-compile is on, **When** the user keeps typing without a 2-second pause, **Then** no compile starts until they pause.
3. **Given** auto-compile is off, **When** the user types and pauses, **Then** no compile starts.
4. **Given** a compile is running, **When** more edits arrive (typed or triggered by auto-compile), **Then** one more compile runs after the current one finishes, so the PDF ends up matching the latest text.
5. **Given** the compiler is set to XeLaTeX, **When** a document using system fonts is compiled, **Then** it compiles with XeLaTeX; the same works for LuaLaTeX and pdfLaTeX.
6. **Given** "stop on first error" is on, **When** a document with several errors is compiled, **Then** the compile stops at the first error and the logs list that error.
7. **Given** the user changed any option, **When** they reload the page, **Then** the options are as they left them.
8. **Given** the editor is focused, **When** the user presses Ctrl/Cmd+Enter or Ctrl/Cmd+S, **Then** a compile starts.

---

### User Story 4 - Read the PDF (Priority: P2)

Above the PDF the author has a toolbar: previous/next page, a page number field with the page count, zoom out, zoom in, a zoom menu (fit width, fit page, fixed percentages), a toggle that renders pages in dark colors, and a download button that saves the PDF.

**Why this priority**: Reading a multi-page result needs navigation and zoom; dark pages matter in a dark editor at night; download is how the PDF leaves the app.

**Independent Test**: Compile a three-page document, step through pages, type a page number, zoom in/out/fit, toggle dark pages, download the file.

**Acceptance Scenarios**:

1. **Given** a three-page PDF, **When** the user clicks next page or types 3 in the page field and presses Enter, **Then** page 3 scrolls into view and the field shows the current page; the field shows "/ 3".
2. **Given** a PDF is shown, **When** the user scrolls the pages, **Then** the page field follows the page in view.
3. **Given** a PDF is shown, **When** the user zooms in or out, **Then** pages are re-rendered sharp at the new size and the zoom percentage updates.
4. **Given** a PDF is shown, **When** the user picks "fit width" or "fit page", **Then** pages fit the pane width or one full page fits the pane, and the fit is kept when the pane is resized.
5. **Given** a PDF is shown, **When** the user toggles dark pages, **Then** pages show light text on a dark background, and the setting survives a reload.
6. **Given** a PDF is shown, **When** the user clicks download, **Then** the browser saves the PDF file named after the project (`main.pdf`).
7. **Given** no PDF exists yet, **When** the pane is shown, **Then** page controls and download are disabled and the pane says how to compile.
8. **Given** the user is on page 2 at 150 % zoom, **When** a new PDF arrives, **Then** the zoom stays and the view stays on page 2 (or the last page if the document got shorter).

### Edge Cases

- A compile is requested while one is running: requests merge into one follow-up compile, never more than one queued.
- The compile produces a PDF but also errors (LaTeX continued past them): the new PDF is shown and the errors are listed.
- The document has no `\begin{document}` or is empty: the compile fails and the log explains why; the previous PDF stays.
- An error message without a line number: it is listed without a jump target (not clickable); the raw log is one click away.
- A log entry refers to a line beyond the end of the current text (text changed since the compile): the cursor goes to the last line.
- A log entry refers to a file other than `main.tex` (a package or class file): it is listed but not clickable.
- The compile environment is unavailable (container runtime stopped, image missing): the user sees "compiler unavailable" with the reason, not an endless spinner.
- A very large PDF (100+ pages): only pages near the view are rendered so scrolling stays smooth.
- Two browser tabs open on the same project: each tab can compile; a tab shows the PDF of its own latest compile.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The PDF pane MUST show a Recompile button with a dropdown toggle, placed at the top of the PDF pane as in the reference layout.
- **FR-002**: Clicking Recompile MUST compile the current text of `main.tex` and show the resulting PDF in the pane.
- **FR-003**: While a compile runs, the Recompile button MUST show a compiling state and MUST not start a second parallel compile; further requests MUST collapse into at most one follow-up compile.
- **FR-004**: Each compile MUST run isolated from the app and from other compiles: no network access, no shell escape, no access to files outside the job, a read-only TeX installation (medium TeX Live scheme), and default limits of 20 s wall clock, 512 MB memory and 1 CPU, each changeable by the operator. Exceeding a limit MUST end the compile with a message naming the limit.
- **FR-005**: The dropdown MUST offer: auto-compile on/off, compiler choice (pdfLaTeX, XeLaTeX, LuaLaTeX), and stop-on-first-error on/off.
- **FR-006**: With auto-compile on, a compile MUST start 2 seconds after the user has stopped editing; edits during the delay restart it. Auto-compile MUST be off by default.
- **FR-007**: The compiler choice MUST be saved with the project on the server (same for every browser and kept across restarts); auto-compile and stop-on-first-error MUST be saved per browser. All three survive a page reload.
- **FR-008**: Ctrl/Cmd+Enter and Ctrl/Cmd+S in the editor MUST start a compile.
- **FR-009**: The last produced PDF MUST remain visible while a compile runs and after a compile that produced no PDF. A compile that produces a PDF despite errors MUST show that new PDF and list the errors.
- **FR-010**: The last PDF MUST be shown again after a page reload or app restart without recompiling.
- **FR-011**: After each compile the system MUST list errors and warnings parsed from the compile log, each with type, message, and file and line when known.
- **FR-012**: Clicking a log entry with a line in `main.tex` MUST move the editor cursor to that line, scroll it into view and focus the editor.
- **FR-013**: The Recompile button MUST show a badge with the number of errors from the latest compile when that number is above zero.
- **FR-014**: The logs panel MUST offer the full raw log of the latest compile.
- **FR-015**: The logs panel MUST open from a logs button next to Recompile and close again, returning to the PDF view.
- **FR-016**: The PDF toolbar MUST provide previous/next page, a page number input showing current page and total, zoom in, zoom out, fit width, fit page, and the current zoom percentage.
- **FR-017**: The PDF toolbar MUST provide a toggle that shows pages in dark colors; the setting MUST persist across reloads.
- **FR-018**: The PDF toolbar MUST provide a download button that saves the current PDF.
- **FR-019**: A new PDF MUST keep the current zoom and page position (clamped to the new page count).
- **FR-020**: If the compile environment cannot start, the user MUST see an error message naming the cause within the compile time limit.
- **FR-021**: All new controls MUST be keyboard reachable with visible focus and accessible names; the dropdown MUST behave as a menu (arrow keys, Escape closes).

### Key Entities

- **Compile job**: one run of the compiler for the project. Has compiler, stop-on-first-error flag, start/end time, status (running, success, failure, timed out, out of memory, unavailable), the PDF (if any) and the log.
- **Compile output**: the latest PDF and its log, kept per project so a reload shows them.
- **Log entry**: type (error, warning, typesetting warning such as bad boxes), message, file, line (optional), raw excerpt.
- **Compile settings**: compiler (per project, on the server); auto-compile flag and stop-on-first-error (per browser).
- **Viewer settings**: zoom mode/level, dark pages flag.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A recompile of the starter document (≤ 10 pages) shows the new PDF within 5 seconds of the click on the reference machine.
- **SC-002**: With auto-compile on, the PDF updates within 7 seconds (2 s delay plus 5 s compile) after the user stops typing.
- **SC-003**: For a set of 10 common error cases (undefined command, missing `}`, missing `$`, undefined environment, missing package, missing file, runaway argument, undefined reference, citation undefined, overfull box), the logs list the correct type and, where the log has one, the correct line in at least 9 of 10.
- **SC-004**: A compile that loops forever is stopped within the time limit plus 2 seconds, and the app stays responsive to other users and tabs throughout.
- **SC-005**: None of the escape attempts (shell escape, network fetch, reading `/etc/passwd` or the app's data directory, writing outside the job) succeed in an automated test.
- **SC-006**: Page navigation, zoom changes and the dark-page toggle respond within 200 ms on a 20-page document.
- **SC-007**: The previously shown PDF is never replaced by a blank pane during a compile or after a failed compile.

## Assumptions

- One project with one file (`main.tex`), as built in feature 001. Multi-file projects (feature 003) will extend the compile input; log entries for other files are listed but not clickable until then.
- The compile reads the server's current document text, which is the same text the editor shows (the editor syncs live).
- The default compiler is pdfLaTeX, auto-compile is off on first use, stop-on-first-error is off.
- Packages outside the medium TeX Live scheme fail with a "file not found" error in the logs; the full scheme is a later operator choice (feature 011).
- The download file name is `main.pdf`; a project title arrives in feature 005.
- Compile output is not shared between browser tabs live; feature 006 adds "a compile started by anyone updates everyone's PDF".
- Jumping between PDF and source (SyncTeX), remembered scroll across sessions and layout modes belong to feature 009; this feature still turns SyncTeX output on so 009 needs no compile change.
- Compile rate limits and a global concurrency cap belong to feature 011; this feature allows one compile at a time per project.
- Time limit, memory limit and idle delay have working defaults and can be changed by the operator through configuration.
