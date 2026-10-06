# Implementation Plan: Accounts, roles, sharing & live collaboration

**Branch**: `005-accounts-sharing-collab` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-accounts-sharing-collab/spec.md`

## Summary

Add Clerk sign-in with a local user mirror, many projects per instance with owner/editor/reader roles, sharing by invite and link, per-file overrides, an admin page, and live presence. Clerk's browser SDK (`@clerk/clerk-js` + `@clerk/ui`) handles sign-in UI; `@clerk/backend` verifies the session in `hooks.server.ts` for HTTP and in Hocuspocus `onAuthenticate` for every document on the WebSocket. Authorization lives in SQLite (`users`, `projects`, `memberships`, `invites`, `overrides`, `settings`) and one `effectiveRole()` function used by every route and by Hocuspocus (`connectionConfig.readOnly`). A per-project presence document `project:<id>` carries avatars (awareness) and server events (stateless: tree/project/access/deleted); access changes close the affected sockets so Hocuspocus re-authenticates. All 003 routes move under `/api/projects/[pid]/`, the editor page moves to `/project/[id]`, and `/` becomes the dashboard. Research: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 6 (strict), Node 24, Svelte 5 runes, SvelteKit 3

**Primary Dependencies**: existing (Hocuspocus 4.7, Yjs, y-codemirror.next, CodeMirror 6, Drizzle, better-sqlite3, fflate) + new `@clerk/clerk-js` ^6, `@clerk/ui` ^1, `@clerk/backend` ^3, dev `@clerk/testing` ^2

**Storage**: SQLite (Drizzle migration 0003 + data steps), blobs and compile output on the data volume (`compile/<projectId>/`)

**Testing**: Vitest (server auth, permissions, mirror/sign-up policy, Hocuspocus auth/read-only/kick, migration, sharing routes); Playwright with the test auth bypass (multi-context for collaboration, 2 and 5 sessions), plus a `clerk` project running a smoke set against the Clerk dev instance

**Target Platform**: self-hosted Linux Docker image; browsers Chromium, Firefox, WebKit

**Project Type**: web application (single SvelteKit app with an in-process WebSocket server)

**Performance Goals**: remote edits and cursors < 300 ms on LAN; access changes reach open sessions < 2 s; 5 concurrent editors per file

**Constraints**: Clerk is the only managed service; authorization never delegated to Clerk; test bypass impossible in the production image

**Scale/Scope**: small instances (tens of users, hundreds of projects); one Node process

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| I. Collaboration is the data model | Text still only through Yjs; readers blocked by Hocuspocus read-only, no second write path. Tree stays in SQLite (as 003) with live refresh events. Per-user undo via `Y.UndoManager` (already local-origin only). | Pass |
| II. Self-hostable by one person | Clerk is the one allowed managed service (v1.1.0). No webhooks needed (lazy mirror), no Redis, no queue. Config via env vars with defaults; only the two Clerk keys are required. | Pass |
| III. Untrusted compilation | Unchanged runner; compile dir becomes per project. Readers may compile (spec FR-037); the container limits still apply. | Pass |
| IV. Test the seams | Vitest for auth/permissions/collab; Playwright with two and five contexts for collaboration; each acceptance scenario mapped to a test in tasks.md. | Pass |
| V. Simplicity first | One `effectiveRole()`, one `kick()`, one presence doc type; clerk-js instead of a wrapper with a peer conflict; no tree CRDT; ponytail notes on compile concurrency and `updatedAt` throttling. | Pass |
| Tech: Auth = Clerk, roles in app | `users.role`, memberships and overrides in SQLite. | Pass |
| Tech: y-codemirror remote cursors and per-user undo | `yCollab(ytext, awareness, { undoManager })` with `awareness.setLocalStateField('user', …)`. | Pass |

Post-design re-check: same result; no Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/005-accounts-sharing-collab/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── http-api.md
│   └── ui.md
├── checklists/requirements.md
├── progress.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── hooks.server.ts                      # NEW: authenticate every request, locals.user, redirects/401/403
├── app.d.ts                             # Locals { user }
├── env.ts                               # + PUBLIC_CLERK_PUBLISHABLE_KEY (public), test-auth flag
├── lib/
│   ├── auth.svelte.ts                   # NEW: clerk-js loader, me, getToken(), signOut()
│   ├── presence.ts                      # NEW: palette + colorFor(userId)
│   ├── project.svelte.ts                # project-scoped URLs, canEdit per file, refetch on events
│   ├── session.svelte.ts                # NEW: shared HocuspocusProviderWebsocket + project:<id> doc, awareness, events
│   ├── components/
│   │   ├── TopBar.svelte                # NEW: title rename, presence avatars, status, Share, account menu
│   │   ├── ShareDialog.svelte           # NEW
│   │   ├── PermissionsDialog.svelte     # NEW
│   │   ├── Avatar.svelte                # NEW
│   │   ├── Editor.svelte                # shared socket, token, awareness user, read-only compartment
│   │   └── FileTree.svelte              # lock icons, disabled actions, "Permissions…"
│   └── server/
│       ├── auth.ts                      # NEW: Clerk verify (HTTP + token), test bypass, mirrorUser, sign-up policy
│       ├── access.ts                    # NEW: effectiveRole, require* guards, kick(), broadcast()
│       ├── projects.ts                  # NEW: create/template/import/duplicate/delete/rename/transfer, sharing ops
│       ├── templates.ts                 # NEW
│       ├── schema.ts, files.ts, zip.ts, compile.ts, collab.ts   # project-scoped
├── routes/
│   ├── +page.svelte                     # dashboard (replaces editor)
│   ├── project/[id]/+page.svelte        # editor (moved from +page.svelte)
│   ├── sign-in/+page.svelte, blocked/+page.svelte, admin/+page.svelte
│   ├── share/[token]/+page.server.ts + +page.svelte
│   └── api/
│       ├── me/, admin/{users,users/[id],settings,projects}/
│       └── projects/+server.ts, import/, [pid]/{+server.ts, duplicate, leave, main, symbols, zip,
│           files/…, compile/…, members/…, invites/[email], link, transfer, overrides}
drizzle/0003_*.sql                       # DDL + data steps
tests/
├── unit/{auth,access,projects,collab-auth,migration}.test.ts  (+ existing tests adapted to project ids)
└── e2e/{auth,dashboard,sharing,permissions,presence,collab5,admin,clerk.smoke}.spec.ts (+ helpers signInAs/newProject)
```

