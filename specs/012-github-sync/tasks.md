---

description: "Task list for feature 012: GitHub repository sync"
---

# Tasks: GitHub repository sync

**Input**: Design documents from `specs/012-github-sync/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/http-api.md, contracts/ui.md, quickstart.md

**Tests**: Required by the constitution (Principle IV): every acceptance scenario ends as a Vitest or Playwright test, run against the fake GitHub (research R11).

**Organization**: grouped by user story (spec priorities P1 → P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- Paths are repo-relative (single SvelteKit app, plan.md "Project Structure")

---

## Phase 1: Setup

**Purpose**: dependencies, env, schema, the fake GitHub

- [X] T001 Add `@octokit/auth-app` and `node-diff3` with `pnpm add @octokit/auth-app node-diff3` (package.json, pnpm-lock.yaml) (research R3, R6)
- [X] T002 [P] Declare `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_API_URL`, `GITHUB_URL`, `GITHUB_GRACE_MS`, `GITHUB_LONG_MS`, `GITHUB_PULL_MS`, `GITHUB_TICK_MS` in `src/env.ts` (all optional, descriptions per contracts/http-api.md "Server environment"), and add the five `GITHUB_APP_*` variables (empty defaults, with a comment pointing at quickstart.md) to `compose.yaml`
- [X] T003 Add `githubAccounts`, `githubLinks` (incl. `pending_push` integer bool default 0), `githubRuns` to `src/lib/server/schema.ts` exactly per data-model.md (`github_links.status`: `'pending' | 'active' | 'failing' | 'needs-reconnect' | 'needs-access' | 'owner-changed'`; `github_runs.kind`: `'push' | 'pull' | 'import'`; `trigger`: `'session-end' | 'long-session' | 'open' | 'periodic' | 'manual' | 'startup' | 'retry' | 'link'`; `result`: `'pushed' | 'pulled' | 'noop' | 'failed'`; index `(project_id, id)` on runs), add `'github'` to `VersionKind` and nullable `source` text to `versions`, then `pnpm db:generate` → `drizzle/0005_*.sql`; extend `tests/unit/migration.test.ts` if it enumerates tables
- [X] T004 [P] Create the fake GitHub `tests/fake-github/server.ts` per research R11: in-memory repos with real git SHA-1 blobs/trees/commits; endpoints `GET /login/oauth/authorize` (auto-approve → redirect with `code`), `POST /login/oauth/access_token` (code and refresh_token grants), `POST /app/installations/:id/access_tokens`, `GET /user`, `GET /user/installations`, `GET /user/installations/:id/repositories` (with `permissions.push`), `GET /repos/:o/:r`, `GET /repositories/:id`, `GET /repos/:o/:r/branches`, `GET|PATCH /repos/:o/:r/git/ref(s)/heads/:b` (PATCH refuses non-fast-forward with 422 unless `force`), `POST /repos/:o/:r/git/refs`, `GET|POST git/trees` (`recursive=1`, `base_tree`, `sha: null` deletes), `GET|POST git/blobs`, `GET|POST git/commits`, `GET /repos/:o/:r/compare/:a...:b`; test helpers `addUser`, `addInstallation`, `addRepo`, `commitFiles(repo, branch, files, author)`, `revoke(user)`, `setPush(user, repo, bool)`, `failNext(status)`, request counter; `start()` returns `{ url, stop }`
- [X] T005 [P] In `playwright.config.ts` start the fake GitHub as a web server (a tiny `tests/fake-github/main.ts` that listens on a fixed port and seeds one user, one installation and two repos) and set on the app server `GITHUB_APP_ID=1`, `GITHUB_APP_SLUG=overtree-test`, dummy client id/secret, a test PEM private key from `tests/fake-github/key.pem`, `GITHUB_API_URL`/`GITHUB_URL` to the fake, `GITHUB_GRACE_MS=1500`, `GITHUB_LONG_MS=6000`, `GITHUB_PULL_MS=1500`, `GITHUB_TICK_MS=250` (quickstart.md)

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: config, tokens, API client, path mapping, shared hooks

- [ ] T006 Create `src/lib/server/github/config.ts`: `githubConfig()` → `null` when `GITHUB_APP_ID` unset, else `{ appId, slug, clientId, clientSecret, privateKey (literal \n → newline), apiUrl, webUrl, graceMs=120000, longMs=1800000, pullMs=120000, tickMs=15000 }`; `githubConfigProblem()` naming the first missing variable when only some `GITHUB_APP_*` are set; call it in `server.ts` next to `authConfigProblem` (exit 1) (FR-004)
- [ ] T007 [P] Create `src/lib/server/github/crypto.ts`: `seal(text)`/`open(buf)` AES-256-GCM with key `HKDF-SHA256(privateKey, 'overtree-github-tokens')` (research R10); `signState({ userId, return, nonce, exp })`/`verifyState(s)` HMAC-SHA256 with the client secret, 10-minute expiry
- [ ] T008 Create `src/lib/server/github/api.ts`: `gh(token, method, path, body?)` over `fetch` with `apiUrl`, JSON, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version`; `GitHubError { status, reason }` mapping 401 → `needs-reconnect`, 403/404 → `needs-access`, 409/422 → `conflict`, 5xx/network → `retry`, with plain-language messages (never including tokens); `installationToken(installationId)` and user-token `exchangeCode(code)`/`refreshUserToken(refresh)` via `@octokit/auth-app` with `baseUrl` pointing at `apiUrl`/`webUrl` (research R3)
- [ ] T009 [P] Create `src/lib/server/github/paths.ts`: `gitBlobSha(bytes)` (`sha1("blob <len>\0"+bytes)`); `projectFiles(pid)` → `Map<path, { id, kind, bytes() , sha() }>` from the files table (text via `currentText`, binary via `readBlob`; folders omitted, R8); `isIgnored(path, patterns, allPaths)` with `matchesGlob` (or picomatch, research R8) and the `<compile-output-pdf>` rule; `DEFAULT_IGNORE` = `['.github/**', '**/*.aux', '**/*.log', '**/*.out', '**/*.toc', '**/*.fls', '**/*.fdb_latexmk', '**/*.synctex.gz', '**/*.bbl', '**/*.blg', '<compile-output-pdf>']`; `readBase(link)`/`writeBase(map)` storing the `{ [path]: { sha, hash? } }` JSON via `putBlob` (research R7)
- [ ] T010 [P] Add `'github'` to `ProjectEvent` in `src/lib/server/access.ts`
- [ ] T011 In `src/lib/server/history.ts` let `closeVersion(pid, kind, { restoredFrom?, source? })` store `source` (JSON) and allow `kind: 'github'` (no empty github versions); expose `source` in `VersionInfo` (`src/lib/history-types.ts`) as `github?: { commits: { sha, author, message }[]; notes: { path, reason }[] }`
- [ ] T012 Extract the tree-applying part of `restoreVersion` in `src/lib/server/restore.ts` (creates / moves / binaries / deletes / main in one transaction + `logTree` + kicks + `broadcast('tree')`) into an exported `applyTree(pid, actor: string | null, plan)` reused by pull; no behaviour change, `tests/unit/restore.test.ts` stays green
- [ ] T013 In `src/lib/server/projects.ts` `deleteProject` delete `github_runs` and `github_links` rows of the project (before `projects`), and in `duplicateProject` copy nothing GitHub-related (edge cases); in `src/lib/server/auth.ts` (or wherever users are deleted) delete the user's `github_accounts` row
- [ ] T014 [P] Add `github: githubConfig() ? { configured: true } : null` to `src/routes/api/me/+server.ts` and its client type in `src/lib/auth.svelte.ts`
- [ ] T015 [P] Vitest `tests/unit/github-foundation.test.ts`: seal/open round trip and tamper rejection; state signature/expiry; `gitBlobSha` equals `git hash-object` for a known string; ignore defaults (`.github/workflows/x.yaml`, `a/b.aux`, `main.pdf` with `main.tex` beside it ignored; `figure.pdf` alone not ignored); `githubConfigProblem` for partial env; API error mapping against the fake (401/403/404/422/500)

