# Contract: workspace UI

## Toolbar insertions (`src/lib/editor/commands.ts`)
`|` = cursor after the command; `[sel]` = the previous selection, which stays selected when present.

| Button | With selection `sel` | Without selection |
|--------|----------------------|-------------------|
| Bold | `\textbf{[sel]}` | `\textbf{|}` |
| Italic | `\textit{[sel]}` | `\textit{|}` |
| Section | `\section{[sel]}` | `\section{|}` |
| Link | `\href{|}{sel}` | `\href{|}{}` |
| Figure | (inserted on its own lines; selection replaced) see below | same |
| Table | see below | same |

Figure (cursor selects `example-image`):
```latex
\begin{figure}[h]
    \centering
    \includegraphics[width=0.5\linewidth]{example-image}
    \caption{Caption}
    \label{fig:label}
\end{figure}
```
Table (cursor selects the first `A`):
```latex
\begin{table}[h]
    \centering
    \begin{tabular}{|c|c|}
        \hline
        A & B \\
        \hline
        C & D \\
        \hline
    \end{tabular}
    \caption{Caption}
    \label{tab:label}
\end{table}
```
If the cursor line isn't empty, the block starts on a new line. Each insertion is a single undo step.

## Outline rules (`src/lib/outline.ts`)
- Matches `\section`, `\subsection`, `\subsubsection`, optional `*`, optional `[short]`; title = long `{...}` argument with balanced braces, inner commands reduced to their text, whitespace collapsed.
- Text after an unescaped `%` is ignored.
- Click → cursor at start of heading line, `scrollIntoView` centered, editor focused.
- Highlight: entry with the greatest line ≤ cursor line.
- Empty state text: "No sections yet".

## Layout
- Outer group: sidebar (default 20%, min 12%) | editor (min 25%) | pdf (default 40%, min 15%); sidebar and pdf collapsible.
- Inner group: file tree (default 50%, min 15%) / outline (min 15%).
- Handles: `role="separator"` (paneforge) plus a collapse/expand `<button>` with `aria-label` "Collapse sidebar" / "Expand sidebar" / "Collapse PDF" / "Expand PDF" and `aria-expanded`.
- Persistence keys: see data-model.md.

## Accessibility and test hooks
- File tree: `role="tree"`, `main.tex` item `role="treeitem" aria-selected="true"`.
- Outline: `<nav aria-label="File outline">` with a list of buttons; current entry `aria-current="location"`.
- Toolbar: `role="toolbar" aria-label="Formatting"`, every button has `aria-label` and `title`.
- Sync badge: `role="status"`, text "Saved" | "Connecting…" | "Offline".
- PDF empty state: "No PDF yet. Compiling arrives in a later version."
