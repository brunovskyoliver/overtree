# Overtree

A self-hosted LaTeX editor in the spirit of Overleaf. Accounts through Clerk, a dashboard of projects, sharing with Owner, Editor and Reader roles (also per file or folder), live collaboration with labelled cursors and avatars (Yjs + Hocuspocus), a file tree and outline sidebar, a CodeMirror editor with tabs and LaTeX autocomplete, and a PDF pane that compiles each project in a throwaway TeX Live container. Users, projects, text and uploaded files are stored in SQLite.

The container publishes on `127.0.0.1` by default. Every page and API call needs a signed-in account; `/sign-in` and share-link landing pages (which show the project title only) are the public exceptions.

## Clerk setup

Sign-in runs on [Clerk](https://clerk.com). The app needs a Clerk application and its two keys; it refuses to start without them.

1. Create an application in the [Clerk dashboard](https://dashboard.clerk.com). A development instance is fine for a private server; a production instance needs your domain and DNS records (Clerk walks you through them).
2. Under **Configure → User & authentication**:
   - **Email**: turn on sign-in with email, with both **Email verification code** and **Password**.
   - **SSO connections**: add **Google**. Development instances use Clerk's shared Google credentials; a production instance needs your own OAuth client ID and secret from Google Cloud.
3. Under **API keys**, copy the **Publishable key** (`pk_…`) into `PUBLIC_CLERK_PUBLISHABLE_KEY` and the **Secret key** (`sk_…`) into `CLERK_SECRET_KEY`. Optionally copy the **JWT public key** (PEM) into `CLERK_JWT_KEY` so session checks need no network.
4. Behind a real domain, set `ORIGIN` (e.g. `https://tex.example.org`): sessions are only accepted from that origin.

Who may get an account is decided by Overtree, not Clerk (see [Admin](#admin)). Someone the sign-up policy refuses still has an account in Clerk (Clerk creates it before Overtree sees them); they get "Your email isn't allowed on this instance" and are signed out. Remove such accounts under **Users** in the Clerk dashboard if you want them gone.

### Passing the keys

Keep the keys out of the repository. Any of these works:

```sh
# a .env file next to compose.yaml (gitignored); docker compose reads it on its own
PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_…
CLERK_SECRET_KEY=sk_test_…
ADMIN_EMAILS=you@example.org

docker compose up -d --build
set -a; . ./.env; set +a; pnpm dev        # dev server: export the file into the shell first
node --env-file=.env server.ts            # production build without Docker
```

The maintainer keeps them in the macOS keychain and injects them per command with `agent-secret`, e.g. `agent-secret run -e PUBLIC_CLERK_PUBLISHABLE_KEY=overtree/clerk-publishable-key -e CLERK_SECRET_KEY=overtree/clerk-secret-key -- pnpm dev`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_CLERK_PUBLISHABLE_KEY` | required | Clerk publishable key (browser). |
| `CLERK_SECRET_KEY` | required | Clerk secret key (server): verifies sessions and reads profiles. |
| `CLERK_JWT_KEY` | unset | PEM public key for networkless session checks; unset fetches and caches Clerk's JWKS. |
| `ADMIN_EMAILS` | empty | Comma-separated emails that are always site admins. |
| `OVERTREE_TEST_AUTH` | unset | `1` turns on the test sign-in (tests only, see [Test](#test)); refused with `NODE_ENV=production`. |

## Accounts, projects and sharing

The first account to sign in becomes a site admin and receives projects from before accounts existed (a 003 data dir shows up as "Untitled project"). The dashboard (`/`) lists your own and shared projects: create one from a template (blank, article, report, beamer, letter), upload a zip, search, rename, duplicate, delete your own, leave shared ones.

| Role | Can |
| --- | --- |
| **Owner** | Everything: edit, rename, share, set per-file permissions, transfer ownership, delete. One per project. |
| **Editor** | Edit files and the tree, set the main document and compiler, compile, download. |
| **Reader** | Open files read-only, compile, download the PDF and zip, duplicate the project into their own copy. |

Roles are enforced on the server: HTTP routes check them and read-only WebSocket connections drop edits, so the UI is not the guard. Non-members get 404 for a project, never a hint that it exists.

- **Share** (owner, top bar): invite by email as Editor or Reader. Someone with an account gets access at once; an unknown email becomes a pending invite that turns into access when they sign up (and lets them past an invite-only policy). Change roles, remove people, withdraw invites, transfer ownership (you become an Editor).
- **Link sharing**: turn on a link with Editor or Reader access. Opening it needs sign-in; the person then appears in the list as "via link". Resetting or turning off the link removes everyone who only had link access. A link joiner who was also invited keeps the higher of the two roles while the link is on.
- **Per-file permissions** (owner, tree menu "Permissions…"): give a named collaborator Editor or Reader on one file or folder. The nearest override up the folder chain wins, else the project role, so an Editor can be locked out of `main.tex` and a Reader can be let into `chapters/`. Locked entries show a lock in the tree. Overrides are listed per person in the Share dialog.
- **Live**: every change of access applies within seconds without a reload: sockets of affected users are closed and re-authenticate with the new role; removed users see "Your access was removed".

Everyone in a project sees the others' cursors with name labels and their avatars in the top bar (click one to jump to their cursor). Edits made offline merge when the connection returns.

## Admin

Site admins get **Admin** in the account menu (`/admin`):

- **Users**: promote to admin or demote, disable or enable. Disabling signs the person out everywhere within seconds. The last enabled admin can't be demoted or disabled.
- **Projects**: every project with owner and collaborator count; delete one (admins can't open other people's projects).
- **Settings**: the sign-up policy. **Invite-only** (the default) lets in the first user, `ADMIN_EMAILS`, emails with a pending project invite, and the allowlist (`name@example.org` or a whole domain as `@example.org`). **Open** lets anyone with a Clerk account in.

## Run with Docker

```sh
docker compose up -d --build     # http://127.0.0.1:3000
docker compose down              # data stays in the overtree-data volume
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `OVERTREE_BIND` | `127.0.0.1` | Host address the port is published on. `OVERTREE_BIND=0.0.0.0` exposes it on the LAN. |
| `PORT` | `3000` | Host port. |
| `DATA_DIR` | `/data` in the image, `./data` otherwise | Where `overtree.db` lives. |
| `UPLOAD_MAX_FILE_MB` | `50` | Largest single uploaded file. |
| `IMPORT_MAX_MB` | `200` | Largest total unpacked size of an imported project zip. |
| `PROJECT_MAX_FILES` | `2000` | Most files and folders in a project (folders count). |
| `ORIGIN` / `PROTOCOL_HEADER` | unset | Set one of these when a TLS proxy sits in front, e.g. `ORIGIN=https://tex.example.org` or `PROTOCOL_HEADER=x-forwarded-proto`. Without either, `server.ts` treats every request as plain HTTP; behind HTTPS that makes SvelteKit's same-origin check refuse deletes and uploads. |

`scripts/compose-smoke.sh` builds the image and checks it signed out: `/sign-in` answers, `/` redirects to it, API routes answer 401, `/collab` refuses a connection without a token, the image refuses to start with `OVERTREE_TEST_AUTH=1`, the stack restarts, and the port is bound to loopback only. It needs the Clerk keys in the environment and runs under its own compose project (`overtree-smoke`), removing its containers and volume when it exits. Compiling and text round trips need a session and are covered by the e2e suite. `scripts/collab-client.ts` reads or appends to a project's main document over the WebSocket given a token in `OVERTREE_TOKEN` (a Clerk session JWT from a signed-in tab: `await Clerk.session.getToken()`).

## Projects and files

The sidebar's file tree holds a project: folders and files, sorted folders first. Create files and folders from the tree header or a folder's menu, rename (F2), delete (Delete or Backspace), and drag entries between folders. One `.tex` file is the main document (marked in the tree; change it with "Set as main document"). Text files open in editor tabs; images and PDFs open as previews, other binaries offer a download.

- **Upload**: the Upload button, a folder's "Upload here", or drag files from the desktop onto the tree. Uploading a name that exists asks before replacing it. Folders dropped from the desktop are not uploaded; use a zip.
- **Zip**: "Download project as zip" exports every file and folder. "Upload zip" on the dashboard creates a new project from one, titled after the zip. A single top folder in the zip (GitHub's `repo-main/`, an Overleaf export) is dropped, `__MACOSX` and `.DS_Store` are skipped, and entries with `..`, absolute paths or symlinks are refused. The main document becomes the root `main.tex`, else the shallowest `.tex` with `\documentclass`.

Limits are set by `UPLOAD_MAX_FILE_MB`, `IMPORT_MAX_MB` and `PROJECT_MAX_FILES` (table above).

## Autocomplete

Typing `\` offers LaTeX commands, plus those defined with `\newcommand` and friends anywhere in the project. `\begin{` lists environments (including the project's `\newenvironment`s) and the matching `\end{}` follows while you type the name. Inside arguments it completes from the project: `\ref{`/`\eqref{` offer labels, `\cite{` offers keys from `.bib` files with their titles, `\includegraphics{` image paths, `\input{`/`\include{` `.tex` files, `\bibliography{`/`\addbibresource{` `.bib` files, and `\usepackage{` package names.

## Compile

Each compile runs `latexmk` on the main document in a fresh container from the TeX Live image: no network, read-only root, non-root user, memory, CPU and time limits. The whole project goes in as a tar on stdin and the PDF and log come back on stdout, so the app and the job share no files. `latexmk` runs bibtex or biber as needed. Log entries in other files open that file at the line.

This needs Docker. Pull the image once (about 1 GB download):

```sh
docker pull texlive/texlive:latest-medium
```

Under compose the `texlive` service pulls it on `up` and exits right away; otherwise the first compile would pull inside its time limit and time out.

| Variable | Default | Meaning |
| --- | --- | --- |
| `TEXLIVE_IMAGE` | `texlive/texlive:latest-medium` | Image each compile runs in. |
| `COMPILE_TIMEOUT_MS` | `20000` | Wall-clock limit per compile. |
| `COMPILE_MEMORY` | `512m` | Memory limit (`--memory` and `--memory-swap`). |
| `COMPILE_CPUS` | `1` | CPU limit. |
| `DOCKER_GID` | `0` | Compose only: group the app joins to use the Docker socket. |

The app container ships the Docker CLI and mounts `/var/run/docker.sock`, so compile jobs are sibling containers on the host's Docker. The app runs as `node`; `group_add: ["${DOCKER_GID:-0}"]` gives it access to the socket. On Docker Desktop and OrbStack the socket inside containers is owned by `root:root`, so the default `0` works. On Linux the socket usually belongs to the `docker` group: set `DOCKER_GID=$(stat -c %g /var/run/docker.sock)`.

> **The socket grants control of the host's Docker**, which is root-equivalent on the host. The app code is trusted; the LaTeX is not, and it only ever runs inside the locked-down job containers.

## Develop

Needs Node 24+ and pnpm 10.

```sh
pnpm install
pnpm dev            # http://localhost:5173
pnpm build && pnpm start   # production server (node server.ts), HOST defaults to 127.0.0.1
```

## Test

```sh
pnpm check          # svelte-check + TypeScript
pnpm test           # vitest unit tests (the sandbox tests need Docker and the TeX Live image)
pnpm exec playwright install chromium firefox webkit   # once
pnpm test:e2e       # Playwright on chromium, firefox and webkit
# the `clerk` smoke set against a real Clerk development instance (skipped without the keys)
PUBLIC_CLERK_PUBLISHABLE_KEY=… CLERK_SECRET_KEY=… pnpm exec playwright test --project=clerk
```

Unit and e2e tests sign in through a **test bypass** instead of Clerk: with `OVERTREE_TEST_AUTH=1`, a cookie `overtree-test-user=<email>` (HTTP) or the token `test:<email>` (WebSocket) signs in as that email, so the suites run offline and can play several users at once. It is on only when `OVERTREE_TEST_AUTH=1` **and** `NODE_ENV` is not `production`, and `server.ts` exits at startup if both are set. The Docker image sets `NODE_ENV=production`, so the bypass can't be turned on in a deployed app; `scripts/compose-smoke.sh` checks this. Every API route also checks the session itself (`tests/unit/routes-guarded.test.ts` fails if a new route skips its guard).

The `clerk` project signs in through the real Clerk dev instance with [`@clerk/testing`](https://clerk.com/docs/testing/playwright/overview) (`+clerk_test` emails, code `424242`).