**Checkpoint**: GitHub plumbing exists; no UI yet

---

## Phase 3: User Story 1 - Connect GitHub and link a project (Priority: P1) 🎯 MVP

**Goal**: owner connects a GitHub account (Clerk sign-in unchanged), picks a granted repo + branch, links the project; members see the link

**Independent Test**: spec US1 Independent Test, against the fake

- [ ] T016 [US1] Create `src/lib/server/github/accounts.ts`: `saveAccount(userId, tokens, ghUser)` (sealed tokens), `disconnect(userId)` (delete row; links using it → `needs-reconnect`, broadcast `github`), `userToken(userId)` (refresh when `access_expires_at` is < 5 min away; refresh failure → delete-free `needs-reconnect` error), `listRepos(userId)` (`/user/installations` + `/user/installations/:id/repositories`, only `permissions.push`, grouped by account; contracts "GET /api/github/repos"), `branches(userId, owner, repo)`, `checkAccess(link)` (`GET /repositories/:repo_id` with the linker's user token; updates `repo` on rename/transfer; sets `last_check_at`; returns `ok | needs-reconnect | needs-access`) (research R2)
- [ ] T017 [US1] Routes `src/routes/api/github/connect/+server.ts` (302 with signed state + cookie, `return` must be a same-origin path), `src/routes/api/github/callback/+server.ts` (state ↔ cookie ↔ signed-in user else 403; code exchange; `GET /user`; save; re-check that user's `needs-reconnect` links; redirect), `src/routes/api/github/account/+server.ts` (GET/DELETE), `src/routes/api/github/repos/+server.ts`, `src/routes/api/github/repos/[owner]/[repo]/branches/+server.ts`; every route 404 when unconfigured (FR-001–004)
- [ ] T018 [US1] Create `src/lib/server/github/links.ts`: `getStatus(pid, userId)` → `GitHubStatus` per contracts (display state per data-model "Derived values"; `ignore` only for the owner; `canManage` owner; `canSync` owner/editor), `linkRepo(pid, ownerId, { installationId, repoId, branch, ignore? })` (owner only, access check, branch exists else 422, `status: 'pending'`, base reset), `patchLink` (ignore ≤ 50 patterns ≤ 200 chars, branch change → pending, `dismissNote`), `unlink(pid)`; each change broadcasts `github` (FR-005–007, FR-010)
- [ ] T019 [US1] Route `src/routes/api/projects/[pid]/github/+server.ts`: GET (any member), PUT/PATCH/DELETE (owner, 403 otherwise) (FR-005)
- [ ] T020 [US1] Confirm in `src/routes/api/projects/[pid]/github/confirm/+server.ts` + `confirmLink(pid, 'merge')` in `links.ts`: first-sync base := GitHub head commit with the head tree's entries (sha only, no `hash`) restricted to non-ignored paths that also exist in the project (empty branch/repo: base commit null, map empty; the first push then creates the branch with `POST git/refs`); sets `active` and requests a sync via `sync.ts` (`trigger: 'link'`). Effect: project files win where both exist, GitHub-only files get pulled, identical files untouched (FR-008 semantics; the preview UI and import are US5)
- [ ] T021 [P] [US1] Client state `src/lib/github.svelte.ts`: `status` fetched on load and on `github` presence events, `account`, `repos`, actions (connect URL, link, unlink, patch, confirm, push, pull)
- [ ] T022 [US1] `src/lib/components/GitHubDialog.svelte` steps 1, 2 and 4 of contracts/ui.md (connect text naming the Overtree email, picker grouped with search and private lock, empty state with Grant access + Refresh list, branch select, Link repository, Unlink confirm, ignore textarea with Reset to defaults); open it from a new "GitHub…" item for the owner in the editor's project menu and on return with `?github=1`; hidden when `/api/me` says `github: null`
- [ ] T023 [P] [US1] Vitest `tests/unit/github-link.test.ts`: connect via fake OAuth stores sealed tokens and keeps the Clerk/test user; state mismatch 403; picker excludes `push: false` repos and repos outside installations; editor/reader PUT/PATCH/DELETE → 403, GET shows the link; unlink deletes nothing on GitHub (fake request log has no writes); disconnect → `needs-reconnect`; revoked on the fake → access check → `needs-reconnect`; unconfigured → 404 everywhere (US1 #1–6, FR-001–007, FR-010)

**Checkpoint**: a project can be linked; nothing syncs yet

---

## Phase 4: User Story 2 - Overtree changes reach GitHub, once per session (Priority: P1)

**Goal**: session-end and long-session pushes, one commit per push, never force, filtered files untouched

**Independent Test**: spec US2 Independent Test

- [ ] T024 [US2] Create `src/lib/server/github/push.ts`: `push(link, { title?, trigger, userId? })` per research R4: head ref; head ≠ base → call `pull(link)` (Phase 4 stub: if only ignored paths changed between base and head, advance `base_commit`; otherwise throw `conflict`; Phase 5 replaces it) and re-read; base commit null → create the branch with `POST git/refs` after the commit; an **empty repository** refuses Git Data calls (409 "Git Repository is empty."), so there the first file goes in with one Contents API `PUT /repos/{o}/{r}/contents/{path}` (creates the branch and first commit) and the rest follows as the normal Git Data commit on top (ponytail: first sync to an empty repo makes two commits); add the Contents `PUT` endpoint to `tests/fake-github/server.ts`; changes = project files vs base map by git SHA, `isIgnored` applied to both sides (a base entry that matches a pattern added later is neither pushed nor deleted, FR-013) (adds, edits, deletes; renames as delete + add); none → `noop`; binaries via `POST git/blobs`, texts inline; `POST git/trees` with `base_tree`; `POST git/commits` (parent head); `PATCH ref` with `force: false`, on 422 retry from the top ≤ 3 times; on success `base := pushed map`, `base_commit`, `watermark := max history_log id read before building`, `last_push_at`; insert a `github_runs` row (FR-012–014)
- [ ] T025 [US2] Commit message builder in `push.ts` per research R9: default title (`Update a.tex`, `Update a.tex and N more files`) or the trimmed custom title (≤ 72 chars), body with up to 20 `M/A/D` lines then `…and N more`, `Co-authored-by: <name> <email>` for distinct non-null `user_id`s of `history_log` rows in `(watermark, newWatermark]`, users without email named in the body (FR-015)
- [ ] T026 [US2] Create `src/lib/server/github/sync.ts` per research R5/R12: `requestSync(pid, { kind, trigger, title?, userId? })` with the per-project queue (one running, one collapsed `next`, push wins over pull, custom title kept) returning the run's result; `presence(pid, count)` (0→1: request pull; →0: `sessionEndAt = now + graceMs`; reconnect clears it); `tick()` every `tickMs`: due session ends → push; open + unpushed + `now - last_push_at ≥ longMs` + a version closed after `last_push_at` → push; open + `now - last_pull_at ≥ pullMs` → pull; `failing` links whose `next_attempt_at` passed → retry; before any run, `checkAccess` if `last_check_at` older than 1 h; failures: `retry`/`conflict` → `failing`, `fail_count++`, `next_attempt_at = now + min(60, 2^(n-1)) min`, `error`; `needs-*` → that status, no retry; success → `active`, `fail_count = 0`; every state change broadcasts `github`; `startSync()` at startup: push every active link with unpushed changes and pull every active link, 2 s apart; timers `unref()`; stops when the server's db changes (like history's sweeper) (FR-011, FR-016, FR-022–024)
- [ ] T027 [US2] Wire `src/lib/server/collab.ts`: Hocuspocus `onConnect`/`onDisconnect` for `project:<pid>` documents call `presence(pid, document.getConnectionsCount())` (after the connection is added/removed); call `startSync()` from `attachCollab` when `githubConfig()` is set
- [ ] T028 [US2] Unpushed detection `hasUnpushed(link)` in `sync.ts`: `link.pending_push` or `exists(history_log where project_id and id > watermark and user_id is not null)` (research R7); `flushHistory()` before reading; a successful push clears `pending_push`
- [ ] T029 [P] [US2] Vitest `tests/unit/github-push.test.ts` (short timings): two users edit two files then both providers disconnect → after grace exactly one commit with both files and two `Co-authored-by` trailers (US2 #1, #6); reconnect within grace → no push (#2); continuous edits longer than `longMs` with a version closing → a push while connected (#3); trigger without changes → no commit (#4); add/rename/move/delete/binary upload all in one commit, no compile output (#5); restore (008) is pushed like an edit; ref PATCH never sent with `force: true` (#7); `.github/workflows/render-latex.yaml` and `main.pdf` committed on the fake before the push remain identical afterwards (FR-013); restart (`stop` + `start` on the same data dir) with unpushed changes → pushed by `startSync` (FR-023)

**Checkpoint**: Overtree → GitHub works end to end (with GitHub-side edits to tracked files failing as `conflict` until Phase 5)

---

## Phase 5: User Story 3 - GitHub changes flow back into Overtree (Priority: P1)

**Goal**: pulls on open, every 2 minutes while open, before pushes and on demand; diff3 merge into live docs; tree changes; `github` versions

**Independent Test**: spec US3 Independent Test

- [ ] T030 [US3] Create `src/lib/server/github/pull.ts` steps 1–4 of research R6: head; equal → `last_pull_at` only; recursive tree; filter with `isIgnored` over the union of paths, on both the head tree and the base map; classify added / changed / deleted vs base, exact-SHA renames; only ignored paths changed → `base_commit := head` (keep base map for non-ignored paths), no version, no note (SC-005); download changed blobs with `UPLOAD_MAX_FILE_MB` cap (over → skip + note `skipped-size`); paths failing `validateName` → skip + note `skipped-name`
- [ ] T031 [US3] Text merge in `pull.ts`: for each text file changed on GitHub and present in the project, inside `openDirectConnection(id, {}).transact(doc => …)` read ours, `diff3Merge(ours, baseText, theirs)` line-based, build the merged text (overlaps: `% <<<<<<< Overtree` / ours / `% ======= GitHub <short sha>` / theirs / `% >>>>>>>`) and apply with `editText` (FR-017, FR-018); base text from the base map's `hash` blob, or fetched by `sha` with `GET git/blobs` when the entry has no `hash` (first sync) (research R6); overlap → note `overlap`
- [ ] T032 [US3] Tree changes in `pull.ts` through `applyTree(pid, null, plan)`: added text files (create row + `textUpdate` into `updates`, like import), added/changed binaries (`putBlob`, row), folders created as needed, exact renames as moves, deletions (except files changed in Overtree since base → kept, note `kept-deleted`), binaries changed on both sides → keep ours, note `kept-binary`; folders emptied by GitHub deletions removed; project file limit respected (FR-018, FR-019)
- [ ] T033 [US3] Finish `pull.ts`: commits list from `compare/{base}...{head}` (first 20: sha, author name, first message line); `closeVersion(pid, 'github', { source: { commits, notes } })` when anything changed (FR-021); `base := filtered GitHub tree map` with base texts stored as blobs, `base_commit := head`, `last_pull_at`; link `note` set when notes exist; `pending_push := 1` when any merged/kept file differs from GitHub's version (overlap, kept-deleted, kept-binary) so the result is pushed (data-model `pending_push`); runs row (`pulled`/`noop` not stored for periodic, per data-model); broadcast `github`; replace the Phase 4 stub in `push.ts`
- [ ] T034 [US3] Show `github` versions in `src/lib/components/HistoryTimeline.svelte` per contracts/ui.md "History timeline" (GitHub mark, "Merged from GitHub", first message + short SHA, commit authors' names, warning chip for noted files)
- [ ] T035 [P] [US3] Vitest `tests/unit/github-pull.test.ts`: while a provider types in paragraph 1, a fake commit changes paragraph 5 of the same file → after a pull both changes present, the provider's doc converges, typing not lost (US3 #1, #3, SC-004); project opened after GitHub commits → pulled on the presence connect (#2); same lines changed on both sides → both kept between `%` markers, note `overlap`, document still compiles as text (#4); GitHub add/rename/delete of files, delete of a file edited in Overtree kept (#5); image changed on both sides → ours kept and pushed next (#6); after an overlap merge the marked-up text is pushed on the next session end without further edits (H1); 20 rounds of push + fake "workflow" commit adding `main.pdf`/`chapter.pdf` → zero files pulled, zero notes, zero `github` versions, PDFs untouched on the fake (#7, SC-005); a pull creates a `github` version with the commits and restoring an earlier version works (#8); push after a GitHub edit to a tracked file pulls first, then commits on top (US2 #7); branch force-pushed on the fake (base commit unreachable) → link back to `pending` (edge case)
- [ ] T036 [US3] Handle the rewritten-history edge case in `pull.ts`: `compare` 404 / base commit unknown → `status := 'pending'`, base reset, error "The branch history was rewritten on GitHub; review and confirm the sync again."

**Checkpoint**: two-way sync complete on the server

---

## Phase 6: User Story 4 - Status indicator and manual sync (Priority: P2)

**Goal**: top-bar indicator for everyone; Push now (with title) and Pull now for editors/owner; failure reasons and retries visible

**Independent Test**: spec US4 Independent Test

- [ ] T037 [US4] Routes `src/routes/api/projects/[pid]/github/push/+server.ts` and `pull/+server.ts` per contracts (owner/editor; readers 403; link not active → 409; `title` ≤ 72 chars after trim; waits ≤ 30 s for the run → 200 result, else 202) (FR-026)
- [ ] T038 [US4] Include the last 20 `github_runs` (with requesting user's name) in `getStatus` for members (contracts `runs`)
- [ ] T039 [US4] `src/lib/components/GitHubStatus.svelte` per contracts/ui.md "Top bar indicator": states table, `data-state`, popover with repo/branch link, last synced commit link and relative time, error + "Retrying at", owner fix-it actions (Reconnect GitHub, Choose branch, Create branch, Grant access, Take over link), merge note with Dismiss (owner), title input + Push now + Pull now (owner/editor only), Settings… (owner), collapsible runs list; mount it in `src/lib/components/TopBar.svelte` left of History (FR-025)
- [ ] T040 [US4] Route `src/routes/api/projects/[pid]/github/create-branch/+server.ts` (owner; link `needs-access` with branch-not-found: create the branch from the repository default branch head via `POST git/refs`, or a root commit of the project files when the repo is empty, then `active` + push)
- [ ] T041 [US4] Ownership transfer in `src/lib/server/projects.ts` `transferOwnership`: link → `owner-changed` and broadcast `github`; `PATCH …/github { confirmOwner: true }` in `links.ts` takes the link over with the new owner's connection after `checkAccess` (409 without connection/access) (FR-027)
- [ ] T042 [P] [US4] Vitest `tests/unit/github-sync.test.ts`: Push now with title uses it as the commit title (US4 #2); Pull now (#3); reader push/pull → 403 (#4); fake `failNext(500)` → `failing` with reason, `next_attempt_at` grows 1→2→4 min, unpushed kept, success after recovery (#5, SC-007); fake 403 / branch deleted → `needs-access` and no retry; revoked user → `needs-reconnect`; three triggers during a running push → exactly one follow-up run (#6, FR-022); ownership transfer → `owner-changed`, no syncs until the new owner confirms (FR-027); status JSON never contains a token string (SC-006)
- [ ] T043 [US4] Playwright `tests/e2e/github.spec.ts` (fake GitHub): owner connects and links via the dialog (US1), indicator goes `pending` → `in-sync`; edit → `unpushed`; Push now with title → `in-sync` and the commit title on the fake; reader context sees the indicator without Push/Pull; a fake commit to `main.tex` appears in two open contexts within the pull interval and History shows "Merged from GitHub"; a failing fake shows "Sync failed" with the reason

**Checkpoint**: the feature is usable from the UI end to end

---

## Phase 7: User Story 5 - Start from what is already in the repository (Priority: P3)

**Goal**: first-sync preview with confirmation; import into an empty project

**Independent Test**: spec US5 Independent Test

- [ ] T044 [US5] `preview(pid)` in `links.ts` + route `src/routes/api/projects/[pid]/github/preview/+server.ts` (owner, link `pending`): head tree vs project files → `overwrite`, `same`, `addToGitHub`, `addToProject`, `githubOnly`, `projectEmpty`, lists capped at 500 with `truncated` (FR-008)
- [ ] T045 [US5] `confirmLink(pid, mode)`: `merge` stays as in T020; add `import` (409 unless `projectEmpty`) = create the branch's non-ignored files as project files (text editable, others as blobs, `UPLOAD_MAX_FILE_MB` and `PROJECT_MAX_FILES` limits, main file = `main.tex` if present else the first root `.tex` with `\documentclass`), base := head; runs row `kind: 'import'`; failure keeps `pending` with `error` (FR-008, FR-009)
- [ ] T046 [US5] GitHubDialog step 3 (preview groups, Sync now, Import from repository when the project is empty, Cancel → unlink) per contracts/ui.md
- [ ] T047 [P] [US5] Vitest in `tests/unit/github-link.test.ts`: repo with `main.tex`, `refs.bib`, `README.md`, `main.pdf`, `.github/workflows/render-latex.yaml` vs a project with `main.tex` → preview lists match the spec's Independent Test; confirm → first commit changes only `main.tex`, `refs.bib` and `README.md` pulled into the project (US5 #1); empty project + import → files present, main file set, in sync with head (US5 #2); ignored files never written on the fake afterwards (US5 #3); import into a non-empty project → 409; adding a pattern after linking that matches a synced file → the next push neither deletes nor changes it on GitHub and the project keeps it (M1, edge case); Playwright step in `tests/e2e/github.spec.ts` for the preview dialog

**Checkpoint**: all stories done

---

## Phase 8: Polish & cross-cutting

- [ ] T048 [P] `tests/unit/github.smoke.test.ts`, skipped unless `GITHUB_SMOKE=1`: with a real installation token, push to `GITHUB_SMOKE_REPO`, add a commit via the API (workflow stand-in adding a PDF), pull, assert nothing pulled; uses a throwaway branch `overtree-smoke-<timestamp>` and deletes it afterwards (quickstart.md)
- [ ] T049 [P] README.md: "GitHub sync" section (what it does, GitHub App setup steps and permissions from quickstart.md, env table, how sync timing works, that `Co-authored-by` exposes collaborators' emails in the repository)
- [ ] T050 [P] Grep the server for token leaks: no `console.*` with token values, `GitHubError` messages token-free; add `tests/unit/github-sync.test.ts` assertion that captured logs during a failing run contain no token (SC-006)
- [ ] T051 Run `pnpm check`, `pnpm test`, `pnpm exec playwright test github --project=chromium`; fix failures
- [ ] T052 Add row 012 "GitHub repository sync" to `specs/ROADMAP.md` (Phase 3 table, status `done` when landing, paragraph with the feature description) and remove "Git or GitHub sync" from "Later / not planned yet"

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → US1 (Phase 3) → US2 (Phase 4) → US3 (Phase 5) → US4 (Phase 6) → US5 (Phase 7) → Polish.
- US2 needs a linked, active project (US1). US3 replaces the pull stub used by US2's push and shares `sync.ts`. US4's routes and UI only need US2/US3's `requestSync`. US5 extends US1's confirm.
- T004 (fake GitHub) blocks every test task.

## Parallel examples

- Phase 1: T002, T004, T005 alongside T001/T003.
- Phase 2: T007, T009, T010, T014 in parallel after T006; T015 once they exist.
- US1: T021 alongside T016–T019; T023 after T019.
- US4: T039 (UI) alongside T037/T038/T040/T041; T042 and T043 at the end.

## Implementation Strategy

MVP = Phases 1–5 (link + two-way sync on the server, verified by Vitest; the dialog from US1 makes it usable). Then US4 (indicator, manual actions, failure UX), then US5 (preview/import), then polish. Each phase ends with `pnpm check`, its Vitest files green (and its Playwright spec where it has one), and one commit `feat(012): phase N <name>`.
