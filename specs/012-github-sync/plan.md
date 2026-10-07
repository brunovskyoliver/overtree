# Implementation Plan: GitHub repository sync

**Branch**: `012-github-sync` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/012-github-sync/spec.md`

## Summary

A GitHub App (registered once by the instance admin) gives each Overtree user an optional GitHub connection, separate from their Clerk sign-in. The owner links a project to one repository and branch they can push to. A per-process scheduler pushes once per editing session (2 minutes after the last collaborator leaves, every 30 minutes in long sessions, or on "Push now") and pulls when the project opens, every 2 minutes while it is open, before every push, and on "Pull now". Pushes use the Git Data API: one commit on top of the current head, `base_tree` inheritance so GitHub-only files (the workflow's PDFs, `.github/`) are never touched, no force. Pulls compare GitHub's tree with the last agreed state and three-way merge (diff3) changed text into the live Yjs documents through Hocuspocus, so concurrent typing survives. Overlaps keep both sides between `%` comment markers. Tree changes reuse restore's tree operations, and each pull that changes something is recorded as a "Merged from GitHub" history version. Commits carry `Co-authored-by` trailers for the Overtree users whose history rows they include. Tests run against an in-process fake GitHub. Research: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 6 (strict), Node 24, Svelte 5 runes, SvelteKit 3

**Primary Dependencies**: existing (Hocuspocus 4.7, Yjs 13.6, Drizzle, better-sqlite3, fast-diff) + new `@octokit/auth-app` (R3) and `node-diff3` (R6)

**Storage**: SQLite migration `0005` (`github_accounts`, `github_links`, `github_runs`, `versions.source`, version kind `github`); base texts and base file maps as blobs in `data/blobs/`

**Testing**: Vitest against a fake GitHub HTTP server (`tests/fake-github/`); Playwright with the fake as a third web server (two contexts for the live merge); optional real-GitHub smoke test behind `GITHUB_SMOKE=1`

**Target Platform**: self-hosted Linux Docker image; Chromium, Firefox, WebKit

**Project Type**: web application (single SvelteKit app with an in-process WebSocket server)

**Performance Goals**: session-end push on GitHub < 3 min after the last user leaves (SC-002); GitHub change visible in open editors < 2 min (SC-004); push or pull of a 200-file project with ≤ 20 changed files < 10 s; a no-change periodic pull costs one API call (ref lookup)

**Constraints**: no second write path for text (pulls are Yjs edits through Hocuspocus); never force-push; GitHub tokens server-side only and encrypted at rest; GitHub API rate limit 5,000 requests/h per installation (at the 2-minute pull interval that is 30 calls/h per open project)

**Scale/Scope**: projects up to 2,000 files (003 limit) and 50 MB per file; a handful of linked projects per instance; one Node process

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
|---|---|---|
| I. Collaboration is the data model | ✅ | Pulled text is merged into the live document as one Yjs transaction via `openDirectConnection` + `editText` (R6). Binaries remain content-addressed blobs. |
| II. Self-hostable by one person | ⚠️ justified | GitHub is a second external service next to Clerk, **optional** and off unless `GITHUB_APP_*` are set (FR-004). No queue, no Redis: an in-process scheduler like history's sweep. See Complexity Tracking. |
| III. Untrusted compilation | ✅ | No new TeX execution; Overtree's compile output is never pushed; PDFs are built by the repository's own workflow. |
| IV. Test the seams | ✅ | Every acceptance scenario automated against the fake GitHub (R11); two browser contexts for the live merge; real-GitHub smoke test optional. |
| V. Simplicity first | ✅ with notes | Two small, focused libraries instead of custom JWT/diff3 code; no git binary, no working copies on disk. `ponytail:` single-process scheduler (R5), exact-match rename detection (R6), no empty folders on GitHub (R8), private-key-derived token key (R10). |
| Tech constraints | ✅ | SvelteKit/Svelte 5, Drizzle/SQLite, Clerk sign-in unchanged. |
| Workflow | ✅ | Branch `012-github-sync`; ROADMAP gets a row (the "Git or GitHub sync" item under Later). |

Post-design re-check: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/012-github-sync/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/http-api.md  contracts/ui.md
├── checklists/requirements.md
├── progress.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
drizzle/0005_*.sql                             # generated migration
src/env.ts                                     # + GITHUB_* variables
server.ts                                      # config check (partial GITHUB_* → exit), start scheduler
src/lib/server/
├── schema.ts            # + githubAccounts, githubLinks, githubRuns; versions.source; VersionKind 'github'
├── github/
│   ├── config.ts        # NEW: env → config | null, URLs, timings
│   ├── api.ts           # NEW: fetch wrapper, app/installation/user tokens (@octokit/auth-app), errors → reasons
│   ├── crypto.ts        # NEW: AES-GCM token sealing (R10), signed OAuth state
│   ├── accounts.ts      # NEW: connect/disconnect, refresh, repo listing, owner access check (R2)
│   ├── links.ts         # NEW: link/unlink/patch, preview, status (GitHubStatus), ownership hooks
│   ├── paths.ts         # NEW: git blob SHA, project ↔ path map, ignore patterns (R8)
│   ├── push.ts          # NEW: Git Data API commit (R4), commit message + co-authors (R9)
│   ├── pull.ts          # NEW: tree compare, diff3 merge into Yjs, tree ops, github version (R6)
│   └── sync.ts          # NEW: scheduler, presence hooks, per-project queue, backoff, startup (R5, R12)
├── collab.ts            # onConnect/onDisconnect of presence docs → github presence
├── history.ts           # closeVersion(kind 'github', { source }); version infos expose source
├── files.ts / restore.ts# tree-op helpers shared with pull (extract, no behaviour change)
├── projects.ts          # deleteProject removes link/runs; transferOwnership → owner-changed
└── access.ts            # ProjectEvent 'github'
src/routes/api/github/{connect,callback,account,repos,repos/[owner]/[repo]/branches}/+server.ts
src/routes/api/projects/[pid]/github/{+server.ts,preview,confirm,push,pull,create-branch}/+server.ts
src/routes/api/me/+server.ts                   # + github flag
src/lib/
├── github.svelte.ts                           # NEW: client state (status fetch on 'github' events, actions)
└── components/
    ├── GitHubStatus.svelte, GitHubDialog.svelte   # NEW
    ├── TopBar.svelte, ProjectActions.svelte (or the editor's project menu), HistoryTimeline.svelte   # changed
tests/fake-github/server.ts                    # NEW (R11)
tests/unit/github-link.test.ts, github-push.test.ts, github-pull.test.ts, github-sync.test.ts, github.smoke.test.ts
tests/e2e/github.spec.ts
compose.yaml, README.md                        # env vars + GitHub App setup
```

