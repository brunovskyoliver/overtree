# Feature 012: GitHub repository sync
Stage: done
Updated: 2026-10-07

## Decisions
- Feature numbered 012: 009 is a merged roadmap marker and 010/011 are reserved for planned roadmap rows.
- Branch `012-github-sync` created from main (b8b8098).

- Gate 1 (user: A,C,B,A): push on session end + every 30 min in long sessions + Push now; TWO-WAY sync (GitHub edits merged into live Yjs docs); Co-authored-by trailers with emails; preview+confirm on first link, import into empty project.
- Direction change from 2:C: spec reworked (new US3 pull, FR-016–021, "not pulled" patterns for workflow PDFs).
- Gate 2: user replied "gk", read as `go` (full implementation). Real-GitHub smoke test skipped (no App provided); compile e2e depends on OrbStack running.
- Applied H1 (pending_push), H2 (first-sync base in T020), M1 (filter both sides), M2 (repo id lookup). L1/L2 left as noted.
- Phase 2: path filters use `picomatch` with `dot: true`, not `node:path` `matchesGlob` (no dot option, so `**/*.aux` missed `.x/a.aux`; experimental on some Node 24). User moves (`moveUser`, the only place a users row is deleted) move the GitHub account, links and runs to the new id instead of deleting them.
- Empty repositories refuse Git Data calls (found by phase 1's faithful fake): first push to an empty repo seeds one file with the Contents API, then the normal Git Data commit (two commits once). Added `@octokit/request` (auth-app needs `request.defaults({ baseUrl })`).
- Phase 3: the editor has no project menu (ProjectActions is the dashboard's row menu), so the dialog opens from a "GitHub" button in the top bar left of History: always for the owner, for other members only when linked (read-only view). Phase 6's indicator can replace it. GitHub errors in routes map in `api()`: needs-reconnect 409 + `reconnect`, needs-access 422, conflict 409, retry 502. OAuth authorize omits `redirect_uri` (GitHub uses the App's callback URL). `sync.ts` is a stub (`requestSync` records, answers `noop`); confirm 'merge' requests `pull` then `push` with trigger `link`, and Phase 4/5 must let that first pull diff against the base map even though head equals `base_commit`.
- Phase 4: presence uses Hocuspocus `connected` (fires after the connection is registered; `onConnect` runs before authentication) and `onDisconnect`, counting `document.getConnections()` (no direct connections). `pull.ts` stub compares base_commit...head with GitHub's compare (not tree vs base map) and keeps a head == base_commit fast path; Phase 5 must not keep that fast path for the first (`link`) pull. Empty repo: Contents API seed is stored as the base right away, then the normal commit. `hasUnpushed` moved to sync.ts; `repoPath`/`branchHead` moved to accounts.ts. Run rows are written by the scheduler (sync.ts) for every run except noop periodic pulls. Startup pushes links with unpushed changes (a push pulls first) and pulls the rest, rather than both. A GitHub edit to a tracked file fails pushes as `conflict` until Phase 5.
- Phase 5: the pull's "head = base commit" fast path applies only once `last_pull_at` is set (null after link/confirm, branch change and rewritten history), so the first pull after confirming diffs the whole tree and brings GitHub-only files in. Blobs (theirs and first-sync base texts) are downloaded before the project is read, so planning and `applyTree` run without an await. A pull closes open Overtree edits into an `edit` version first, so the `github` version holds only GitHub's changes. GitHub edits to a file deleted in Overtree bring it back (nothing dropped). Skipped files (name/size) stay out of the base map, so a push never deletes them on GitHub. Rewritten history: pull resets the link to `pending` and the scheduler leaves it there (no `failing`).
- Phase 6: the indicator (`GitHubStatus.svelte`) replaces Phase 3's top-bar button: unlinked → the owner's muted "GitHub" button (`#github-open`), linked → `#github-status` + popover for every member; the dialog stays reachable from "Settings…" and opens on the branch picker for "Choose branch". `GitHubLinkInfo.branchMissing` (not in the contract) tells the popover to offer "Create branch" (`needs-access` with pull's `branchGone` message). create-branch makes the branch at the default branch head and sets it as a first-sync base (project wins, GitHub-only files pulled later, like confirm), or lets the push make a root commit / Contents seed without one. Ownership transfer sets `owner-changed` in the transfer transaction; `disconnect` and a run finishing meanwhile leave `owner-changed` alone; taking over requests a catch-up sync. Push/pull answer 202 with `{ result: 'queued' }`. The page refetches the status 1.5 s after a local edit when `in-sync`, so "Not pushed yet" shows without waiting for a sync event. Fake GitHub: `deleteBranch`, `clearFailures`, remote `commit`.
- Phase 7: "projectEmpty" (import allowed) = no files, or only a root text `main.tex` whose current text is a template's starter text (for the project's title or the default title; `isStarterText` in templates.ts). Folders, any other file or an edited starter make it non-empty (409). A renamed project's untouched starter only counts if it still has the default-title text. Import reuses the starter document for a text `main.tex` from the repository (open editors keep their document; text set through Hocuspocus as a system edit), otherwise deletes it. Names Overtree can't use and files over `UPLOAD_MAX_FILE_MB` are skipped and listed in the merge note (kept out of the base map, like a pull); more than `PROJECT_MAX_FILES` entries fails with 413 before downloading. Import writes nothing to GitHub: base := head with each file's text stored, `last_pull_at` set, one `github` version and one `import` run (trigger `link`). Preview compares exactly as confirm 'merge' does (head tree vs project by git blob SHA, `ignoreFilter` over both sides); project-only paths matching a pattern aren't listed (never pushed); paths ignored but present in both are listed under "Stays on GitHub only".

## Log
- 2026-10-07 specify: spec.md (4 stories, 21 FRs) + checklists/requirements.md (all pass).
- 2026-10-07 clarify: 4 answers encoded; spec rewritten for two-way sync (5 stories, 27 FRs).
- 2026-10-07 plan: plan.md, research.md (R1–R13), data-model.md, contracts/http-api.md + ui.md, quickstart.md. GitHub App + installation tokens, Git Data API push, diff3 pull into Yjs, fake GitHub for tests.
- 2026-10-07 tasks: tasks.md 52 tasks / 8 phases (MVP = 1–5).
- 2026-10-07 analyze: 0 critical, 2 high, 2 medium, 2 low; checklist 16/16; waiting at gate 2.
- 2026-10-07 phase 1 setup (T001–T005): deps, env, schema + 0005 migration, fake GitHub + self-test, Playwright wiring. d8c6ffd. check clean; vitest 295 pass, 31 fail = Docker-only (OrbStack off).
- 2026-10-07 phase 2 foundational (T006–T015): config, crypto, api, paths, applyTree extraction, cleanup hooks, /api/me flag. 6d7d2ef. check clean; vitest 307 pass, 31 Docker-only fail.
- 2026-10-07 phase 3 US1 (T016–T023): accounts.ts, links.ts, sync.ts stub, connect/callback/account/repos/branches routes, project link + confirm routes, github.svelte.ts, GitHubDialog + top-bar button. check clean; vitest 350 pass, 31 Docker-only fail; playwright github 1 pass. b1ceda1.
- 2026-10-07 phase 4 US2 (T024–T029): push.ts (Git Data commit, Contents seed for empty repos, R9 message), pull.ts stub, sync.ts scheduler (queue, presence, session-end/long/periodic/retry, startSync), collab presence hooks, fake Contents PUT. check clean; vitest 363 pass, 31 Docker-only fail; playwright github 1 pass. 3266cab.
- 2026-10-07 phase 5 US3 (T030–T036): pull.ts (tree vs base map, diff3 into live docs with % markers, applyTree for tree changes, kept-deleted/kept-binary/skipped notes, pending_push, github versions, rewritten history → pending), timeline shows github versions, push merges instead of conflict. check clean; vitest 373 pass, 31 Docker-only fail; playwright github 2 pass. f188924.
- 2026-10-07 phase 6 US4 (T037–T043): push/pull/create-branch routes (30 s wait, 202), runs in status, GitHubStatus indicator + popover replacing the top-bar button, owner-changed on transfer + confirmOwner take-over, github-sync.test.ts, Playwright US4. check clean; vitest 392 pass, 31 Docker-only fail; playwright github 3 pass, toolbar/history/permissions 11 pass. b4ca497.
- 2026-10-07 phase 7 US5 (T044–T047): preview route + `preview()`, confirm `import` (empty = untouched starter), GitHubDialog step 3 preview groups + Import, US5 Vitest (7) + Playwright preview/import. check clean; vitest 402 pass, 31 Docker-only fail; playwright github 4 pass. 8ade527. 8ade527.
- 2026-10-07 phase 8 polish (T048–T052): github.smoke.test.ts (skipped unless GITHUB_SMOKE=1), README "GitHub sync", token-leak grep clean + echoed-token test, ROADMAP row/paragraph 012. check clean; vitest 403 pass, 1 skipped (smoke), 31 Docker-only fail; playwright github 4 pass. 234e746.
- 2026-10-07 phase 9 convergence (T053–T058): failing links still pulled on open/periodically with push backoff kept; needs-access re-check (callback incl. Setup URL without code, hourly tick, PATCH recheck + "Check again") keeps the base; branch protection named, not raced; `.git` paths and >100 MB files skipped and noted on push; 403/404/301 re-resolved by repo id with one retry; fake `protect`/`moveRepo` (301 or 404); edge-case tests. check clean; vitest 446 pass, 1 skipped (smoke); playwright github 4 pass.
- 2026-10-07 fix US1 e2e on WebKit: test-state leak, not a Safari bug. App + fake GitHub are shared across browser projects, so whichever project ran US1 second found USER already connected and `octo/paper` already holding main.tex. US1 now starts with a fresh `octo/paper` and a disconnect; cleanup unlinks send an `origin` header (SvelteKit CSRF had 403'd them silently). playwright github 12/12 (chromium/firefox/webkit), webkit US1 x5; check clean; github-link vitest 40 pass.
- 2026-10-07 converge: 6 tasks appended (T053–T058: failing links keep pulling, needs-access recovery keeping base, branch protection message, unpushable paths skipped, repo rename/transfer by id, edge-case tests); implemented in phase 9 cedbebe. One round only.
- 2026-10-07 full run: collab5 stress test hung on this branch (test race: keydown listener registered without waiting); fixed in 6c91aae. Playwright chromium full suite 171/172 before that fix, collab5 then 2/2.

## Report

**What changed** (branch `012-github-sync`, not pushed)

| Phase | Commit | Content |
|---|---|---|
| docs | 69edb1e, 90d64c3, ace6f1b | spec (two-way after gate 1), plan, research, data model, contracts, tasks, analysis fixes |
| 1 Setup | d8c6ffd | `@octokit/auth-app`, `@octokit/request`, `node-diff3`; env vars; migration 0005 (github_accounts, github_links, github_runs, versions.source, kind `github`); fake GitHub server + Playwright wiring |
| 2 Foundational | 6d7d2ef | `github/config, crypto, api, paths`; `applyTree` extracted from restore; cleanup hooks; `/api/me` flag |
| 3 US1 connect & link | b1ceda1 | GitHub App user authorization (Clerk sign-in unchanged), repo picker (push-capable repos only), owner-only link, confirm with first-sync base, GitHubDialog |
| 4 US2 push | 3266cab | Git Data API single commit on head, never force, Contents API seed for empty repos, Co-authored-by trailers, scheduler (2 min grace after last leave, 30 min long sessions, retries/backoff, startup) |
| 5 US3 pull | f188924 | tree vs base, diff3 into live Yjs docs with `%` conflict markers, tree changes, kept-deleted/kept-binary notes, pending_push, "Merged from GitHub" versions, rewritten-history → pending |
| 6 US4 status | b4ca497 | top-bar indicator + popover, Push now (title) / Pull now, create branch, ownership-transfer takeover |
| 7 US5 preview/import | 8ade527 | first-sync preview groups, import into an empty project |
| 8 Polish | 234e746 | smoke test (skipped without `GITHUB_SMOKE=1`), README "GitHub sync", token-leak test, ROADMAP row 012 |
| 9 Convergence | cedbebe | T053–T058 |
| fixes | 6c91aae, 3efccda | collab5 test race; GitHub e2e isolation across browser projects |

**How it was verified**
- `pnpm check`: 0 errors, 0 warnings.
- `pnpm test`: 446 passed, 1 skipped (real-GitHub smoke test), with Docker running.
- `pnpm exec playwright test github` (Chromium, Firefox, WebKit): 12/12.
- Full Playwright suite on Chromium: 171/172; the one failure (collab5) was a test race, fixed and rerun 2/2 green.
- All against the in-process fake GitHub; no real GitHub was contacted.

**What is left**
- Real-GitHub check: create a GitHub App (quickstart.md "Manual against real GitHub"), set the five `GITHUB_APP_*` env vars, link the repository with `render-latex.yaml`, and optionally run `tests/unit/github.smoke.test.ts` with `GITHUB_SMOKE=1`.
- Not tested: pushing a file over 100 MB (code path exists, too heavy for a unit test).
- Accepted deviations: access revoked on GitHub is noticed at the hourly check; a failed first push after "Sync now" goes to `failing` (not `pending`); "Change…" switches branch only (switching repo = unlink + link); empty repo first sync makes two commits.
- Firefox/WebKit runs of the full non-GitHub suite were not repeated (only the GitHub spec ran there).
- Deploy to the AI VM not done (not requested).
