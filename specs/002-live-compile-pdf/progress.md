# Feature 002: Live compilation & PDF preview
Stage: implement
Updated: 2026-10-06T00:00:00+02:00

## Decisions
- Branch `002-live-compile-pdf` created from `001-editor-workspace-shell` (001 not merged to main yet).
- Reference screenshot copied to `reference-layout.png`.

- Gate 1: user answered 1 A, 2 A, 3 A, 4 B (20 s / 512 MB / 1 CPU), 5 "most efficient and fastest" -> medium TeX Live scheme (B).
- Compile containers are spawned via the Docker socket mounted into the app container (stated at gate 1, no objection).
- Gate 2: user replied `go`. Applied M1 (e2e data dir + clearCompileOutput), M2 (no-line entries not clickable), M3 (SC-004 responsiveness check in T014), M4 (non-main.tex entry test in T020), L1 (removed aux-file edge case). Untested LOW edge cases (two tabs, 100+ pages, app restart) noted for the report.

## Log
- 2026-10-06 specify: spec.md (4 stories: compile+PDF P1, errors/logs P1, auto-compile+options P2, PDF viewer P2) + checklists/requirements.md, 16/16 pass.
- 2026-10-06 clarify: 5 answers encoded (Clarifications, FR-004/006/007/009, US3 scenarios, SC-002, assumptions).
- 2026-10-06 plan: spike verified sandbox flags (pdfLaTeX 0.70 s, XeLaTeX 1.48 s, LuaLaTeX 0.93 s; write18 blocked, no network, timeout kill and OOM → 137). plan.md, research.md (R1-R12), data-model.md, contracts/{compile-api,ui}.md, quickstart.md. Image texlive/texlive:latest-medium pulled. New dep: pdfjs-dist 6.4.
- 2026-10-06 tasks: tasks.md, 34 tasks in 7 phases (MVP = phases 1-3).
- 2026-10-06 analyze: 0 CRITICAL, 0 HIGH, 4 MEDIUM, 4 LOW. Checklist requirements.md 16/16.
- 2026-10-06 remediation: spec/tasks updated; analyze rerun: 0 CRITICAL, 0 HIGH.

## Report
