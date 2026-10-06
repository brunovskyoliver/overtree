# Contract: files and project HTTP API

SvelteKit `+server.ts` endpoints. Types in [data-model.md](../data-model.md). Errors return `{ "message": string }` with the status shown; messages are shown to the user as-is.

## `GET /api/files`
`200` → `ProjectInfo` (`{ files: FileEntry[], mainFileId }`), all entries, unordered (the client sorts: folders first, then name, locale-aware, case-insensitive).

## `POST /api/files` (JSON)
Body: `{ "kind": "folder" | "text", "name": string, "parentId": string | null }`.
- `201` → the new `FileEntry`. A text file starts empty.
- `400` invalid name, or parent is not a folder; `409` name taken (case-insensitive); `413` project would exceed `PROJECT_MAX_FILES`.
- `kind: "text"` with a non-text extension (e.g. `logo.png`) → `400` ("Upload images instead of creating them").

## `POST /api/files` (multipart upload)
Fields: `file` (one file), `parentId` (empty = root), `replace` (`"1"` to overwrite a sibling with the same name).
- `201` → `FileEntry` (new) or `200` → `FileEntry` (replaced; same `id`).
- `409` → `{ message, existingId }` when the name is taken and `replace` is not set (client asks "Replace existing file?").
- `409` when replacing would change kind (text ↔ binary).
- `413` file over `UPLOAD_MAX_FILE_MB`, or file count over the limit.
- Kind: text if the extension is in the text list and the bytes are valid UTF-8, otherwise binary.

## `PATCH /api/files/:id`
Body: any of `{ "name": string, "parentId": string | null }`.
- `200` → updated `FileEntry`. `400` invalid name, kind-changing rename (`notes.txt` → `notes.png`), or a move into itself/descendant; `404` unknown id; `409` name taken in the target folder.

## `DELETE /api/files/:id`
`204`. Removes descendants, their Yjs docs, clears main if removed, closes their collab connections. `404` unknown id.

## `GET /api/files/:id/raw`
Text: current Yjs text, `text/plain; charset=utf-8`. Binary: blob bytes with the media type from the extension (`application/octet-stream` otherwise). Always `X-Content-Type-Options: nosniff`; SVG adds `Content-Security-Policy: sandbox`. `?download=1` adds `Content-Disposition: attachment; filename*=UTF-8''<name>`. `404` unknown id or folder.

## `GET /api/project`
`200` → `{ "mainFileId": string | null }`.

## `PUT /api/project`
Body: `{ "mainFileId": string }` → `204`. `400` if the file is not a `.tex` text file; `404` unknown id.

## `GET /api/project/zip`
`200`, `application/zip`, `Content-Disposition: attachment; filename="project.zip"`. Every folder (including empty ones, as `dir/` entries) and file at its path; no compile output.

## `POST /api/project/zip`
Multipart field `file`. Replaces the whole project (the confirmation happens in the client).
- `200` → `ProjectInfo` of the new project.
- `400` not a valid zip, or no usable entries; `413` unpacked size over `IMPORT_MAX_MB` or entries over `PROJECT_MAX_FILES`. On any error nothing changes.
- Safety and normalization rules: research R7.

## `GET /api/project/symbols`
`200` → `Symbols` (data-model) from the current text of every text file.

## Compile API changes (002 contract)
- `POST /api/compile` uses the whole tree and the main document (research R8). Without a main document: `200` with `status: "failure"` and the message from R8.
- `LogEntry.fileId` set for entries in project text files.
- `GET /api/compile/output.pdf?download=1` → `filename="<main base name>.pdf"` (`main.pdf` when main is `main.tex`).

## Configuration (env, with defaults)
| Variable | Default |
|----------|---------|
| `UPLOAD_MAX_FILE_MB` | `50` |
| `IMPORT_MAX_MB` | `200` |
| `PROJECT_MAX_FILES` | `2000` |
| `BODY_SIZE_LIMIT` | set by `server.ts` to `IMPORT_MAX_MB + 1` MB unless already set |
