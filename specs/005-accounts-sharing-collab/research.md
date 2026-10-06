# Research: Accounts, roles, sharing & live collaboration

Sources checked 2026-10-06: context7 (`/clerk-community/svelte-clerk`, `/clerk/clerk-docs`), npm registry, `node_modules/@hocuspocus/{server,provider}/dist/index.d.ts` (4.7).

## R1. Clerk client integration

- **Decision**: `@clerk/clerk-js` 6 + `@clerk/ui` 1 in the browser, loaded lazily from one module `src/lib/auth.svelte.ts` (`new Clerk(pk)`, `clerk.load({ ui })`, `mountSignIn(el, { routing: 'hash' })`, `mountUserButton` is not used; the account menu is ours). The sign-in page is `/sign-in` with hash routing, so no catch-all route is needed.
- **Rationale**: `svelte-clerk` 1.2 declares `@sveltejs/kit ^2` as peer; this repo is on Kit 3. clerk-js is framework-agnostic and the official SDK; the Svelte wrapper would add a peer conflict for three calls.
- **Alternatives**: `svelte-clerk` (peer mismatch, unofficial); building custom sign-in forms against Clerk's Frontend API (more code, Google OAuth flow by hand).

## R2. Server-side session verification (HTTP)

- **Decision**: `@clerk/backend` 3 `createClerkClient({ secretKey, publishableKey }).authenticateRequest(request, { authorizedParties: [origin], jwtKey: CLERK_JWT_KEY? })` in `src/hooks.server.ts`. `toAuth().userId` → app user. When `status === 'handshake'` (development instances and expired cookies), return the handshake `Location`/`Set-Cookie` headers as a 307 for page requests; API requests get 401 and the client retries after clerk-js refreshes.
- **Rationale**: one call handles `__session` cookie, `__clerk_db_jwt` (dev instances) and the handshake. Networkless when `CLERK_JWT_KEY` is set; otherwise JWKS is fetched once and cached by the SDK.
- **Alternatives**: bare `verifyToken` on the cookie (misses the handshake that dev instances need).

## R3. Session verification on the WebSocket

- **Decision**: Hocuspocus `onAuthenticate` with the provider's `token` option. The client passes `token: () => clerk.session.getToken()` (fresh JWT per (re)connect); the server calls `verifyToken(token, { secretKey, jwtKey?, authorizedParties })` and loads the app user. The upgrade itself is not refused (Hocuspocus needs the socket to report `authenticationFailed` to the provider).
- **Rationale**: Clerk session cookies live 60 s; a backgrounded tab can reconnect with an expired cookie, while `getToken()` refreshes. Hocuspocus authenticates per document, so each document on the shared socket is checked.
- **Alternatives**: verify the `__session` cookie at upgrade (expiry race above).

## R4. Test sign-in bypass

