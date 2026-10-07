# Research: GitHub repository sync

All decisions below resolve the open points of the Technical Context in [plan.md](./plan.md).

## R1. Integration type: a GitHub App with user authorization

- **Decision**: The instance admin registers one **GitHub App** (permissions: *Contents: read & write*, *Metadata: read*; no webhook; callback URL `<origin>/api/github/callback`; "Request user authorization (OAuth) during installation" on). A user "connects GitHub" through the App's user-authorization flow (`https://github.com/login/oauth/authorize?client_id=…&state=…`), which yields a user-to-server token plus refresh token. Repositories are granted by **installing** the App on a personal account or an organization (`https://github.com/apps/<slug>/installations/new`), choosing all or selected repositories. Pushes and pulls use short-lived **installation tokens** (1 h) minted from the App's private key.
- **Rationale**: Exactly the user's model: Overtree sign-in stays Clerk (Google/email), GitHub is only a connection, and the owner chooses repositories per account/organization on GitHub's own screen (FR-002). Installation tokens are scoped to granted repositories and don't expire with the user's session, so background syncs work while nobody is signed in. Commits come from the App (`<slug>[bot]`), which is what the user chose (Q3: "commits from the Overtree integration").
- **Alternatives considered**: *OAuth App* — the token covers every repository the user can see (`repo` scope), no per-repo choice; rejected for FR-002. *Personal access tokens pasted by users* — manual, error-prone, secrets in forms. *Clerk's GitHub social connection* — would make GitHub a sign-in method and ties tokens to Clerk; the user explicitly wants the Overtree login unchanged.

## R2. Which repositories a user may link

- **Decision**: The picker lists `GET /user/installations` → for each, `GET /user/installations/{id}/repositories` with the **user** token. GitHub returns only repositories that are both in the installation and accessible to the user; each has `permissions.push`. Only `push: true` repositories are offered (FR-006). On link the server re-checks with `GET /repos/{owner}/{repo}` (user token) and stores the `installation_id`.
- **Owner still allowed?** Before a sync, if the last check is older than 1 h, the server re-runs `GET /repos/{owner}/{repo}` with the owner's user token (refreshing it if needed). A 401/refresh failure → `needs-reconnect`; 403/404 or `push: false` → `needs-access`. This stops syncing when the owner revokes the App on GitHub or loses org access (US1 #6, edge cases) even though installation tokens would still work.
- **Alternatives**: trusting the installation alone — keeps pushing after the owner leaves the organization; rejected.

## R3. GitHub client: `@octokit/auth-app` + `fetch`