**Structure Decision**: same single SvelteKit app as 001–008. The GitHub code gets its own folder under `src/lib/server/github/` because it is a self-contained integration with nine modules; routes follow the existing `/api/projects/[pid]/…` pattern plus a per-user `/api/github/…`.

## Key flows

- **Connect**: dialog → `/api/github/connect` → GitHub authorize (+ optional install) → `/api/github/callback` → tokens sealed into `github_accounts` → back to the dialog.
- **Link**: picker (`/api/github/repos`) → `PUT …/github` (access check R2) → `pending` → preview → `confirm` (merge or import) → `active`.
- **Session**: presence connect → pull; edits → history log rows (user ids); last disconnect → +2 min → `push` = pull → diff vs base → blobs/tree/commit/ref → base & watermark updated → broadcast `github`.
- **GitHub edit**: periodic pull → tree compare → diff3 into live doc + tree ops → `github` version → base updated → broadcast `tree`/`history`/`github`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Second external service (GitHub) beside Clerk (Principle II) | The feature is a GitHub integration by definition | Nothing simpler exists. Mitigated: optional, off by default, no effect on the rest of the app when unset |
| Fake GitHub server in the test suite (~300 lines) | Principle IV: every acceptance scenario automated without network or secrets | Mocking `fetch` per test hides the real HTTP contract and duplicates fixtures per file |
| In-memory scheduler state (grace timers, run queue) | Session-end detection is inherently about live connections | A persisted job table adds a second source of truth. What must survive (unpushed changes, base) is in SQLite (R7), and startup re-derives the rest |