- **Decision**: `src/lib/server/auth.ts` accepts a test identity (cookie `overtree-test-user=<email>` for HTTP, token `test:<email>` for WS) only when `OVERTREE_TEST_AUTH === '1'` **and** `NODE_ENV !== 'production'`. `server.ts` exits at startup if `OVERTREE_TEST_AUTH=1` and `NODE_ENV=production`. The Docker image sets `NODE_ENV=production`. Playwright's web server sets `OVERTREE_TEST_AUTH=1` (no NODE_ENV). A separate Playwright project `clerk` (tagged `@clerk`) runs a smoke set through the real Clerk dev instance with `@clerk/testing` (`clerkSetup`, `setupClerkTestingToken`, `clerk.signIn({ emailAddress })`, `+clerk_test` emails, OTP `424242`); it is skipped when `CLERK_SECRET_KEY` is unset.
- **Rationale**: most e2e tests stay offline and fast; the bypass cannot be switched on in the shipped image. `src/lib/server` runs unbundled in production (`node server.ts` imports it), so a build-time define cannot strip it; the runtime double condition plus the startup refusal is the guard.
- **Alternatives**: all tests through Clerk (network-dependent, slow, rate-limited); build-time define (doesn't reach unbundled server modules).

## R5. User mirror and sign-up policy

- **Decision**: on the first authenticated request of an unknown Clerk user id, fetch `clerkClient.users.getUser(id)` (primary email, full name or email local part, image URL) and insert a `users` row in one transaction that also decides: first user ever → admin; email in `ADMIN_EMAILS` → admin (also re-checked on every mirror refresh, never demotes); invite-only policy check (allowlist email, `@domain`, pending invite, first user, admin seed). Refused users get a 403 page "Your email isn't allowed on this instance" and the client signs them out. Profile refresh: at most once per 10 minutes per user (`lastSeenAt` also updated then). Pending invites for the email become memberships at insert.
- **Rationale**: no webhook endpoint needed (self-hosted instance may not be reachable by Clerk); lazy mirror is enough for the fields we show.
- **Alternatives**: Clerk webhooks (needs public URL + svix secret); Clerk allowlist feature (paid on some plans, lives outside the app, constitution wants authorization in the app).

## R6. Disabling users and revoking access live

- **Decision**: one server function `kick(filter)` iterates `hocuspocus.documents` → `getConnections()` and calls `connection.close({ code: 4403, reason })` for connections whose `context.userId` (and optionally `context.projectId`) match. Called on disable, removal, role change, override change, link revoke/regenerate, ownership transfer and project delete. Clients reconnect automatically; `onAuthenticate` then grants the new role (read-only) or fails (`authenticationFailed` → "Your access was removed"). HTTP requests of a disabled user get 403 and the client calls `clerk.signOut()`.
- **Rationale**: one code path for every access change; Hocuspocus re-authenticates on reconnect, so the role is always computed fresh.

## R7. Read-only enforcement

- **Decision**: in `onAuthenticate`, `connectionConfig.readOnly = effectiveRole !== 'editor'` (owner counts as editor). Hocuspocus drops sync updates from read-only connections; awareness still flows so readers' cursors show. The client also sets `EditorState.readOnly` and `EditorView.editable` from the same role (`/api/projects/:id` returns `permissions`). HTTP mutations call `requireFileRole(...)`.
- **Rationale**: server enforcement is the Hocuspocus built-in, no custom message filter.

## R8. Live tree, presence and project events

- **Decision**: one extra Hocuspocus document per project, `project:<id>`, never persisted (hooks skip names with the prefix). Its awareness carries `{ user: { id, name, color, avatar }, fileId }` for the top-bar avatars; its stateless channel carries server events: `{"type":"tree"}` (refetch files), `{"type":"project"}` (title/main/link changes), `{"type":"access"}` (refetch own permissions), `{"type":"deleted"}`. The server sends them with `document.broadcastStateless(JSON)` after each mutation (no-op when nobody is connected). File documents keep the y-codemirror awareness (`user: { id, name, color, colorLight }`) for cursors.
- **Jump to cursor**: clicking an avatar opens `fileId` from the project awareness, then finds the state in that file's awareness with the same `user.id` and scrolls to its `cursor.head` (a Yjs relative position, resolved with `Y.createAbsolutePositionFromRelativePosition`).
- **Shared socket**: one `HocuspocusProviderWebsocket` per tab, multiplexing the project doc and every open file doc (Hocuspocus 4 supports this). Replaces one socket per tab from 003.
- **Rationale**: no tree CRDT (tree stays in SQLite as in 003, plan R-decisions there); stateless broadcast is enough to trigger refetch, and a refetch after reconnect covers missed events.
- **Alternatives**: Y.Map tree (second source of truth next to SQLite, conflicts with 003's file model); SSE endpoint (second connection type with its own auth).

## R9. Colors

- **Decision**: fixed palette of 8 colors, chosen by a hash of the user id, so a user keeps the same color everywhere. `colorLight` is the color at 20 % alpha for selections.

## R10. Per-file permission resolution

- **Decision**: `effectiveRole(project, user, fileId)`: owner → `owner`; otherwise walk from the file up through `parentId` and return the first override for that user; else membership role; else none. Link access is stored on the membership row as `viaLink = 1` when a signed-in user opens a link, next to the invited `role` (null if none), so it shows in the collaborator list and can be removed. Effective membership role = max(invited role, link role while the link is on). Regenerating or disabling the link clears `viaLink` and deletes rows with no invited role, so an invited Reader who also joined by an Editor link drops back to Reader (FR-034, analyze M2).
- Tree operations check: create/upload → editor on the target folder (root → project role); rename/delete → editor on the item and every descendant; move → editor on item, descendants and destination.
- `/api/projects/:id/files` returns each entry with `canEdit` so the tree can draw locks.

## R11. Projects, migration, compile per project

- **Decision**: new `projects` table replaces `project`; `files.projectId` (not null, default `'main'` in the migration so existing rows land in the existing project). The migration converts the `project` row `'main'` into `projects('main', title 'Untitled project', owner NULL)`. When the first admin is created, every project with `owner IS NULL` is assigned to them (FR-025). Compile output goes to `$DATA_DIR/compile/<projectId>/`; the coalescing state (`running`, `queued`) becomes a `Map` keyed by project; `compile_settings.project` already holds the id. The `'main'` compile dir stays where it is.
- Duplicate: copy file rows with new ids, copy blobs by hash (no copy needed, content-addressed), copy each text doc's current state as one stored update.
- Delete: delete files, documents, updates, memberships, invites, overrides, compile settings and the compile dir in one transaction (dir after commit), then `kick` and broadcast `deleted`.
- **ponytail**: compiles stay unbounded across projects (one container per running project); feature 011 adds a concurrency cap.

## R12. Templates

- **Decision**: `src/lib/server/templates.ts` exports `templates: Record<'blank'|'article'|'report'|'beamer'|'letter', string>`, the text of a single `main.tex` each. Blank is 003's `SEED`. The project title is substituted into `\title{}` where the class has one. An e2e test compiles each template once.

## R13. Routes

- Pages: `/` dashboard, `/project/[id]` editor (current `+page.svelte` moves here), `/sign-in`, `/admin`, `/share/[token]` landing (public), `/blocked` (disabled / not allowed). All `ssr = false` except `/share/[token]` (needs title server-side without client auth).
- API: everything moves under `/api/projects/[pid]/...`; admin under `/api/admin/...`; `/api/me`.

## R14. Last modified time

- **Decision**: `projects.updatedAt` is bumped by tree mutations and by `onChange` of a file document (throttled: write only if older than 10 s, ponytail: per-update write otherwise).
