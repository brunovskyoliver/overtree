# HTTP API contract (008)

Conventions from 005 `contracts/http-api.md`: every route needs a session; `401` signed out, `404` project/version/file unknown **or caller not a member**, `403` role too low, errors `{ message }`. **R** = reader or above, **E** = editor or owner, **E(file)** = edit right on that file per 005 "Effective role", **O** = owner. All routes are under `/api/projects/:pid`.

## History

| Method | Path | Role | Body / query → Response |
|---|---|---|---|
| GET | `/history` | R | `?before=<versionId>&limit=50&labels=1` → `{ versions: Version[], hasMore }`, newest first |
| GET | `/history/:vid` | R | `?compare=current\|previous` (default `current`) → `{ version: Version, files: FileDiff[], users: UserRef[] }` (`users`: everyone a segment names, for the legend; files sorted by path) |
| GET | `/history/:vid/zip` | R | zip of the project at that version (`Content-Disposition` attachment) |
| POST | `/history/:vid/restore` | E | `{ fileId?: string }` — with `fileId`: single file (needs E(file), or E(target folder) if the file no longer exists; 403 otherwise). Without: whole project. → `{ version: Version \| null, skipped: string[] }` (`version` null when nothing changed) |
| POST | `/history/labels` | E | `{ versionId?: number, name }` — no `versionId`: closes the open version first and labels the newest → 201 `Label` |
| PATCH | `/history/labels/:lid` | label author or O | `{ name }` → `Label` |
| DELETE | `/history/labels/:lid` | label author or O | 204 |

```ts
type UserRef = { id: string; name: string; avatarUrl: string | null; color: string }; // unknown user: name 'Unknown user'
type Label = { id: number; versionId: number; name: string; user: UserRef; createdAt: number; canEdit: boolean };
type Version = {
  id: number;
  kind: 'baseline' | 'edit' | 'compile' | 'restore';
  startedAt: number;
  createdAt: number;
  authors: UserRef[];
  changed: { id: string; path: string; change: 'added' | 'edited' | 'deleted' | 'renamed'; from?: string }[];
  restoredFrom: { id: number; createdAt: number } | null;
  labels: Label[];
};
type Segment = { op: '=' | '+' | '-'; text: string; userId: string | null };
type FileDiff = {
  id: string;            // file id in the newer state (current or the version), else the older one
  path: string;
  oldPath?: string;      // renamed/moved
  kind: 'text' | 'binary';
  change: 'added' | 'deleted' | 'edited' | 'renamed';
  segments?: Segment[];  // text only
  size?: { old: number | null; new: number | null }; // binary only
  canRestore: boolean;   // caller may restore this file to the version
};
```

Validation: `name` trimmed 1–100 chars (400). `vid`/`lid` of another project → 404. Restore by a reader → 403. Disabled users are already refused by `hooks.server.ts` (403).

Side effects: restore and label changes `broadcast(pid, { type: 'history' })`; restore tree changes `broadcast(pid, { type: 'tree' })`.

## Compile (additions)

| Method | Path | Role | Query → Response |
|---|---|---|---|
| POST | `/compile` | R | unchanged, but first closes the open version as `compile` (FR-002) |
| GET | `/compile/sync/code` | R | `?pdfId&fileId&line` → `{ page, boxes: [{ x, y, width, height }] }` in PDF points from the page's top-left; 404 when no mapping (stale `pdfId`, no synctex, line not found in any file) |
| GET | `/compile/sync/pdf` | R | `?pdfId&page&x&y` (PDF points, top-left) → `{ fileId, line }`; 404 when nothing maps to a project file |

`pdfId` must equal the last result's `pdfId` (only the latest synctex is kept); otherwise 404 and the client recompiles or shows "Recompile to sync".

## Project events (stateless on `project:<pid>`)

`ProjectEvent.type` gains `'history'`.
