import { and, asc, desc, eq, exists, gt, inArray, lt, max, min, notExists, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import type { FileKind } from '../files.ts';
import type { GitHubSource, HistoryPage, Label, UserRef, VersionInfo } from '../history-types.ts';
import { colorFor } from '../presence.ts';
import { broadcast, canEdit, projectRole, type Role } from './access.ts';
import { getServer } from './collab.ts';
import type { Db } from './db.ts';
import { FileError, putBlob, readBlob, type Tx } from './files.ts';
import { documents, files, historyLog, projects, updates, users, versionLabels, versions, type VersionKind } from './schema.ts';

// Project history (research R1–R3, R8): a never-compacted log of Yjs updates and tree changes with their authors,
// and versions derived from it. Synchronous (better-sqlite3). The only in-memory state is the text-row buffer and
// the set of projects with open rows; the startup sweep closes whatever a restart left open.
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

// Text rows are buffered and written in one transaction at most FLUSH_MS later: a row per keystroke in its own
// commit next to the `updates` row slowed five busy typists enough to lag behind (collab5.spec). Everything that
// reads or appends to the log flushes first, so ids keep the order the updates were applied in.
// ponytail: a crash loses up to FLUSH_MS of history rows (the text itself is safe in `updates`); that document's
// diffs then fall back to plain ones (research R4).
const FLUSH_MS = 100;
type LogRow = typeof historyLog.$inferInsert;
type Pending = { db: Db; rows: LogRow[]; timer: ReturnType<typeof setTimeout> } | null;
// On globalThis: server.ts (onChange) and the bundled SvelteKit routes (compile, restore…) each load this module,
// and a route must flush the rows the socket side buffered.
const shared = (globalThis.__overtreeHistory ??= { pending: null, open: new Set() });
const state = shared as { pending: Pending; open: Set<string> };

/** Projects with log rows after their last version: the sweep looks only at these (plus everything at startup). */
const open = state.open;

/** A Yjs update of a text document (collab.ts onChange), buffered (see FLUSH_MS). */
export function logText(pid: string, docName: string, userId: string | null | undefined, update: Uint8Array) {
	const d = db();
	if (state.pending && state.pending.db !== d) flushHistory(); // tests reopen the server in one process
	const pending = (state.pending ??= { db: d, rows: [], timer: setTimeout(flushLater, FLUSH_MS) });
	pending.rows.push({ projectId: pid, docName, userId: userId ?? null, kind: 'text', update: Buffer.from(update), createdAt: Date.now() });
	open.add(pid);
}

function flushLater() {
	try {
		flushHistory();
	} catch (e) {
		console.error('history log flush failed', e);
	}
}

/** Writes the buffered text rows, inside `tx` when given (it must belong to the current server's db). */
export function flushHistory(tx?: Tx) {
	if (!state.pending) return;
	const { db: d, rows, timer } = state.pending;
	state.pending = null;
	clearTimeout(timer);
	if (!d.$client.open) return;
	// 7 columns a row: well under SQLite's 32766 bound variables per statement
	const write = (t: Tx) => {
		for (let i = 0; i < rows.length; i += 1000) t.insert(historyLog).values(rows.slice(i, i + 1000)).run();
	};
	if (tx && d === db()) write(tx);
	else d.transaction(write);
}

/** A tree change (create, rename/move, delete, upload, main file, restore) by `userId`. */
export function logTree(pid: string, userId: string | null, tx: Tx = db()) {
	flushHistory(tx);
	tx.insert(historyLog).values({ projectId: pid, docName: null, userId, kind: 'tree', update: null, createdAt: Date.now() }).run();
	open.add(pid);
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
	flushHistory(tx);
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
 *  Empty versions only for `restore` and for a project's first (`baseline`) version (never for `github`: a pull
 *  that changed nothing is no version, 012 FR-021). `source`: what a `github` version merged. Authors are the distinct users
 *  of the covered rows only: a compile requester adds nothing. Broadcasts `history` when a version was added.
 *  Text is read in the same turn as the watermark; an update applied but not yet logged (onChange runs right after
 *  the doc applies it) lands in the next version (research R3). */
export function closeVersion(
	pid: string,
	kind: VersionKind,
	{ restoredFrom, source }: { restoredFrom?: number; source?: GitHubSource } = {}
): Version | null {
	const version = db().transaction((tx) => {
		ensureBaselines(pid, tx); // flushes the buffered rows first
		const prev = lastVersion(pid, tx);
		const from = prev?.watermark ?? 0;
		const rows = tx
			.select({ id: historyLog.id, docName: historyLog.docName, userId: historyLog.userId, createdAt: historyLog.createdAt })
			.from(historyLog)
			.where(and(eq(historyLog.projectId, pid), gt(historyLog.id, from)))
			.orderBy(asc(historyLog.id))
			.all();
		open.delete(pid); // everything logged so far is in this version (or there was nothing)
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
				source: source ? JSON.stringify(source) : null,
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
 *  when the newest is `IDLE_MS` old or the oldest `MAX_OPEN_MS`. `now = Infinity` closes everything open and checks
 *  every project (startup); later sweeps only look at projects with rows logged since their last version. */
export function sweep(now = Date.now()) {
	flushHistory();
	const pids = now === Infinity ? db().select({ id: projects.id }).from(projects).all().map((p) => p.id) : [...open];
	for (const pid of pids) {
		const prev = lastVersion(pid);
		if (!prev) {
			if (db().select({ id: projects.id }).from(projects).where(eq(projects.id, pid)).get()) closeVersion(pid, 'baseline');
			else open.delete(pid); // deleted meanwhile
			continue;
		}
		const range = db()
			.select({ first: min(historyLog.createdAt), last: max(historyLog.createdAt) })
			.from(historyLog)
			.where(and(eq(historyLog.projectId, pid), gt(historyLog.id, prev.watermark)))
			.get();
		if (range?.first == null || range.last == null) {
			open.delete(pid);
			continue;
		}
		if (now - range.last >= IDLE_MS || now - range.first >= MAX_OPEN_MS) closeVersion(pid, 'edit');
	}
}

// --- reading (contracts/http-api.md "History") -----------------------------------------------------------------------

/** Users by id as history shows them; ids without an account become 'Unknown user'. */
export function userRefs(ids: Iterable<string>): Map<string, UserRef> {
	const wanted = [...new Set(ids)];
	const rows = wanted.length
		? db().select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl }).from(users).where(inArray(users.id, wanted)).all()
		: [];
	const found = new Map(rows.map((u) => [u.id, u]));
	return new Map(
		wanted.map((id) => {
			const u = found.get(id);
			return [id, { id, name: u?.name ?? 'Unknown user', avatarUrl: u?.avatarUrl ?? null, color: colorFor(id) }];
		})
	);
}

/** Version rows as the API shows them, for `userId` (whose labels they may edit). */
function versionInfos(pid: string, rows: Version[], userId: string): VersionInfo[] {
	if (!rows.length) return [];
	const ids = rows.map((v) => v.id);
	const labels = db().select().from(versionLabels).where(inArray(versionLabels.versionId, ids)).orderBy(asc(versionLabels.id)).all();
	const sources = rows.flatMap((v) => (v.restoredFrom ? [v.restoredFrom] : []));
	const restored = new Map(
		sources.length
			? db()
					.select({ id: versions.id, createdAt: versions.createdAt })
					.from(versions)
					.where(inArray(versions.id, sources))
					.all()
					.map((v) => [v.id, v])
			: []
	);
	const authors = rows.map((v) => JSON.parse(v.authors) as string[]);
	const refs = userRefs([...authors.flat(), ...labels.map((l) => l.userId)]);
	const role = projectRole(pid, userId);
	const label = labelInfo(refs, userId, role);
	return rows.map((v, i) => ({
		id: v.id,
		kind: v.kind,
		startedAt: v.startedAt,
		createdAt: v.createdAt,
		authors: authors[i].map((id) => refs.get(id)!),
		changed: JSON.parse(v.changed) as Changed[],
		restoredFrom: v.restoredFrom ? (restored.get(v.restoredFrom) ?? null) : null,
		labels: labels.filter((l) => l.versionId === v.id).map(label),
		...(v.source ? { github: JSON.parse(v.source) as GitHubSource } : {})
	}));
}

/** Who may rename/delete a label (research R6, FR-017): the owner, or its author while they can still edit the project. */
const mayChangeLabel = (role: Role | null, author: string, userId: string) => role === 'owner' || (canEdit(role) && author === userId);

/** A label row as the API shows it to `userId` with project role `role`. */
const labelInfo =
	(refs: Map<string, UserRef>, userId: string, role: Role | null) =>
	(l: typeof versionLabels.$inferSelect): Label => ({
		id: l.id,
		versionId: l.versionId,
		name: l.name,
		user: refs.get(l.userId)!,
		createdAt: l.createdAt,
		canEdit: mayChangeLabel(role, l.userId, userId)
	});

export const PAGE = 50;

/** Newest first, `limit` versions older than version `before`; `labelsOnly`: only labeled ones. */
export function listVersions(
	pid: string,
	userId: string,
	{ before, limit = PAGE, labelsOnly = false }: { before?: number; limit?: number; labelsOnly?: boolean } = {}
): HistoryPage {
	const n = Math.min(Math.max(Math.trunc(limit) || PAGE, 1), 100);
	const rows = db()
		.select()
		.from(versions)
		.where(
			and(
				eq(versions.projectId, pid),
				before !== undefined ? lt(versions.id, before) : undefined,
				labelsOnly
					? exists(db().select({ one: sql`1` }).from(versionLabels).where(eq(versionLabels.versionId, versions.id)))
					: undefined
			)
		)
		.orderBy(desc(versions.id))
		.limit(n + 1)
		.all();
	return { versions: versionInfos(pid, rows.slice(0, n), userId), hasMore: rows.length > n };
}

/** A version row of project `pid`; null for an unknown id or one of another project. */
export const versionRow = (pid: string, vid: number): Version | null =>
	(Number.isInteger(vid) && db().select().from(versions).where(and(eq(versions.id, vid), eq(versions.projectId, pid))).get()) || null;

/** The version before `v` in its project, if any. */
export const previousVersion = (v: Version): Version | null =>
	db()
		.select()
		.from(versions)
		.where(and(eq(versions.projectId, v.projectId), lt(versions.id, v.id)))
		.orderBy(desc(versions.id))
		.limit(1)
		.get() ?? null;

export const getVersion = (pid: string, v: Version, userId: string): VersionInfo => versionInfos(pid, [v], userId)[0];

// --- labels (research R6) --------------------------------------------------------------------------------------------

export const LABEL_MAX = 100;

function labelName(name: unknown): string {
	const n = typeof name === 'string' ? name.trim() : '';
	if (!n || n.length > LABEL_MAX) throw new FileError(400, `A label needs 1–${LABEL_MAX} characters.`);
	return n;
}

const showLabel = (pid: string, row: typeof versionLabels.$inferSelect, userId: string): Label =>
	labelInfo(userRefs([row.userId]), userId, projectRole(pid, userId))(row);

/** Labels version `versionId`, or without it the current state: the open edits are closed into a version first,
 *  else the newest version gets the label. The caller checks the project role (E). */
export function addLabel(pid: string, userId: string, { versionId, name }: { versionId?: number; name: unknown }): Label {
	const n = labelName(name);
	const v = versionId === undefined ? (closeVersion(pid, 'edit') ?? lastVersion(pid)) : versionRow(pid, versionId);
	if (!v) throw new FileError(404, 'Version not found.');
	const row = db()
		.insert(versionLabels)
		.values({ projectId: pid, versionId: v.id, name: n, userId, createdAt: Date.now() })
		.returning()
		.get();
	broadcast(pid, { type: 'history' });
	return showLabel(pid, row, userId);
}

/** The label `lid` of project `pid` if `userId` may change it: the owner, or its author with edit rights (404 / 403). */
function ownLabel(pid: string, lid: number, userId: string) {
	const row =
		Number.isInteger(lid) &&
		db()
			.select()
			.from(versionLabels)
			.where(and(eq(versionLabels.id, lid), eq(versionLabels.projectId, pid)))
			.get();
	if (!row) throw new FileError(404, 'Label not found.');
	const role = projectRole(pid, userId);
	if (!mayChangeLabel(role, row.userId, userId))
		throw new FileError(403, canEdit(role) ? 'Only the label’s author or the owner can change it.' : 'You can only view this project.');
	return row;
}

export function renameLabel(pid: string, lid: number, userId: string, name: unknown): Label {
	ownLabel(pid, lid, userId);
	const row = db().update(versionLabels).set({ name: labelName(name) }).where(eq(versionLabels.id, lid)).returning().get()!;
	broadcast(pid, { type: 'history' });
	return showLabel(pid, row, userId);
}

export function deleteLabel(pid: string, lid: number, userId: string) {
	ownLabel(pid, lid, userId);
	db().delete(versionLabels).where(eq(versionLabels.id, lid)).run();
	broadcast(pid, { type: 'history' });
}
