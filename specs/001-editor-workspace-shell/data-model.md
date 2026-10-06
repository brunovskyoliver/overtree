# Data Model: Editor workspace shell

## Stored

### `documents` (SQLite)
| Column | Type | Rules |
|--------|------|-------|
| `name` | text, PK | Hocuspocus document name; this feature uses exactly `main.tex` |
| `state` | blob, not null | `Y.encodeStateAsUpdate(doc)` |
| `updated_at` | integer (unix ms), not null | set on every store |

Lifecycle: no row → first load seeds starter text → row created on first store → overwritten on each debounced store (compaction). Rows are never deleted in this feature.

### `updates` (SQLite)
| Column | Type | Rules |
|--------|------|-------|
| `id` | integer, PK autoincrement | apply order |
| `doc_name` | text, not null, indexed | document name (`main.tex`) |
| `update` | blob, not null | one Yjs update as received in `onChange` |
| `created_at` | integer (unix ms), not null | |

Lifecycle: inserted synchronously per change; deleted in the same transaction that writes a newer snapshot to `documents` (rows with `id <=` the max id read in that transaction).

### Yjs document `main.tex`
- `doc.getText('content')`: the LaTeX source. The only text field.

### Project
Not stored. ponytail: one project; the name is a constant (`PROJECT_NAME = 'Untitled project'`) shown in the top bar. Feature 005 adds a `projects` table.

## Browser-only

### Layout (local storage, via paneforge `autoSaveId`; paneforge prefixes the key, so the stored keys are `paneforge:overtree:layout:*`)
- `overtree:layout:main`: sizes of sidebar / editor / pdf (collapsed = 0)
- `overtree:layout:sidebar`: sizes of file tree / outline

### Outline entry (derived, not stored)
`{ level: 1 | 2 | 3, title: string, line: number }` (1-based line; level 1 = section)
