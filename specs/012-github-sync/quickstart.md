# Quickstart: GitHub sync

## Automated (no GitHub needed)

The fake GitHub (`tests/fake-github/`, research R11) runs in-process for Vitest and as a third Playwright web server.

```sh
pnpm test                                 # unit: github-*.test.ts among the rest
pnpm exec playwright test github --project=chromium
pnpm check
```

Playwright sets `GITHUB_APP_*` to dummy values, `GITHUB_API_URL`/`GITHUB_URL` to the fake, and short timings: `GITHUB_GRACE_MS=1500`, `GITHUB_LONG_MS=6000`, `GITHUB_PULL_MS=1500`, `GITHUB_TICK_MS=250`.

Scenarios covered (each maps to a spec acceptance scenario):

| Test | Proves |
|---|---|
| `github-link.test.ts` | connect/disconnect, picker lists only `push: true` repos, owner-only link (US1), preview lists (US5 #1), import (US5 #2) |
| `github-push.test.ts` | session end + grace (US2 #1–2), long session (US2 #3), no empty commit (#4), adds/renames/deletes/binaries (#5), message + `Co-authored-by` (#6), workflow commit in between, never force (#7), filtered files untouched (US5 #3) |
| `github-pull.test.ts` | live merge while typing (US3 #1, #3), pull on open (#2), overlap keeps both with `%` markers + note (#4), tree changes and delete-vs-edit (#5), binary both sides (#6), workflow PDFs not pulled (#7, SC-005 20 rounds), `github` version (#8) |
| `github-sync.test.ts` | serialization and collapse (US4 #6), failures/backoff/reasons (US4 #5), restart with unpushed changes (FR-023), revoked owner → needs-reconnect (US1 #6), ownership transfer pause (FR-027), readers refused (US4 #4) |
| `tests/e2e/github.spec.ts` | the dialog flow, indicator states, Push now with title, Pull now, two browser contexts seeing a GitHub change live |

## Manual against real GitHub

1. Create a GitHub App (Settings → Developer settings → GitHub Apps → New):
   - Homepage URL: your Overtree URL. Callback URL and Setup URL: `<overtree>/api/github/callback`; tick "Request user authorization (OAuth) during installation" and "Redirect on update".
   - Webhook: off. Permissions: Repository → Contents *Read and write*, Metadata *Read*.
   - Generate a client secret and a private key.
2. Set in `compose.yaml` env (or `.env`): `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`. Restart.
3. Sign in with Google/email, open a project → project menu → **GitHub…** → **Connect GitHub** → install on your account or an organization, pick the repository with `.github/workflows/render-latex.yaml`.
4. Preview shows the workflow and `*.pdf` under "Stays on GitHub only". Sync.
5. Edit, close the tab, wait ~2 minutes: one commit on `main` with `Co-authored-by: <you>`; the workflow runs and commits PDFs; Overtree's next pull ignores them (indicator stays "In sync").
6. Edit a paragraph on GitHub's web editor while the project is open: within ~2 minutes it appears in the editor, and History shows "Merged from GitHub".

Optional smoke test against real GitHub (push, workflow-style commit, pull) using the App's installation token, skipping the browser OAuth step: `GITHUB_SMOKE=1 GITHUB_APP_ID=… GITHUB_APP_PRIVATE_KEY=… GITHUB_SMOKE_INSTALLATION=… GITHUB_SMOKE_REPO=owner/throwaway pnpm vitest run tests/unit/github.smoke.test.ts` (skipped unless `GITHUB_SMOKE=1`).
