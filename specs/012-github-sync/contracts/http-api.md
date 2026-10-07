# HTTP API: GitHub sync

All routes need a signed-in user (Clerk session or the test bypass) and answer JSON errors `{ message }` with the usual codes (401 signed out, 403 role, 404 unknown/not visible, 409 conflict, 422 invalid). With the integration unconfigured (`GITHUB_APP_ID` unset) every route below answers **404** and `/api/me` reports `github: null` (FR-004). No response ever contains a GitHub token (SC-006).

## Connection (per user)

### `GET /api/github/connect?return=<path>`
Redirects (302) to GitHub's user authorization URL with a `state` = signed, 10-minute token of `{ userId, return, nonce }` (HMAC with the client secret), also set as an `HttpOnly; SameSite=Lax` cookie. `return` must be a same-origin path.

### `GET /api/github/callback?code&state[&installation_id&setup_action]`
Used for both authorization and the App's post-install Setup URL. Checks `state` against the cookie and the signed-in user (403 on mismatch), exchanges `code` for tokens, stores/updates `github_accounts`, redirects to `return` (default `/`). Without `code` (install without OAuth, or GitHub's Setup URL redirect after granting a repository, which carries no state of ours) the state is optional and only picks `return`. Either way the signed-in user's `needs-reconnect` links and `needs-access` links (not a missing branch) are re-checked; back → `active` with the base kept and a catch-up sync (R12).

### `GET /api/github/account`
`200 { connected: false, installUrl } | { connected: true, login, avatarUrl, installUrl, manageUrl }`. `installUrl` = `<GITHUB_URL>/apps/<slug>/installations/new`, `manageUrl` = `<GITHUB_URL>/settings/installations`.

### `DELETE /api/github/account`
Removes the connection; the user's links become `needs-reconnect`. Nothing on GitHub changes (FR-010). `204`.

### `GET /api/github/repos`
Repositories the user's connection can push to (FR-006): `200 { accounts: { login, type: 'User'|'Organization', avatarUrl, installationId, repos: { id, fullName, defaultBranch, private }[] }[] }`. 409 `{ message, reconnect: true }` if the user token is dead.

### `GET /api/github/repos/:owner/:repo/branches`
`200 { branches: string[], defaultBranch }` (first 100).

## Link (per project)

### `GET /api/projects/:pid/github` — any member
```ts
type GitHubStatus = {
  configured: true;
  link: null | {
    repo: string; branch: string; url: string;           // https://github.com/owner/repo/tree/branch
    state: 'pending' | 'in-sync' | 'unpushed' | 'syncing' | 'failed' | 'needs-reconnect' | 'needs-access' | 'owner-changed';
    error: string | null;                                // plain language
    nextAttemptAt: number | null;
    lastCommit: { sha: string; url: string; at: number } | null;
    lastPushAt: number | null; lastPullAt: number | null;
    note: MergeNote | null;                              // data-model.md
    ignore: string[];                                    // owner only, else omitted
    linkedBy: { id: string; name: string };
  };
  canManage: boolean;   // owner
  canSync: boolean;     // owner or editor, link active-ish
  runs?: { kind; trigger; result; commit; error; at; user: { name } | null }[];  // last 20, members
};
```

### `PUT /api/projects/:pid/github` — owner
Body `{ installationId, repoId, branch, ignore? }`. Verifies with the owner's user token that the repo is in that installation and `push: true` (R2), and that the branch exists (422 otherwise). Creates or replaces the link with `status: 'pending'`, `base_commit: null`. Changing repo or branch of an existing link resets the base (next sync is a first sync). `200 GitHubStatus`. Broadcasts `{ type: 'github' }`.

### `GET /api/projects/:pid/github/preview` — owner, link `pending`
First-sync preview (FR-008):
```ts
{ head: string | null;           // null: empty branch / empty repo
  projectEmpty: boolean;          // offers import (FR-009)
  overwrite: string[];            // in both, different content: GitHub's copy will be replaced
  same: string[];                 // in both, identical
  addToGitHub: string[];          // project only
  addToProject: string[];         // GitHub only, not ignored: will be pulled into the project
  githubOnly: string[];           // ignored by the patterns: stays on GitHub only
}
```
Lists are capped at 500 entries each with a `truncated` flag.

### `POST /api/projects/:pid/github/confirm` — owner, link `pending`
Body `{ mode: 'merge' | 'import' }`. `merge`: project files win on `overwrite`, `addToProject` files are pulled, then a push (FR-008). `import` (only if `projectEmpty`, else 409): the branch's files become the project (FR-009), base := head. Sets `status: 'active'`, runs synchronously up to 60 s, `200 GitHubStatus`. Failure → link stays `pending` with `error`.

### `PATCH /api/projects/:pid/github` — owner
Body `{ ignore?: string[]; branch?: string; confirmOwner?: true; dismissNote?: true; recheck?: true }`. `recheck` ("Check again"): in `needs-access`/`needs-reconnect`, checks the linker's access again; ok → `active` with base, watermark and `pending_push` kept, then a catch-up sync; still refused → 409 with the reason. `ignore`: ≤ 50 patterns, ≤ 200 chars each. `branch`: as PUT (resets base, `pending`). `confirmOwner`: in `owner-changed`, the new owner takes the link over with their own connection (R12, FR-027); 409 if they have no connection or no access. `200 GitHubStatus`.

### `DELETE /api/projects/:pid/github` — owner
Unlink (FR-010). `204`. Broadcasts `github`.

### `POST /api/projects/:pid/github/push` — owner or editor
Body `{ title?: string }` (≤ 72 chars after trim). Queues a manual push (pull first) and waits up to 30 s for that run: `200 { result: 'pushed' | 'noop' | 'failed', commit?, error? }`, or `202` if still running (status follows by broadcast). Readers 403 (FR-026); link not active → 409.

### `POST /api/projects/:pid/github/pull` — owner or editor
Same shape for a manual pull.

### `POST /api/projects/:pid/github/create-branch` — owner, link `needs-access` with "branch not found"
Creates the linked branch from the project's current files (single root commit, or on the repository's default branch head if it exists) and returns to `active`.

## Events

`ProjectEvent` gains `{ type: 'github' }`, broadcast on the presence document whenever a link's status, a run's start/end or a note changes; clients refetch `GET /api/projects/:pid/github`.

## `/api/me`

Adds `github: null | { configured: true }` so the UI knows whether to show GitHub at all.

## Server environment

| Variable | Required | Meaning |
|---|---|---|
| `GITHUB_APP_ID` | to enable | numeric App id |
| `GITHUB_APP_SLUG` | with it | the App's URL name (install links) |
| `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | with it | user authorization |
| `GITHUB_APP_PRIVATE_KEY` | with it | PEM (literal `\n` allowed) |
| `GITHUB_API_URL`, `GITHUB_URL` | no | defaults `https://api.github.com`, `https://github.com` (tests, GHES) |
| `GITHUB_GRACE_MS`, `GITHUB_LONG_MS`, `GITHUB_PULL_MS`, `GITHUB_TICK_MS` | no | tests only (R5) |

Partially set → the server refuses to start with a message naming the missing variable (like Clerk's check).
