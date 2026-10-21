# Implementation Plan: References from DOI, arXiv and Zotero

**Branch**: `017-references` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

## Summary

One dialog (`ReferenceDialog.svelte`) with two tabs. The server looks a DOI up at doi.org by content negotiation (`Accept: application/x-bibtex`) or an arXiv id in the arXiv API's Atom feed, parses the entry, proposes a key and finds duplicates against every `.bib` of the project; the browser shows the formatted entry and re-keys it as the user edits. Adding posts the final BibTeX texts; the server re-parses and re-formats them, de-duplicates again, and appends them through the `.bib` file's Yjs document with a Hocuspocus direct connection carrying the user's id, so the edit is live, persisted and attributed in history exactly like typing. Zotero keys are checked against `/keys/current`, sealed with the AES-256-GCM code already used for GitHub tokens, and used server-side for `/users/:id/items/top?include=data,bibtex`.

## Technical Context

TypeScript (strict), SvelteKit 3 / Svelte 5 runes, CodeMirror 6, Hocuspocus 4, Drizzle on SQLite. No new dependencies: `fetch` (Node 24), regular expressions for the small Atom subset, the existing `delimited` brace scanner from completion for BibTeX.

## Design decisions

- **Shared BibTeX module** (`src/lib/references/bibtex.ts`): parse, format, key (`authorYEARword`, accents folded, stop words skipped, `a`–`z` then digits for clashes, case-insensitive like BibTeX), key validation, identifier parsing (DOI/arXiv forms, arXiv DOIs `10.48550/arXiv.*` count as arXiv), identities for de-duplication (DOI, arXiv id without version, else plain title + year) and a `BibIndex`. Plain TypeScript so the server (unbundled) and the browser use the same rules.
- **Entries are re-formatted** one field per line with braced values (bare numbers and month macros stay bare). The server never writes the client's text verbatim: it writes `formatEntry(parse(text))`, so anything outside the one entry is dropped.
- **Target choice** follows the main document's `\bibliography`/`\addbibresource`, resolved from the main file's folder (latexmk runs there, 002). A referenced but missing file is offered as "new file"; with no `.bib` at all, `references.bib` next to the main document. The server recomputes this list on insert and only creates a file that is in it, so the client can't create arbitrary paths.
- **Append, not replace**: one `Y.Text.insert` at the end inside a direct-connection transaction, so concurrent typing in the same `.bib` is untouched (Principle I). `\cite` insertion is a CodeMirror transaction in the user's editor, between `stopCapturing` calls, like the toolbar's insertions.
- **Completion**: "Add reference…" is a second completion source anchored at the cursor: its empty pattern matches whatever key is typed and scores below real key matches (`filter: false` would sort it first and let Enter open the dialog). After adding, the editor drops the target file's live symbols and refetches, so the key is suggested even when the `.bib` is open in a background tab.
- **Who may**: lookups and inserts need edit rights on the project (readers have nothing to insert into, and lookups cost external requests); the insert also checks edit rights on the file, or on its folder when creating it. The Zotero connection is per user (`/api/zotero/account`), the search per project (`/api/projects/:pid/references/zotero`), so results come prepared against that project.
- **Fetching** (`src/lib/server/references/fetch.ts`): fixed base URLs from `DOI_URL`, `ARXIV_API_URL`, `ZOTERO_API_URL` (defaults the public services); redirects followed by hand and only to the base host or, for DOIs, `data.crossref.org`, `api.crossref.org`, `data.datacite.org`, `api.datacite.org`, `data.medra.org`; one 8 s `AbortSignal.timeout` over the whole exchange; bodies read in chunks and refused past 2 MB. Errors are `FileError`s with plain messages (404 not found, 429 rate-limited, 502 unreachable or bad answer, 504 timeout), turned into HTTP by the existing `api()`.
- **Zotero key**: sent only in the `Zotero-API-Key` header, never in a URL or a message. Sealed with `sealWith`/`openWith`, the GitHub cipher (`github/crypto.ts`) generalized to take a key; the key is HKDF-SHA256 of 32 random bytes in `$DATA_DIR/secret.key`, made on first use. GitHub's key derives from the App private key, which doesn't exist when GitHub sync is off, so Zotero needs its own secret.

## Schema changes

Migration `drizzle/0006_*.sql`: new table `zotero_accounts` (`user_id` PK → users, `zotero_user_id`, `username`, `api_key` blob, `created_at`, `updated_at`). Nothing else changes.

## Routes

| Route | Who | What |
| --- | --- | --- |
| `GET /api/projects/:pid/references` | edit | `{ targets, keys }` |
| `GET /api/projects/:pid/references/lookup?id=` | edit | `{ entry, source }` |
| `GET /api/projects/:pid/references/zotero?q=` | edit + own connection | `{ items }` |
| `POST /api/projects/:pid/references` | edit (+ file/folder) | `{ fileId } \| { path }`, `entries` → `{ fileId, path, keys, added }` |
| `GET/PUT/DELETE /api/zotero/account` | signed in | connection info / connect / disconnect |

## Constitution Check

| Principle | Status | How |
|---|---|---|
| I. Collaboration is the data model | ✅ | Entries are appended through the `.bib`'s Yjs document via Hocuspocus (`openDirectConnection` with the user's context): live, persisted by `onChange`, logged for history with the author. No second write path. |
| II. Self-hostable by one person | ⚠️ justified | doi.org, arXiv and Zotero are external services next to Clerk. Like GitHub sync (012) they are optional, user-facing integrations: the app runs and compiles without them, and a lookup failing only fails that lookup. No configuration is required; base URLs are overridable for tests and mirrors. |
| III. Untrusted compilation | ✅ | No TeX runs on the server; fetched BibTeX only reaches the sandboxed compile as file content. Fetched text is escaped where it would break BibTeX (`&`, `%`, `#` in arXiv fields). |
| IV. Test the seams | ✅ | Vitest: keys, de-duplication, identifier parsing, arXiv Atom → BibTeX, lookups against `tests/fake-refs` (redirects, refused redirect, size cap, rate limit, offline), the Yjs append with a live provider, targets, access, Zotero connect/search/revoke/disconnect and sealing. Playwright: every user story against the fake, including a second browser seeing the entry live and a bibtex compile. |
| V. Simplicity first | ✅ | No new dependencies; one shared module; reuse of the GitHub cipher, `api()`, `FileError`, completion's brace scanner. `ponytail:` notes: secret on the data volume, three DOI agencies, exact title+year matching. |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| External services beside Clerk (Principle II) | The feature is looking papers up where they are registered | Asking users to paste BibTeX is the status quo the feature removes. Optional, nothing else depends on them |
| Fake services in the test suite (`tests/fake-refs`, ~170 lines) | Principle IV without network or real Zotero keys | Mocking `fetch` per test would skip the redirect, size-cap and header handling that matter for security |

## Tests

- `tests/unit/references.test.ts`, additions to `completion.test.ts` and `commands.test.ts`.
- `tests/e2e/references.spec.ts` with `tests/fake-refs/main.ts` as a Playwright web server (port `FAKE_REFS_PORT`, default 4176), started after the app server.
