# Data model: Accounts, roles, sharing & live collaboration

SQLite via Drizzle (`src/lib/server/schema.ts`), one new migration generated with `pnpm db:generate` plus hand-written data steps (below). Times are Unix ms.

## users

| Column | Type | Rules |
|---|---|---|
| `id` | text PK | Clerk user id (`user_…`), or `test_<email>` from the test bypass |
| `email` | text not null | lower-cased primary email; unique index |
| `name` | text not null | Clerk full name, else email local part |
| `avatarUrl` | text | Clerk image URL, null → initial in colored circle |
| `role` | text `'admin' \| 'user'` not null | |
| `disabled` | integer bool not null default 0 | |
| `createdAt`, `lastSeenAt`, `syncedAt` | integer | `syncedAt` = last profile refresh from Clerk (≥ 10 min apart) |

Rules: first row inserted → `admin`; email in `ADMIN_EMAILS` → `admin` on insert and on refresh. The last enabled admin cannot be demoted or disabled (checked in the same transaction).

## settings

Single row, `id = 1`.

| Column | Type | Rules |
|---|---|---|
| `signupMode` | text `'open' \| 'invite'` | default `'invite'` |
| `allowlist` | text (JSON string array) | entries `name@host` or `@host`, lower-cased, trimmed |

## projects (replaces `project`)

| Column | Type | Rules |
|---|---|---|
| `id` | text PK | uuid; the pre-005 project keeps id `'main'` |
| `title` | text not null | 1–120 chars, trimmed |
| `ownerId` | text → users.id | null only for the migrated project until the first admin exists |
| `mainFileId` | text | as 003 |
| `linkToken` | text unique | null = link sharing off; 32 random bytes base64url |
| `linkRole` | text `'editor' \| 'reader'` | set when `linkToken` set |
| `createdAt`, `updatedAt` | integer | `updatedAt` bumped by tree changes and text changes (≤ every 10 s) |

## files (changed)

Adds `projectId text not null references projects.id` (migration default `'main'`), index `(projectId, parentId)`. Sibling-name uniqueness and limits from 003 become per project. `PROJECT_MAX_FILES` counts per project.

## memberships

| Column | Type | Rules |
|---|---|---|
| `projectId` | text → projects.id | PK part |
| `userId` | text → users.id | PK part |
| `role` | text `'editor' \| 'reader'`, nullable | role from an invite; null when the user only joined by link |
| `viaLink` | integer 0/1 | set when the user joined through the share link; counts only while the link is on |
| `createdAt` | integer | |

Membership role = the higher of `role` and (`viaLink` and `projects.linkToken` set ? `projects.linkRole` : none). Disabling or regenerating the link sets `viaLink = 0` on all rows and deletes rows whose `role` is null; invited roles stay. Removing a collaborator deletes the row.

Owner has no membership row. Transfer: the new owner's membership row is deleted and a row `(oldOwner, role 'editor', viaLink 0)` inserted, in one transaction with `projects.ownerId` update.

## invites

| Column | Type | Rules |
|---|---|---|
| `projectId` | text → projects.id | PK part |
| `email` | text | PK part, lower-cased |
| `role` | text `'editor' \| 'reader'` | |
| `createdAt` | integer | |

Converted to a membership (`role` = invite role) and deleted when a user with that email is mirrored. Inviting an email that already has an account creates the membership directly.

## overrides

| Column | Type | Rules |
|---|---|---|
| `projectId` | text → projects.id | |
| `userId` | text → users.id | PK part |
| `fileId` | text → files.id | PK part; file or folder |
| `role` | text `'editor' \| 'reader'` | |

Deleted with the file (cascade in `deleteEntry`) and with the membership.

## compile_settings, documents, updates

Unchanged. `compile_settings.project` now holds real project ids. Document names: file ids (persisted) and `project:<id>` (presence/events, never persisted).

## Migration data steps (same migration file, after DDL)

1. `INSERT INTO projects (id, title, owner_id, main_file_id, created_at, updated_at) SELECT id, 'Untitled project', NULL, main_file_id, now, now FROM project;` then `DROP TABLE project`.
2. Existing `files` rows get `project_id = 'main'` via the column default.
3. `INSERT INTO settings (id, signup_mode, allowlist) VALUES (1, 'invite', '[]')`.
4. At runtime (`mirrorUser`), when the first admin is created: `UPDATE projects SET owner_id = :admin WHERE owner_id IS NULL`.

`ensureProject()` from 003 no longer creates a project on startup; new projects come from the dashboard.

## Effective role

```
role(project, user, file?) =
  user.disabled                      → none
  project.ownerId == user.id         → owner
  file and nearest override on file or its ancestors → that role
  membership                          → max(membership.role, viaLink && link on ? linkRole : none)
  otherwise                           → none
canEdit = role ∈ {owner, editor};  canRead = role ≠ none
```

Site admins get no implicit project access (clarification Q5).
