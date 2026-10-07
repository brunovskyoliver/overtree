# Data Model: GitHub repository sync

SQLite via Drizzle, migration `0005`. Existing tables are in `src/lib/server/schema.ts`.

## github_accounts (GitHub connection, FR-001–003)

| Column | Type | Notes |
|---|---|---|
| user_id | text PK → users.id | one connection per Overtree user |
| github_id | integer not null | GitHub user id |
| login | text not null | shown in the UI |
| access_token | blob not null | AES-GCM encrypted user-to-server token (research R10) |
| access_expires_at | integer not null | ms |
| refresh_token | blob not null | encrypted |
| refresh_expires_at | integer not null | ms; past → needs reconnect |
| created_at, updated_at | integer | |

Deleted on "Disconnect" (and when the user is deleted). Links using it move to `needs-reconnect`.

## github_links (Repository link, FR-005–010, R7, R12)

| Column | Type | Notes |
|---|---|---|
| project_id | text PK → projects.id | at most one link per project (FR-007) |
| user_id | text → users.id | whose connection authorizes it: the owner at link time |
| installation_id | integer not null | GitHub App installation that covers the repo |
| repo_id | integer not null | stable across renames |
| repo | text not null | `owner/name`, refreshed when GitHub reports a rename |
| branch | text not null | |
| ignore | text not null | JSON array of glob patterns ("not pulled", FR-020), defaults per research R8 |
| status | text not null | `pending` · `active` · `failing` · `needs-reconnect` · `needs-access` · `owner-changed` |
| base_commit | text null | last commit both sides agree on; null until the first sync |
| base_files | text null | blob hash of JSON `{ [path]: { sha: string; hash?: string } }` |
| watermark | integer not null default 0 | `history_log.id` covered by GitHub (R7) |
| last_push_at, last_pull_at, last_check_at | integer null | ms |
| fail_count | integer not null default 0 | backoff exponent |
| next_attempt_at | integer null | retry time while `failing` |
| error | text null | plain-language reason of the last failure |
| note | text null | JSON `MergeNote` of the latest pull with notes, cleared by the owner ("dismiss") or the next noted pull |
| created_at, updated_at | integer | |

**Rules**
- Only the project owner writes it (FR-005). On ownership transfer: `status := owner-changed` (FR-027); the new owner confirms with their own connection, which sets `user_id`, `installation_id` and `status := active` after an access check.
- Deleting the project deletes the row (FR-010). Duplicating a project copies nothing (edge case).
- `MergeNote = { at: number; commit: string; files: { path: string; reason: 'overlap' | 'kept-deleted' | 'kept-binary' | 'skipped-name' | 'skipped-size' }[] }`.

**State transitions** (research R12)

```
pending --confirm/import--> active
active --run fails (network, 5xx, 409 race x3)--> failing --run ok--> active
active|failing --token refresh fails / account removed--> needs-reconnect --reconnect + check ok--> active
active|failing --403/404, no push, branch missing--> needs-access --owner fixes (relink/branch) + check ok--> active
any --ownership transfer--> owner-changed --new owner confirms--> active
unlink: row deleted
```

## github_runs (Sync run, US4, FR-022/024/025)

| Column | Type | Notes |
|---|---|---|
| id | integer PK autoincrement | |
| project_id | text → projects.id | index (project_id, id) |
| kind | text | `push` · `pull` · `import` |
| trigger | text | `session-end` · `long-session` · `open` · `periodic` · `manual` · `startup` · `retry` · `link` |
| user_id | text null → users.id | manual runs only |
| result | text | `pushed` · `pulled` · `noop` · `failed` |
| commit | text null | pushed commit or pulled head |
| error | text null | |
| started_at, finished_at | integer | |

Kept for the status popover (last 20 shown) and tests; rows of a deleted project are deleted with it. ponytail: never pruned; at one row per push/pull with changes plus failures it stays small. `noop` periodic pulls are **not** stored (they'd be 30 rows an hour); only `last_pull_at` moves.

## versions (existing, 008)

- `kind` gains `'github'` ("Merged from GitHub", FR-021).
- New nullable column `source` (text, JSON): `{ commits: { sha: string; author: string; message: string }[]; notes: MergeNote['files'] }` for `github` versions; null otherwise. The timeline shows the commit authors' names (not Overtree users) and the first commit's message.

## history_log (existing, 008)

No schema change. Pull writes are logged with `userId = null` (system), which is what keeps them out of "unpushed" (R7) and out of the version's Overtree authors.

## Derived values (not stored)

- **Unpushed**: `exists(history_log where project_id = ? and id > link.watermark and user_id is not null)`.
- **Co-authors of a push**: distinct `user_id` of those rows, joined to `users` for name and email.
- **Display state** (FR-025): `syncing` (run in progress) · `failed` (`failing`) · `needs-reconnect` · `needs-access` · `owner-changed` · `pending` · `unpushed` · `in-sync`.