- **Decision**: Add `@octokit/auth-app` for App JWTs, installation-token minting and caching, and user-token code exchange/refresh. REST calls are a ~40-line `gh(token, method, path, body)` wrapper over `fetch` in `src/lib/server/github/api.ts`, with the base URL from `GITHUB_API_URL` (default `https://api.github.com`) and the web URL from `GITHUB_URL` (default `https://github.com`).
- **Rationale**: Token handling is the error-prone part (JWT signing, clock skew, caching) and the library does it; the REST surface we need is ~12 endpoints, where the full Octokit client adds little. The configurable base URLs let tests point at a fake GitHub (R11) and happen to support GitHub Enterprise Server.
- **Alternatives**: full `octokit` (heavier, plugins we don't use); hand-written JWT signing with `node:crypto` (works, but more custom code in the security path — Principle V "libraries first").

## R4. Push mechanics: Git Data API, never force

- **Decision**: One push =
  1. `GET /repos/{o}/{r}/git/ref/heads/{branch}` → head commit `H`. If `H ≠ base.commit`, pull first (R6); repeat until equal.
  2. Compute the changes: current project files (filtered by R8) vs `base.files` (path → git blob SHA-1). Git blob SHAs are computed locally (`sha1("blob <len>\0" + bytes)`), so unchanged files cost nothing.
  3. Nothing changed → no commit (FR-014).
  4. For each new/changed binary `POST /git/blobs` (base64); text goes inline in the tree. `POST /git/trees` with `base_tree = H.tree` and one entry per changed path (deleted paths: `sha: null`). Paths not in the change set — GitHub-only files, workflow PDFs, `.github/` — are inherited from `base_tree` untouched (FR-013).
  5. `POST /git/commits` (parent `H`, message per R9) → `PATCH /git/refs/heads/{branch}` with `force: false`. A 422 "not a fast forward" (someone pushed in between) → back to step 1, at most 3 times, then fail with retry (FR-024).
  6. `base := { commit: new, files: pushed state }`, `watermark := log id read in step 2`.
- **Rationale**: Exactly one commit per push on top of the current head, no clone, no git binary in the image, no working tree on disk. `base_tree` gives "leave everything else alone" for free.
- **Alternatives**: `isomorphic-git` clone + push over HTTPS (keeps a working copy per project on disk, slower, more state); the Contents API (one commit per file; violates "one commit per push").

## R5. When to push and pull (scheduler)

- **Decision**: `src/lib/server/github/sync.ts` keeps one in-memory scheduler per process (like history's sweep):
  - **Presence** comes from Hocuspocus: every open project has the `project:<pid>` presence document. `onConnect`/`onDisconnect` hooks in `collab.ts` call `github.presence(pid, connectionsCount)`.
  - **Open** (count 0→1): request a pull (US3 #2).
  - **Session end** (count →0): set `sessionEndAt = now + GRACE_MS` (2 min); a reconnect before then clears it (US2 #2). When due → push.
  - **Long session**: every tick, for an open linked project with unpushed changes, if `now - lastPushAt ≥ LONG_MS` (30 min) and a history version was closed after `lastPushAt` → push (US2 #3).
  - **Periodic pull**: every tick, open linked projects whose last pull is ≥ `PULL_MS` (2 min) old → pull (FR-016).
  - **Manual**: "Push now" / "Pull now" routes request a sync directly.
  - **Startup**: every active link with unpushed changes gets a push, every active link a pull, staggered (FR-023).
  - Tick every `TICK_MS` (15 s). All four durations come from env for tests only (`GITHUB_GRACE_MS`, `GITHUB_LONG_MS`, `GITHUB_PULL_MS`, `GITHUB_TICK_MS`), as history does.
- **Per-project serialization (FR-022)**: a `Map<pid, { running: Promise; next: Request | null }>`. A request while running merges into `next` (push wins over pull, a custom title is kept); after the run, `next` runs once.
- **Rationale**: Nothing extra to deploy, restart-safe because "unpushed" is derived from stored data (R7), and it matches how history already closes versions.
- **ponytail**: single-process scheduler; several app replicas would each sync. Upgrade path: a lease row per link.

## R6. Pull and merge: three-way text merge applied as one Yjs edit

- **Decision**: One pull =
  1. Head `H` (ref API). `H = base.commit` → only bump `lastPullAt`.
  2. `GET /git/trees/{H.tree}?recursive=1` → path → blob SHA for every file. Filter by the "not pulled" patterns (R8). Compare with `base.files`: added, changed and deleted paths on GitHub's side. A delete + add with the same blob SHA is a rename (exact match only; ponytail: an edited-and-renamed file arrives as delete + add).
  3. Nothing in the filtered set changed (e.g. only the workflow's PDF commit) → `base.commit := H`, no history version, no note (SC-005).
  4. Download changed blobs (`GET /git/blobs/{sha}`), size-capped by `UPLOAD_MAX_FILE_MB`.
  5. **Text files changed on GitHub**: `merged = diff3(ours = current text, base = base text, theirs = GitHub text)`. Computed and written inside one `openDirectConnection(...).transact` with `{ userId: undefined }` context, so the read of "ours" and the write are atomic with respect to collaborators' updates (the server applies updates one at a time) and the result goes through `editText`'s minimal fast-diff edit: collaborators' cursors and in-flight typing survive (US3 #3, FR-017), and history logs it as a system edit. Overlapping hunks keep both sides wrapped in LaTeX comment markers, so the document still compiles:
     ```
     % <<<<<<< Overtree
     …our lines…
     % ======= GitHub 1a2b3c4
     …their lines…
     % >>>>>>> 
     ```
     and the file goes into the merge note (US3 #4, FR-018).
  6. **Tree changes** (added/deleted/renamed files, binaries): applied in one DB transaction with the same helpers restore uses (create/move/delete rows, blobs via `putBlob`), then `logTree(pid, null)` and `broadcast('tree')`. A file deleted on GitHub but changed in Overtree since base → kept, noted. A binary changed on both sides → Overtree's kept, noted. Folders are created as needed; folders emptied by a GitHub delete are removed.
  7. `closeVersion(pid, 'github', { github: { commits, notes } })` records the "Merged from GitHub" version (FR-021); the commits come from `GET /repos/{o}/{r}/compare/{base}...{H}` (SHA, author name, message; first 20).
  8. `base := { commit: H, files: GitHub's filtered tree }`, base texts stored as blobs (R7). Overtree-side changes not yet on GitHub stay unpushed: the next push sends them.
- **Base texts**: the base text for diff3 is the base blob's content, kept locally (`base.files[path].hash` → Overtree blob store) so a merge needs no extra API call for the base.
- **Rationale**: diff3 gives real conflict detection (US3 #4), and doing it on the server inside one Yjs transaction keeps Principle I (the only write path is a Yjs update through Hocuspocus). Plain CRDT replay of GitHub's change onto a forked doc was considered: it merges silently even on overlap (interleaved characters) and needs the exact Yjs state at the base commit, which history only has at version boundaries.
- **Library**: `node-diff3` (MIT, no dependencies) for `diff3Merge`, line-based.
- **Alternatives**: last-writer-wins (contradicts the user's 2: C answer); conflict markers without the `%` (breaks compiles).

## R7. What "the last synced state" is and how unpushed changes are detected

- **Decision**: the link stores
  - `baseCommit` — the GitHub commit both sides last agreed on (after a push: the pushed commit; after a pull: `H`);
  - `baseFiles` — blob hash of a JSON map `path → { sha, hash? }` for the synced paths at `baseCommit` (`hash` = Overtree blob of text files, for diff3);
  - `watermark` — the `history_log.id` up to which Overtree's changes are on GitHub.
  - **Unpushed** = a `history_log` row with `id > watermark` and `userId IS NOT NULL` exists (a cheap indexed query). Pull writes are logged with `userId = null`, so they don't count. The push itself still compares SHAs, so a false "unpushed" never creates an empty commit (FR-014).
- **Co-authors** = distinct `userId` of those rows (FR-015, R9).
- **Restart**: all of the above is in SQLite (FR-023).

## R8. Path filters

- **Decision**: one pattern list per link (`ignore`, JSON array of globs, owner-editable, FR-020) with the defaults from the spec. Pattern matching uses `node:path`'s `matchesGlob` (built in since Node 22.5; if it still warns as experimental on the image's Node 24, use `picomatch` instead). The special default `<compile-output-pdf>` means "`X.pdf` when `X.tex` is in the same folder" and is evaluated against the union of both trees. Filtered paths are excluded from pull **and** push (FR-013), so GitHub's copy is never touched. Overtree's compile output lives outside the project tree (`data/compile/<pid>`), so it is never a candidate anyway.
- **Paths Overtree can't hold** (names failing `validateName`, `..`, over limits): skipped and listed in the note.
- **Empty folders**: git has none; an empty Overtree folder isn't pushed (ponytail: documented, no `.gitkeep`).

## R9. Commit message

- **Decision**:
  ```
  <title>

  <body: up to 20 "M path" / "A path" / "D path" / "R old -> new" lines, then "…and N more">

  Co-authored-by: Ada Lovelace <ada@example.com>
  Co-authored-by: Bob <bob@example.com>
  ```
  Default title: `Update main.tex` (one file), `Update main.tex and 2 more files`, or "Push now"'s custom title (trimmed, ≤ 72 chars). Users without an email are listed by name in the body instead (edge case). Author/committer are left to GitHub, which makes the App bot the committer.

## R10. Storing GitHub tokens

- **Decision**: user access + refresh tokens are encrypted with AES-256-GCM before they go into SQLite; the key is `HKDF(GITHUB_APP_PRIVATE_KEY, "overtree-github-tokens")`. Installation tokens are never stored (minted on demand, cached in memory by `@octokit/auth-app`). Tokens never appear in API responses; errors are logged with the GitHub status and message only (SC-006).
- **ponytail**: rotating the App's private key invalidates stored user tokens → owners see "needs reconnect". Fine for one admin.

## R11. Testing without GitHub: an in-process fake

- **Decision**: `tests/fake-github/server.ts` — a small HTTP server holding repos in memory (refs, commits, trees, blobs with real git SHA-1s) that implements exactly the endpoints used: OAuth `login/oauth/authorize` (auto-approves, redirects to the callback) and `access_token`, `app/installations/{id}/access_tokens`, `user`, `user/installations`, `user/installations/{id}/repositories`, `repos/{o}/{r}`, `git/ref(s)`, `git/trees`, `git/blobs`, `git/commits`, `compare`, plus test-only helpers `commitFiles(repo, branch, files, author)` (simulates the workflow and GitHub edits) and `revoke(user)`. Vitest starts it per test; Playwright starts it as a third `webServer` and sets `GITHUB_API_URL`/`GITHUB_URL` to it.
- **Rationale**: Principle IV wants every acceptance scenario automated; real GitHub in CI needs secrets and network. Contract drift risk is covered by an optional smoke test (`tests/unit/github.smoke.test.ts`) that pushes to and pulls from a throwaway repository with a real App's installation token when `GITHUB_SMOKE=1` (the OAuth click-through stays manual, quickstart.md).

## R12. Sync state machine (link `status`)

- `pending` (linked, first-sync preview not confirmed) → `active` on confirm/import.
- `active` ↔ `failing` (last attempt failed, retrying: 1, 2, 4 … 60 min, then hourly; FR-024).
- `active|failing` → `needs-reconnect` (user token refresh failed / connection removed), `needs-access` (repo gone, no push permission, branch missing), `owner-changed` (ownership transfer, FR-027). These don't retry automatically; reconnecting or the new owner's confirmation returns to `active`.
- Displayed state (FR-025) is computed: `syncing` if a run is in progress, else `failed`/`needs-*`, else `unpushed` if R7 says so, else `in-sync`.

## R13. Constitution Principle II (external service)

GitHub is a second external service next to Clerk. It is optional: with `GITHUB_APP_ID` unset the feature is invisible (FR-004) and the app needs nothing from GitHub. Recorded in plan Complexity Tracking.
