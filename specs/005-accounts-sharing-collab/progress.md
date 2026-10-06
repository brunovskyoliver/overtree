# Feature 005: Accounts, roles, sharing & live collaboration
Stage: implement
Updated: 2026-10-06T22:20:00+02:00

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
- 2026-10-06 implement phase 1 (T001-T003): Clerk deps, env vars in src/env.ts + compose.yaml, startup guard (server.ts, Vite plugin), src/lib/presence.ts + test.
- 2026-10-06 implement phase 2 (T004-T015): migration 0003 (hand-written files rebuild + data steps incl. 001/002 legacy main.tex), project-scoped files/zip/compile, auth.ts (Clerk + test bypass + mirrorUser), access.ts (roles, guards, kick, broadcast), Hocuspocus onAuthenticate, hooks.server.ts, routes under /api/projects/[pid], editor at /project/[id], auth.svelte.ts, e2e fixture (signed in, fresh project per test), access + migration unit tests.
  Deviations: requireProject throws FileError (routes wrap in api()) so access.ts stays loadable unbundled without @sveltejs/kit; kick closes the whole socket (Hocuspocus' per-document close doesn't make the provider re-authenticate); minimal GET/POST /api/projects and GET /api/projects/:pid added now (tests and the temporary / redirect need them; US2 extends); zip download named after the project title; 'New project from zip' e2e tests removed (moves to the dashboard, US2); scripts/compose-smoke.sh + collab-client.ts not yet updated for auth.
- 2026-10-06 implement phase 3 (T016-T022): /sign-in (Clerk widget, dark appearance, test-only form), /blocked, TopBar + Avatar with account menu, /share/[token] + joinByLink, auth unit tests, auth.spec e2e, clerk smoke project (2/2 against the dev instance). Deviations: Clerk dev handshake result (Location + Set-Cookie) now applied in hooks; signOut closes providers first (onSignOut) and suppresses watchSession; smoke test patches captcha_bypass on FAPI error responses itself (@clerk/testing misses meta.client on the sign-in-or-up 422); e2e web server waits on /sign-in again.
- 2026-10-06 implement phase 4 (T023-T027): admin API (users, settings, projects) + `requireAdmin`, `deleteProject` behind `DELETE /api/projects/:pid` (owner or admin), /admin page (Users/Projects/Settings tabs, last-admin lock with tooltip, ConfirmDialog delete), disabled-user redirect (`blockedBy`/`checkBlocked` in auth.svelte.ts, used by project.svelte.ts and Editor), admin unit tests, admin.spec e2e (US5 1-8); auth.spec sets the allowlist through the admin API now (link token still via SQLite until US3). Deviations: admin logic in src/lib/server/admin.ts (routes stay thin, unbundled-safe); `src/lib/time.ts` relative-time helper added (US2 dashboard reuses it); deleteProject builds the compile dir path itself instead of importing compile.ts; e2e first-user-admin left to the unit tests (fixture signs in as ADMIN_EMAILS user).
- 2026-10-06 implement phase 5 (T028-T034): templates.ts (blank/article/report/beamer/letter, title LaTeX-escaped, all compile clean with pdfLaTeX), POST /api/projects with template, /import, PATCH title, /duplicate, /leave (renameProject/duplicateProject/leaveProject in projects.ts), dashboard page + ProjectActions row menu, editable top-bar title (`project` prop on TopBar, Project.renameProject), no-access page, projects unit tests (10), dashboard.spec e2e (9). Deviations: report template drops hyperref (duplicate page.1 anchor warning with the title page); Upload zip opens the file chooser directly (no title dialog, title = zip name); Leave also asks for confirmation; duplicate reads text through Hocuspocus so unsaved edits are copied; the full unit run still hits sandbox `oom` in compile/log-parser tests (pass alone).

## Report
