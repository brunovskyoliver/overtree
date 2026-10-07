# Data model: Project history, restore, SyncTeX & PDF navigation

Drizzle migration `0004` adds three tables. Nothing existing changes shape. Deleting a project deletes its rows in all three (extend `deleteProject`).

## history_log (append-only, never compacted) — research R1

| Column | Type | Notes |
|---|---|---|
| id | integer PK autoincrement | global order; versions use it as watermark |
| projectId | text NOT NULL → projects.id | |
| docName | text NULL | text file id; null for `tree` rows |
| userId | text NULL → users.id | author; null for `baseline` and system writes |
| kind | text NOT NULL | `text` \| `tree` \| `baseline` |
| update | blob NULL | Yjs update (`text`, `baseline`); null for `tree` |
| createdAt | integer NOT NULL | ms |

Indexes: `(projectId, id)`, `(docName, id)`.

Rules: `text` rows are written in `onChange` with `context.userId` (sockets and direct connections). `tree` rows are written by every tree-changing service call with the actor. A `baseline` row holds a document's full merged state the first time history sees the document (R1). Rows are never updated or deleted except when the project is deleted.

## versions — research R2, R3

| Column | Type | Notes |
|---|---|---|
| id | integer PK autoincrement | |
| projectId | text NOT NULL → projects.id | |
| kind | text NOT NULL | `baseline` \| `edit` \| `compile` \| `restore` |
| watermark | integer NOT NULL | max `history_log.id` of the project covered by this version |
| manifestHash | text NOT NULL | blob holding the Manifest JSON |
| authors | text NOT NULL | JSON array of distinct user ids of the covered log rows (may be empty for `baseline`) |
| changed | text NOT NULL | JSON array of `{ id, path, change: 'added'\|'edited'\|'deleted'\|'renamed', from?: string }` vs the previous version |
| restoredFrom | integer NULL → versions.id | for `restore` |
| startedAt | integer NOT NULL | time of the first log row covered (or createdAt) |
| createdAt | integer NOT NULL | when the version was closed |

Index: `(projectId, id)`.

Invariants: watermarks strictly increase per project; a non-`restore` version always covers at least one log row; versions are never modified or deleted (FR-012, SC-004) except with the project.

### Manifest (blob JSON)

```ts
type Manifest = {
  mainFileId: string | null;
  entries: { id: string; parentId: string | null; name: string; kind: 'folder' | 'text' | 'binary'; hash: string | null }[];
};
```
`hash`: sha256 blob of the text (UTF-8) for text files, the existing blob hash for binaries, null for folders. Paths are derived with `pathOf` from `files.ts`.

## version_labels — research R6

| Column | Type | Notes |
|---|---|---|
| id | integer PK autoincrement | |
| projectId | text NOT NULL → projects.id | |
| versionId | integer NOT NULL → versions.id | |
| name | text NOT NULL | trimmed, 1–100 chars |
| userId | text NOT NULL → users.id | author |
| createdAt | integer NOT NULL | |

Rules: add needs project edit (editor/owner); rename/delete needs author or owner.

## Compile output additions (files, not tables) — research R9

`compile/<pid>/sync.json` written with each successful compile that produced a synctex file:

```ts
type SyncPaths = { pdfId: string; mainPath: string; paths: Record<string, string> }; // project path → text file id at compile time
```

## Browser storage (per device) — research R11, R12

| Key | Value |
|---|---|
| `overtree:pdfpos:<projectId>` | `{ page, offset, scale }` |
| `overtree:layout-mode` | `'split' \| 'editor' \| 'pdf' \| 'window'` |

## State transitions

Open log rows → (sweep idle 5 min / open 30 min, compile, restore, label-current) → closed `version`. Restore: seal open rows as `edit` version → apply changes (new `text`/`tree` rows by the restorer) → `restore` version with `restoredFrom`.
