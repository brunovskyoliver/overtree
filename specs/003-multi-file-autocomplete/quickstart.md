# Quickstart: validating feature 003

## Prerequisites
- Same as 002: Node 24, pnpm, Docker (OrbStack) with `texlive/texlive:latest-medium` pulled.
- `pnpm install` (adds `fflate`).

## Automated
```sh
pnpm check            # svelte-check, strict TS
pnpm test             # Vitest: files, zip, multi-file compile and the three SC-002 sample projects (real Docker), scan, completion
pnpm test:e2e         # Playwright, Chromium + Firefox + WebKit
scripts/compose-smoke.sh   # production image: compile, zip export, symbols route, restart
```

## Manual walk-through (`pnpm dev`, open http://localhost:5173)
1. **Upgrade keeps data**: start on a data dir from 002. The tree shows `main.tex` marked as main, with the old text.
2. **Tree**: New folder `chapters`; inside it, New file `intro.tex`; it opens in a new tab. Rename it to `introduction.tex` (F2). Drag it to the root and back. Reload: same tree, same tabs.
3. **Upload**: drag a PNG from Finder onto a new `figures` folder. Upload the same file again: `Replace existing file "<name>"?` appears.
4. **Compile**: in `main.tex` add `\input{chapters/introduction}`, `\includegraphics[width=5cm]{figures/<name>}`, a `refs.bib` with one entry, `\cite{…}` and `\bibliographystyle{plain}\bibliography{refs}`. Recompile: the PDF shows the chapter text, the image and the bibliography. Put an error in `introduction.tex`, recompile, click the log entry: that file opens at the line.
5. **Main document**: create `other.tex` with a full document, choose "Set as main document" from its menu, recompile: that document compiles; the download is named `other.pdf`.
6. **Zip**: Download project as zip. New project from zip with the same file → confirm (Replace project) → same tree and content.
7. **Completion**: in `main.tex` type `\sec` → popup with `\section{}` `cmd`; Enter, type a title. Type `\beg`, accept `\begin{}` (`env`) and type `itemize`: `\end{itemize}` follows while typing. Typing `\begin{ite` instead lists environment names; picking `itemize` there inserts only the name. Type `\begin{enumerate}` + Enter → `\end{enumerate}` appears. Type `\ref{` → labels; `\cite{` → bib keys with titles; `\includegraphics{` → image paths (without extension); `\usepackage{ams` → `amsmath`, `amssymb`.

## Known limits
- Folders dropped from the operating system are not uploaded (files only). Use a zip import for folder structures.
- Tree changes don't appear live in other browser tabs until reload (feature 006).
