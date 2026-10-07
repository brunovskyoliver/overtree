# Feature 008: Project history, restore, SyncTeX & PDF navigation
Stage: implement
Updated: 2026-10-07T00:00:00Z

## Decisions
- Branch `008-history-synctex` created from HEAD of `005-accounts-sharing-collab` (2309f8e), per user.
- Feature dir numbered 008 to match the roadmap row, not the next free number (006).

- Gate 1 (user: B,A,B,B = all recommendations): versions close after 5 min idle / max 30 min; whole-project restore skips read-only files and lists them; diff vs current with toggle for vs previous; labels renamed/deleted only by author or owner.

- Gate 2: user said `go` (full implementation). Fixed M1 (spec diff granularity), M2 (authors only from log rows), M3 (tests for US3 #3/#6, US7 #4), L1 (duplicate starts fresh history).

## Log
- 2026-10-07 specify: spec.md + checklists/requirements.md written; 2 clarification markers left for gate 1.

- 2026-10-07 clarify: 4 answers encoded into spec.md Clarifications + FR-001/007/014/019, US1/US2/US5.
- 2026-10-07 plan: plan.md, research.md (R1–R14), data-model.md, contracts/http-api.md, contracts/ui.md, quickstart.md.
- 2026-10-07 tasks: tasks.md 50 tasks / 10 phases.
- 2026-10-07 analyze: 0 critical, 0 high, 3 medium, 2 low; fixed after go.

## Report