**Structure Decision**: keep the single SvelteKit app; new server logic in three modules (`auth.ts`, `access.ts`, `projects.ts`) next to the 003 modules, which take a `projectId` parameter instead of the hardcoded `'main'`. Old `/api/files`, `/api/project*`, `/api/compile*` routes are deleted, not aliased.

## Key design decisions (details in research.md)

1. **Auth on HTTP** (R2): `hooks.server.ts` → `authenticate(event.request)` → `locals.user`. Page requests without a user → 303 `/sign-in?redirect=…` (except `/sign-in`, `/share/*`, static assets); `/api/*` → 401; disabled/not allowed → `/blocked` or 403.
2. **Auth on WS** (R3, R7): `onAuthenticate({ token, documentName, connectionConfig, context })` verifies the token, resolves the document (`fileId` → file's project, or `project:<pid>`), computes `effectiveRole`, sets `context = { userId, projectId }` and `connectionConfig.readOnly`.
3. **Mirror and policy** (R5): `mirrorUser(clerkUserId)` in `auth.ts`, one transaction; first-user admin, `ADMIN_EMAILS`, invite-only default, invites → memberships, orphan projects → first admin.
4. **Revocation** (R6): `kick({ userId?, projectId? })` closes matching connections with 4403; called from every sharing/admin mutation.
5. **Presence and live tree** (R8): `project:<pid>` doc via shared `HocuspocusProviderWebsocket`; `broadcast(projectId, event)` after mutations; clients refetch.
6. **Per-file roles** (R10): overrides walk up `parentId`; `canEdit` per file returned to the tree.
7. **Projects** (R11): `projects` table, `files.projectId`, per-project compile dir and coalescing map; 003's `ensureProject()` replaced by `createProject()`.
8. **Test auth** (R4): `OVERTREE_TEST_AUTH=1` and `NODE_ENV !== 'production'`; startup refuses the combination with production.

## Complexity Tracking

No violations.
