# Feature 005: Accounts, roles, sharing & live collaboration
Stage: implement (phase 8)
Updated: 2026-10-06

## Decisions
- Branch `005-accounts-sharing-collab` created from `003-multi-file-autocomplete` (not merged to main).
- Screenshot copied to `reference-layout.png`.
- Gate 1: user answered A,A,A,A,B: Clerk dev instance, keys in keychain (`overtree/clerk-publishable-key`, `overtree/clerk-secret-key`, both present), test bypass + @clerk/testing smoke set; invite-only default; link needs sign-in; overrides raise or lower; admins cannot open others' projects.
- Orchestrator's uncommitted ROADMAP.md and constitution edits go into the first commit.
- Gate 2: `go mvp` → fix M1-M3 + lows, implement phases 1-6 only (stop before per-file permissions and live presence).
- 2026-10-06 user: "continue with the phases" → implementing phases 7-9.

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
- 2026-10-06 verify phase 5: full `pnpm test` had 11 'oom' failures. Cause: compile.ts startup sweep `docker rm -f` killed running containers of other test files (exit 137). Fix: sweep only stopped containers; timeout test checks its own named container. 159/159 twice.
- 2026-10-06 implement phase 6 (T035-T040): sharing service in projects.ts (listMembers/inviteMember/setMemberRole/removeMember/withdrawInvite/setLink/transferOwnership) + routes members, members/[userId], invites/[email], link, transfer; ShareDialog (green Share in TopBar); reader mode (CodeMirror readOnly compartment, toolbar/tree/compiler menu disabled, banner); session.svelte.ts (shared HocuspocusProviderWebsocket, `project:<pid>` events, "Your access was removed"/"This project was deleted", read-only reconnect with unsaved edits rebuilds the tab); sharing unit tests (11) and sharing.spec e2e (6); auth/dashboard specs use the link/members API instead of SQLite. Deviations: compile sweep also skips `created` containers (they are other processes' jobs about to start; removing them gave the remaining 'oom' failures), ConfirmDialog ids made unique, invite role changes reuse POST members, joinByLink broadcasts `access`, sync.spec disconnects the shared socket, "Reset link" asks for confirmation, overrides not shown in the Share dialog yet (US6). pnpm test 170/170 x3, e2e 129/129 per browser.
- 2026-10-06 implement phase 7 (T041-T045): `setOverride` in projects.ts + PUT /api/projects/:pid/overrides (owner only, named collaborators only, file must be in the project, kicks the user and broadcasts `access`); PermissionsDialog from a "Permissions…" tree menu item (owner, once someone is invited); Share dialog lists each member's overrides ("File permissions (n)") with remove buttons; FileTree locks (`aria-label="Read only"`) and per-entry gating (create/upload need edit on the target folder, rename/move/delete on the entry and all descendants, drops only into editable folders); overrides unit tests (6), permissions.spec e2e (2). Deviations: fileRole resolution, `canEdit` per entry in GET files, override cleanup in deleteEntry and the Editor's per-file read-only compartment already existed from phases 2/6; link-only users are excluded at PUT (422), not in fileRoles (they can never hold one); a move kicks every user with overrides in the project so open connections re-authenticate with the new folder's role (ponytail); Project gains `members`/`loadMembers`/`setOverride` (owner only) and exports the `Members` type ShareDialog now uses; unit `hit`/`ev`/`json` moved from sharing.test.ts to tests/unit/helpers.ts; scenario 6 (moves) is covered by the unit test, not e2e. pnpm check 0 errors, pnpm test 176/176, e2e permissions+sharing+tree 51/51 on chromium, firefox, webkit.
- 2026-10-06 implement phase 8 (T046-T053): file awareness `user { id, name, color, colorLight }` from `auth.me` (Editor, also for tabs opened before /api/me answers); remote caret label restyled in theme.ts plus a `cursorLabels` view plugin (label shown 2 s after a remote cursor change, then on hover); project-doc presence in session.svelte.ts (`present(me, fileId)` with an `at` stamp, `peers` deduped per user, newest tab wins); TopBar avatars (up to 5, "+N" menu, ring color, title), jump-to-cursor via the file's awareness `cursor.head`; "Offline, reconnecting…" status in TopBar replacing the tab badge; collab-live unit tests (5), presence.spec e2e (6), collab5.spec (Chromium, 5 users × 60 s, ~7,500 markers, latency 3–5 ms). Deviations: T049 already worked from phase 6 except `project` events, which now also refetch files (main-document marker lives there); the session drops the socket on the window `offline` event and reconnects on `online` (a dead socket only times out after 30 s; ponytail: trusts navigator.onLine); the label rule is per line, not per caret (y-codemirror reuses caret DOM, so no CSS animation); sync.spec and sharing.spec expect the new offline text; tree ops in presence.spec go through the API, scenario 7 there checks removal only (sharing.spec covers the rest). SC-003 measured in-page (`performance.timeOrigin + performance.now()` at keydown vs MutationObserver / view update): 1–3 ms caret, no relaxation. pnpm check 0 errors, pnpm test 181/181, e2e presence+collab5+sharing+permissions+tabs+sync 82 passed, 2 skipped (collab5 off Chromium) on chromium, firefox, webkit; tree/dashboard/auth/admin/compile 39/39 on chromium.

## Report

**Scope:** `go mvp`, so Phases 1–6 (T001–T040) are done. Phases 7–9 (T041–T057: per-file permissions, live presence, polish) are not started. Converge was skipped because it would only re-list those phases.

**What changed (commits on `005-accounts-sharing-collab`):**
- 7ecf51b docs: spec, plan, tasks, plus the analyze fixes M1–M3.
- 75fc151 Phase 1 setup: Clerk packages, env vars, startup guard, presence helpers.
- dc3fddd Phase 2 foundational:
  - schema and migration (the 003 project becomes `main` with no owner; the first admin gets it);
  - project-scoped files, compile and routes under `/api/projects/[pid]`;
  - Clerk auth core with a test bypass that refuses to run in production;
  - access guards, WebSocket authentication, read-only connections.
- 3519842 Phase 3 sign-in: `/sign-in` (Clerk widget), `/blocked`, share-link landing page, TopBar, avatar and account menu, Clerk handshake handling, sign-out across tabs.
- 41effc1 Phase 4 admin: `/admin` with users, projects and settings tabs, the last-admin rule, disabling kicks live sessions.
- e23d1aa Phase 5 dashboard: templates (blank, article, report, beamer, letter), zip import, rename, duplicate, delete, leave, search, owner-editable title, no-access page.
- 49e9d4b fix: the compile container sweep on startup killed other processes' running jobs (exit 137, reported as "oom"). It now removes only exited containers.
- 5994611 Phase 6 sharing:
  - members, invites, link and transfer APIs;
  - Share dialog;
  - reader mode in the editor, toolbar and tree;
  - `session.svelte.ts` with live `access`, `tree`, `project` and `deleted` events.

**Verified:**
- `pnpm check`: 0 errors.
- `pnpm test`: 170/170.
- `pnpm test:e2e`: 129/129 on each of Chromium, Firefox and WebKit (sub-agent run). Chromium 129/129 rerun by the orchestrator.
- `clerk` smoke project: 2/2 against the real Clerk dev instance, keys injected by `agent-secret` (Phase 3).

**Left:**
- Phases 7–9:
  - T041–T045 per-file permissions;
  - T046–T053 live cursors, avatars, offline merge, 5-session test;
  - T054–T057 README, route-guard test, full run with Clerk plus a manual walk-through, ROADMAP `done`.
- `scripts/compose-smoke.sh` and `scripts/collab-client.ts` still call the old unauthenticated routes (Phase 2 note).
- Google sign-in has not been tried by hand.
- The "disabled user cut off within 2 s" e2e test runs about 1.9 s on Firefox, close to the limit.
- ROADMAP row 005 is set to `in progress`.
