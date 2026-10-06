# Quickstart: validate feature 005

## Prerequisites

- Docker running (compiles), pnpm, Playwright browsers installed (`pnpm exec playwright install`).
- Clerk development instance with Google and Email (code + password) enabled. Keys in the macOS keychain: `overtree/clerk-publishable-key`, `overtree/clerk-secret-key`.

## Environment

| Variable | Purpose | Default |
|---|---|---|
| `PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (browser) | required unless test auth |
| `CLERK_SECRET_KEY` | Clerk secret key (server) | required unless test auth |
| `CLERK_JWT_KEY` | optional PEM for networkless verification | unset → JWKS fetched and cached |
| `ADMIN_EMAILS` | comma-separated emails that are always admin | empty |
| `OVERTREE_TEST_AUTH` | `1` enables the test sign-in bypass; refused with `NODE_ENV=production` | unset |

## Run locally with Clerk

```bash
agent-secret run -e PUBLIC_CLERK_PUBLISHABLE_KEY=overtree/clerk-publishable-key \
  -e CLERK_SECRET_KEY=overtree/clerk-secret-key -- pnpm dev
```

Open http://localhost:5173 → redirected to `/sign-in` → sign in → dashboard. First account is admin.

## Automated checks

```bash
pnpm check                      # 0 errors
pnpm test                       # Vitest: auth, permissions, mirror, collab auth/read-only/kick, migration
pnpm test:e2e                   # Playwright with OVERTREE_TEST_AUTH=1 (offline)
agent-secret run -e PUBLIC_CLERK_PUBLISHABLE_KEY=overtree/clerk-publishable-key \
  -e CLERK_SECRET_KEY=overtree/clerk-secret-key -- pnpm test:e2e --project=clerk   # real Clerk smoke set
```

## Scenarios (map to spec stories)

1. **Sign-in (US1)**: signed out `/project/x` → `/sign-in`; sign in with `e2e+clerk_test@example.com`, code `424242` → back to the requested page. `curl -i localhost:5173/api/projects` → 401. WebSocket without token → `authenticationFailed`.
2. **Dashboard (US2)**: create "Thesis" from Report → opens and compiles; rename from top bar; duplicate; search "thes"; delete copy. Upgrade test: start 005 on a 003 data dir → first sign-in sees "Untitled project" with old files.
3. **Sharing (US3)**: owner invites B as Reader → B's dashboard shows it, editor read-only, Recompile works; owner switches B to Editor → B types within 2 s; link on (Reader) → C opens link and gets read-only; reset link → C disconnected.
4. **Live (US4)**: two contexts in one file see each other's labelled cursors; avatars in top bar; clicking jumps; tree change appears in the other context without reload; per-user undo; `context.setOffline(true)` 30 s with edits both sides → merged. Five-context test types concurrently for 60 s → identical text.
5. **Admin (US5)**: first user admin; second user refused under default invite-only until allowlisted; promote, disable (B's socket closes, B lands on `/blocked`), enable; Projects tab deletes a project.
6. **Per-file (US6)**: B Editor with Reader override on `main.tex` → lock icon, read-only; direct WS edit rejected; B Reader with Editor override on `chapters/` → can edit there only.

## Security spot-checks

- Run the app with `NODE_ENV=production OVERTREE_TEST_AUTH=1 node server.ts` → exits with an error.
- As a reader, send a Yjs update through a raw `HocuspocusProvider` → server text unchanged (unit test).
- As a non-member, `GET /api/projects/<id>/files` → 404.
