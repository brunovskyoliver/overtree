# Feature 012: GitHub repository sync
Stage: implement
Updated: 2026-10-07

## Decisions
- Feature numbered 012: 009 is a merged roadmap marker and 010/011 are reserved for planned roadmap rows.
- Branch `012-github-sync` created from main (b8b8098).

- Gate 1 (user: A,C,B,A): push on session end + every 30 min in long sessions + Push now; TWO-WAY sync (GitHub edits merged into live Yjs docs); Co-authored-by trailers with emails; preview+confirm on first link, import into empty project.
- Direction change from 2:C: spec reworked (new US3 pull, FR-016–021, "not pulled" patterns for workflow PDFs).
- Gate 2: user replied "gk", read as `go` (full implementation). Real-GitHub smoke test skipped (no App provided); compile e2e depends on OrbStack running.
- Applied H1 (pending_push), H2 (first-sync base in T020), M1 (filter both sides), M2 (repo id lookup). L1/L2 left as noted.

## Log
- 2026-10-07 specify: spec.md (4 stories, 21 FRs) + checklists/requirements.md (all pass).
- 2026-10-07 clarify: 4 answers encoded; spec rewritten for two-way sync (5 stories, 27 FRs).
- 2026-10-07 plan: plan.md, research.md (R1–R13), data-model.md, contracts/http-api.md + ui.md, quickstart.md. GitHub App + installation tokens, Git Data API push, diff3 pull into Yjs, fake GitHub for tests.
- 2026-10-07 tasks: tasks.md 52 tasks / 8 phases (MVP = 1–5).
- 2026-10-07 analyze: 0 critical, 2 high, 2 medium, 2 low; checklist 16/16; waiting at gate 2.

## Report
