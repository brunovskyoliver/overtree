# Feature 005: Accounts, roles, sharing & live collaboration
Stage: implement
Updated: 2026-10-06T23:50:00+02:00

## Decisions
- Branch `005-accounts-sharing-collab` created from `003-multi-file-autocomplete` (not merged to main).
- Screenshot copied to `reference-layout.png`.
- Gate 1: user answered A,A,A,A,B: Clerk dev instance, keys in keychain (`overtree/clerk-publishable-key`, `overtree/clerk-secret-key`, both present), test bypass + @clerk/testing smoke set; invite-only default; link needs sign-in; overrides raise or lower; admins cannot open others' projects.
- Orchestrator's uncommitted ROADMAP.md and constitution edits go into the first commit.
- Gate 2: `go mvp` → fix M1-M3 + lows, implement phases 1-6 only (stop before per-file permissions and live presence).

## Log
- 2026-10-06 specify: spec.md (6 stories: sign-in P1, dashboard P1, sharing P1, live collab P1, admin P2, per-file permissions P3), checklists/requirements.md 16/16.

- 2026-10-06 clarify: 5 answers encoded (Clarifications, FR-007/013/014/034/040, US5 scenarios 5/7, US6 scenario 7).
- 2026-10-06 plan: plan.md, research.md (R1-R14), data-model.md, contracts/{http-api,ui}.md, quickstart.md. Chose @clerk/clerk-js + @clerk/ui + @clerk/backend (svelte-clerk 1.2 peers Kit ^2, repo is Kit 3). WS auth via Hocuspocus onAuthenticate token; readOnly via connectionConfig.
- 2026-10-06 tasks: tasks.md, 57 tasks in 9 phases, phases in requested order (sign-in, admin, dashboard, sharing, per-file, live); MVP = phases 1-6.
- 2026-10-06 analyze: 0 CRITICAL, 0 HIGH, 3 MEDIUM (M1 sign-out in other tabs, M2 link vs named membership model, M3 authorizedParties from Host), 3 LOW. Checklist requirements.md 16/16. All 40 FRs mapped to tasks.
- 2026-10-06 remediation: M1 (cross-tab sign-out in T013), M2 (memberships: nullable `role` + `viaLink`, data-model/R10/T004/T019/T035), M3 (authorizedParties from ORIGIN, T007), lows (T038 owns `deleted`, README note in T054).

## Report
