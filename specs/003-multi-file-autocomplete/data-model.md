# Data model: Multi-file projects, file tree & LaTeX autocomplete

## SQLite (Drizzle, migration `0002`)

### `files`
| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | uuid; for text files also the Hocuspocus document name |
| `parent_id` | text, nullable, FK → `files.id` | null = project root; parent must be a `folder` |
| `name` | text not null | validated (research R5); unique among siblings, case-insensitive (checked in the service, inside the same synchronous transaction) |
| `kind` | text not null | `'folder' \| 'text' \| 'binary'`; fixed at creation |
| `hash` | text, nullable | SHA-256 hex, binaries only |
| `size` | integer, nullable | bytes, binaries only |
| `created_at` | integer not null | epoch ms |
| `updated_at` | integer not null | epoch ms; bumped on rename, move, replace |

Index: `files_parent_idx` on `parent_id`.

### `project`
| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | `'main'` until feature 005 |
| `main_file_id` | text, nullable | a `text` file whose name ends in `.tex`; null when none (deleted, or zip without `.tex`) |

### Existing tables
- `documents.name` / `updates.doc_name`: now a text file id. Legacy `main.tex` rows are renamed to the new id by `ensureProject()` (research R2).
- `compile_settings`: unchanged.

## Files on disk
| Path | Content |
|------|---------|
| `$DATA_DIR/blobs/<sha256>` | binary file bytes, written once (temp + rename) |
| `$DATA_DIR/compile/main/*` | unchanged from 002 |

## Lifecycle
- **Create text file**: insert row, `setText(id, '')` is not needed (empty doc); upload/import use `setText(id, content)`.
- **Rename / move**: update `name` / `parent_id`, `updated_at`. Main stays main.
- **Delete**: one transaction removes the row, all descendants, and `documents`/`updates` rows of text files among them; clears `project.main_file_id` if it was removed; then `closeConnections` per text id.
- **Replace on upload**: text → `setText` on the same id; binary → new `hash`/`size` on the same row.
- **Zip import**: validate everything → delete all → create all → set main.

## Shared types (`src/lib/files.ts`)

```ts
type FileKind = 'folder' | 'text' | 'binary';
type FileEntry = { id: string; parentId: string | null; name: string; kind: FileKind; size?: number; updatedAt: number };
type ProjectInfo = { files: FileEntry[]; mainFileId: string | null };

const TEXT_EXTENSIONS: string[]; // spec FR-006
const PREVIEW_IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
function kindForName(name: string): 'text' | 'binary';
function validateName(name: string, siblings: string[]): string | null; // error message or null
function pathOf(id: string, files: FileEntry[]): string;                // 'chapters/intro.tex'
```

`LogEntry` (002) gains `fileId?: string` when the entry's file is a project text file.

## Completion (`src/lib/completion/`)
```ts
type Kind = 'cmd' | 'env' | 'pkg' | 'label' | 'cite' | 'file';
type Symbols = {
  labels: string[];
  commands: { name: string; args: number }[];   // from \newcommand etc.
  environments: string[];                        // from \newenvironment
  bibKeys: { key: string; title?: string; author?: string }[];
  files: { path: string; kind: 'text' | 'binary' }[];
};
```

## Browser storage
| Key | Value |
|-----|-------|
| `overtree:tabs` | `{ open: string[], active: string \| null }` (file ids) |
| `overtree:tree` | `{ expanded: string[] }` (folder ids) |
