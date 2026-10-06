# Contract: realtime document channel

- **Endpoint**: `ws(s)://<host>/collab` on the app's HTTP port. Other upgrade paths are not handled.
- **Protocol**: Hocuspocus 4 (Yjs sync + awareness). Client: `new HocuspocusProvider({ url, name: 'main.tex' })` (`url` derived from `location`).
- **Document name**: `main.tex`. Other names are rejected in `onConnect` (single-file project).
- **Shared type**: `Y.Text` at key `content`.
- **Auth**: none (feature 005). Exposure is limited by the loopback port binding.
- **Persistence**: every update is appended to `updates` as it arrives; snapshots to `documents` with debounce 500 ms, max 2000 ms, plus on last disconnect, compacting the log (see data-model.md, research R2).
- **Seed** (inserted server-side when no stored state exists):

```latex
\documentclass{article}
\usepackage{graphicx} % Required for inserting images

\title{Untitled project}
\author{}
\date{\today}

\begin{document}

\maketitle

\section{Introduction}

\end{document}
```
