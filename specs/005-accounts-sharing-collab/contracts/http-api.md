# HTTP API contract

All routes require a session (Clerk or, in test builds, the test cookie) unless marked **public**. Errors: `401` no/invalid session, `403` disabled user / not allowed / missing role, `404` project or file not found **or not visible to the caller** (non-members get 404, not 403, so ids don't leak), `409`/`422` as in 003. JSON bodies; error shape `{ message }` (003's `App.Error`).

Roles: **R** = reader or above on the project, **E** = edit right on the affected file(s) per data-model "Effective role", **O** = owner, **A** = site admin.

## Session

| Method | Path | Role | Response |
|---|---|---|---|
| GET | `/api/me` | any signed-in | `{ id, email, name, avatarUrl, role, color }` |

## Projects

| Method | Path | Role | Body → Response |
|---|---|---|---|
| GET | `/api/projects` | signed-in | `{ projects: [{ id, title, owner: { id, name }, role: 'owner'\|'editor'\|'reader', updatedAt }] }` sorted by `updatedAt` desc |
| POST | `/api/projects` | signed-in | `{ title, template: 'blank'\|'article'\|'report'\|'beamer'\|'letter' }` → 201 `{ id }` |
| POST | `/api/projects/import` | signed-in | multipart `file` (zip), `title?` → 201 `{ id }` (003 limits; title defaults to zip name) |
| GET | `/api/projects/:pid` | R | `{ id, title, owner, role, mainFileId, link: { token, role } \| null (owner only), permissions: { canEdit } }` |
| PATCH | `/api/projects/:pid` | O | `{ title }` → 200 |
| DELETE | `/api/projects/:pid` | O or A | 204 |
| POST | `/api/projects/:pid/duplicate` | R | → 201 `{ id }` |
| POST | `/api/projects/:pid/leave` | member (not owner) | 204 |
| PUT | `/api/projects/:pid/main` | E on project root | `{ fileId }` (was `PUT /api/project`) |
| GET | `/api/projects/:pid/symbols` | R | as 003 |
| GET | `/api/projects/:pid/zip` | R | zip download |

## Files (003 routes, now project-scoped)

| Method | Path | Role |
|---|---|---|
| GET | `/api/projects/:pid/files` | R → `{ files: [{ …003 fields, canEdit }], mainFileId }` |
| POST | `/api/projects/:pid/files` | E on target folder |
| PATCH | `/api/projects/:pid/files/:id` | E on item + descendants (+ destination on move) |
| DELETE | `/api/projects/:pid/files/:id` | E on item + descendants |
| GET | `/api/projects/:pid/files/:id/raw` | R |

The 003 `POST /api/project/zip` (replace project from zip) is removed; import creates a new project.

## Compile

| Method | Path | Role |
|---|---|---|
| GET | `/api/projects/:pid/compile` | R |
| POST | `/api/projects/:pid/compile` | R (readers may compile, FR-037) |
| PUT | `/api/projects/:pid/compile/settings` | E on project root |
| GET | `/api/projects/:pid/compile/output.pdf`, `output.log` | R |

## Sharing (owner)

| Method | Path | Role | Body → Response |
|---|---|---|---|
| GET | `/api/projects/:pid/members` | R | `{ owner, members: [{ user, role, via }], invites: [{ email, role }], overrides: [{ userId, fileId, path, role }] }`; invites and overrides only for O |
| POST | `/api/projects/:pid/members` | O | `{ email, role }` → 201 `{ status: 'member'\|'invited' }`; own email → 422; existing member → role updated |
| PATCH | `/api/projects/:pid/members/:userId` | O | `{ role }` |
| DELETE | `/api/projects/:pid/members/:userId` | O | 204 (also deletes their overrides) |
| DELETE | `/api/projects/:pid/invites/:email` | O | 204 |
| PUT | `/api/projects/:pid/link` | O | `{ role: 'editor'\|'reader' \| null, regenerate?: boolean }` → `{ token, role } \| null` |
| POST | `/api/projects/:pid/transfer` | O | `{ userId }` (must be a member) → 200 |
| PUT | `/api/projects/:pid/overrides` | O | `{ userId, fileId, role: 'editor'\|'reader'\|null }` (null removes) |

Every sharing mutation calls `kick({ userId?, projectId })` and broadcasts `access` (research R6, R8).

## Share link

| Method | Path | Role | Response |
|---|---|---|---|
| GET | `/share/:token` (page) | **public** | signed out: project title + "Sign in to open"; signed in: joins (membership `via='link'`, max with existing role) and redirects to `/project/:pid`; bad token: "This link is no longer valid" |

## Admin

| Method | Path | Role | Body → Response |
|---|---|---|---|
| GET | `/api/admin/users` | A | `{ users: [{ id, email, name, role, disabled, lastSeenAt, projectCount }] }` |
| PATCH | `/api/admin/users/:id` | A | `{ role? , disabled? }`; last enabled admin → 409 |
| GET | `/api/admin/settings` | A | `{ signupMode, allowlist }` |
| PUT | `/api/admin/settings` | A | same shape; entries validated (`x@y` or `@y`) |
| GET | `/api/admin/projects` | A | `{ projects: [{ id, title, owner, collaborators, updatedAt }] }` |
| DELETE | `/api/projects/:pid` | A | (see Projects) |

## WebSocket `/collab`

Hocuspocus protocol. Every document requires a token: a Clerk session JWT, or `test:<email>` in test builds.

| Document | Access | Notes |
|---|---|---|
| `<fileId>` (text file) | R on the file; `readOnly` unless E on the file | persisted |
| `project:<pid>` | R on the project; always `readOnly` | awareness `{ user, fileId }`; server stateless events `{"type":"tree"\|"project"\|"access"\|"deleted"}` |

Failures: unknown doc, no access or disabled → `authenticationFailed` with reason `forbidden`. Revocation closes the connection with code `4403`.
