import { and, asc, desc, eq, gt, max, min, notExists, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import type { FileKind } from '../files.ts';
import { broadcast } from './access.ts';
import { getServer } from './collab.ts';
import { putBlob, readBlob, type Tx } from './files.ts';
import { documents, files, historyLog, projects, updates, versions, type VersionKind } from './schema.ts';

// Project history (research R1–R3, R8): a never-compacted log of Yjs updates and tree changes with their authors,
// and versions derived from it. Synchronous (better-sqlite3), no in-memory state: a restart loses nothing.
// Loaded unbundled by server.ts in production: no SvelteKit imports here.

const db = () => getServer().db;
const envMs = (name: string, fallback: number) => Number(process.env[name] || fallback);

// env overrides exist only so tests can shorten them (quickstart.md)
export const IDLE_MS = envMs('HISTORY_IDLE_MS', 5 * 60_000);
export const MAX_OPEN_MS = envMs('HISTORY_MAX_OPEN_MS', 30 * 60_000);
export const SWEEP_MS = envMs('HISTORY_SWEEP_MS', 30_000);

export type Version = typeof versions.$inferSelect;
export type ManifestEntry = { id: string; parentId: string | null; name: string; kind: FileKind; hash: string | null };
/** The whole project at a version (data-model "Manifest"); `hash`: text (UTF-8) or binary blob, null for folders. */
export type Manifest = { mainFileId: string | null; entries: ManifestEntry[] };
export type Changed = { id: string; path: string; change: 'added' | 'edited' | 'deleted' | 'renamed'; from?: string };

// --- log (research R1) ---------------------------------------------------------------------------------------------

/** A Yjs update of a text document, next to its `updates` row (collab.ts onChange). */
export function logText(pid: string, docName: string, userId: string | null | undefined, update: Uint8Array, tx: Tx = db()) {
	tx.insert(historyLog)
		.values({ projectId: pid, docName, userId: userId ?? null, kind: 'text', update: Buffer.from(update), createdAt: Date.now() })
		.run();
}

/** A tree change (create, rename/move, delete, upload, main file, restore) by `userId`. */
export function logTree(pid: string, userId: string | null, tx: Tx = db()) {
	tx.insert(historyLog).values({ projectId: pid, docName: null, userId, kind: 'tree', update: null, createdAt: Date.now() }).run();
}

/** A document's stored state: the compacted snapshot plus the updates since, as one update. */
export function storedState(docName: string, tx: Tx = db()): Uint8Array {
	const snapshot = tx.select({ state: documents.state }).from(documents).where(eq(documents.name, docName)).get();
	const rows = tx.select({ update: updates.update }).from(updates).where(eq(updates.docName, docName)).orderBy(asc(updates.id)).all();
	const all = [...(snapshot ? [snapshot.state] : []), ...rows.map((r) => r.update)];
	return all.length ? Y.mergeUpdates(all) : Y.encodeStateAsUpdate(new Y.Doc());
}

/** A `baseline` row with the stored state of every text file of the project that has no log row yet: existing
 *  projects at upgrade, new/imported/duplicated projects (written to `updates` directly), anything out of band. */
export function ensureBaselines(pid: string, tx: Tx = db()) {
	const missing = tx
		.select({ id: files.id })
		.from(files)
		.where(
			and(
				eq(files.projectId, pid),
				eq(files.kind, 'text'),
				notExists(tx.select({ one: sql`1` }).from(historyLog).where(eq(historyLog.docName, files.id)))
			)
		)
		.all();
	const now = Date.now();
	for (const { id } of missing)
		tx.insert(historyLog)
			.values({ projectId: pid, docName: id, userId: null, kind: 'baseline', update: Buffer.from(storedState(id, tx)), createdAt: now })
			.run();
}

// --- manifests (research R3) ---------------------------------------------------------------------------------------

/** The text of a document right now: the loaded Hocuspocus doc, else the stored state. Synchronous. */
export function currentText(docName: string, tx: Tx = db()): string {
	const live = getServer().hocuspocus.documents.get(docName);
	if (live) return live.getText('content').toString();
	const doc = new Y.Doc();
	Y.applyUpdate(doc, storedState(docName, tx));
	return doc.getText('content').toString();
}

export const readManifest = (hash: string): Manifest => JSON.parse(readBlob(hash).toString('utf8'));

/** The text a manifest entry points at. */
export const blobText = (hash: string): string => readBlob(hash).toString('utf8');

/** Project path of every entry. */
export function manifestPaths(entries: Pick<ManifestEntry, 'id' | 'parentId' | 'name'>[]): Map<string, string> {
	const byId = new Map(entries.map((e) => [e.id, e]));
	const out = new Map<string, string>();
	const of = (id: string): string => {
		let p = out.get(id);
		if (p === undefined) {
			const e = byId.get(id)!;
			p = e.parentId && byId.has(e.parentId) ? `${of(e.parentId)}/${e.name}` : e.name;
			out.set(id, p);
		}
		return p;
	};
	for (const e of entries) of(e.id);
	return out;
}

/** The current tree as a manifest. Texts of `reread` documents (and of files new since `prev`) are read and stored;
 *  the others reuse `prev`'s hash. */
export function buildManifest(pid: string, prev: Manifest | null, reread: Set<string>, tx: Tx = db()): Manifest {
	const before = new Map(prev?.entries.map((e) => [e.id, e.hash]));
	const rows = tx
		.select({ id: files.id, parentId: files.parentId, name: files.name, kind: files.kind, hash: files.hash })
		.from(files)
		.where(eq(files.projectId, pid))
		.orderBy(asc(files.id))
		.all();
	const entries = rows.map((r) => {
		if (r.kind !== 'text') return { ...r, hash: r.kind === 'binary' ? r.hash : null };
		const old = reread.has(r.id) ? null : before.get(r.id);
		return { ...r, hash: old ?? putBlob(Buffer.from(currentText(r.id, tx), 'utf8')) };
	});
	const mainFileId = tx.select({ mainFileId: projects.mainFileId }).from(projects).where(eq(projects.id, pid)).get()?.mainFileId ?? null;
	return { mainFileId, entries };
}

/** Files added, edited, deleted or renamed/moved (also by a moved parent) from `prev` to `next`; folders only for
 *  their own add, delete, rename or move. */
export function changedFiles(prev: Manifest | null, next: Manifest): Changed[] {
	const before = new Map(prev?.entries.map((e) => [e.id, e]));
	const after = new Set(next.entries.map((e) => e.id));
	const oldPaths = manifestPaths(prev?.entries ?? []);
	const newPaths = manifestPaths(next.entries);
	const out: Changed[] = [];
	for (const e of next.entries) {
		const path = newPaths.get(e.id)!;
		const old = before.get(e.id);
		if (!old) {
			out.push({ id: e.id, path, change: 'added' });
			continue;
		}
		const from = oldPaths.get(e.id)!;
		const moved = e.kind === 'folder' ? old.name !== e.name || old.parentId !== e.parentId : from !== path;
		if (moved) out.push({ id: e.id, path, change: 'renamed', from });
		else if (old.hash !== e.hash) out.push({ id: e.id, path, change: 'edited' });
	}
	for (const e of prev?.entries ?? []) if (!after.has(e.id)) out.push({ id: e.id, path: oldPaths.get(e.id)!, change: 'deleted' });
	return out;
}

// --- versions (research R2) ----------------------------------------------------------------------------------------

export const lastVersion = (pid: string, tx: Tx = db()): Version | null =>
	tx.select().from(versions).where(eq(versions.projectId, pid)).orderBy(desc(versions.id)).limit(1).get() ?? null;

/** Closes the project's open log rows into a version, in one transaction; null when there is nothing to close.
 *  Empty versions only for `restore` and for a project's first (`baseline`) version. Authors are the distinct users
 *  of the covered rows only: a compile requester adds nothing. Broadcasts `history` when a version was added.
 *  Text is read in the same turn as the watermark; an update applied but not yet logged (onChange runs right after
 *  the doc applies it) lands in the next version (research R3). */
export function closeVersion(pid: string, kind: VersionKind, { restoredFrom }: { restoredFrom?: number } = {}): Version | null {
	const version = db().transaction((tx) => {
		ensureBaselines(pid, tx);
		const prev = lastVersion(pid, tx);
		const from = prev?.watermark ?? 0;
		const rows = tx
			.select({ id: historyLog.id, docName: historyLog.docName, userId: historyLog.userId, createdAt: historyLog.createdAt })
			.from(historyLog)
			.where(and(eq(historyLog.projectId, pid), gt(historyLog.id, from)))
			.orderBy(asc(historyLog.id))
			.all();
		if (!rows.length && kind !== 'restore' && !(kind === 'baseline' && !prev)) return null;
		const prevManifest = prev && readManifest(prev.manifestHash);
		const reread = new Set(rows.flatMap((r) => (r.docName ? [r.docName] : [])));
		const manifest = buildManifest(pid, prevManifest, reread, tx);
		const now = Date.now();
		return tx
			.insert(versions)
			.values({
				projectId: pid,
				kind,
				watermark: rows.at(-1)?.id ?? from,
				manifestHash: putBlob(Buffer.from(JSON.stringify(manifest), 'utf8')),
				authors: JSON.stringify([...new Set(rows.flatMap((r) => (r.userId ? [r.userId] : [])))]),
				changed: JSON.stringify(changedFiles(prevManifest, manifest)),
				restoredFrom: restoredFrom ?? null,
				startedAt: rows[0]?.createdAt ?? now,
				createdAt: now
			})
			.returning()
			.get();
	});
	if (version) broadcast(pid, { type: 'history' });
	return version;
}

/** Closes what is due: a project without versions gets its baseline (upgrade), open rows become an `edit` version
 *  when the newest is `IDLE_MS` old or the oldest `MAX_OPEN_MS`. `now = Infinity` closes everything open (startup).
 *  ponytail: two queries per project per sweep; a "dirty projects" table if instances grow to many thousands */
export function sweep(now = Date.now()) {
	for (const { id: pid } of db().select({ id: projects.id }).from(projects).all()) {
		const prev = lastVersion(pid);
		if (!prev) {
			closeVersion(pid, 'baseline');
			continue;
		}
		const open = db()
			.select({ first: min(historyLog.createdAt), last: max(historyLog.createdAt) })
			.from(historyLog)
			.where(and(eq(historyLog.projectId, pid), gt(historyLog.id, prev.watermark)))
			.get();
		if (open?.first == null || open.last == null) continue;
		if (now - open.last >= IDLE_MS || now - open.first >= MAX_OPEN_MS) closeVersion(pid, 'edit');
	}
}
