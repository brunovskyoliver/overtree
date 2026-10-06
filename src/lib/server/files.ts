import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm';
import * as Y from 'yjs';
import { kindForName, limits, validateName, type FileEntry, type FileKind } from '../files.ts';
import { getServer } from './collab.ts';
import type { Db } from './db.ts';
import { touchProject } from './projects.ts';
import { documents, files, overrides, projects, updates } from './schema.ts';

// File service (research R1–R5), every call scoped to one project (005 research R11). Synchronous where SQLite
// is enough; text content only through Hocuspocus. Access checks are the caller's (access.ts).

/** An error for the user, with its HTTP status. Not SvelteKit's `error()`: server.ts loads this module
 *  from the prod image, which has no devDependencies; routes convert it with `api()` from ./api.ts. */
export class FileError extends Error {
	status: number;
	existingId?: string; // upload name clash: the file that would be replaced
	constructor(status: number, message: string, existingId?: string) {
		super(message);
		this.status = status;
		this.existingId = existingId;
	}
}

export const fail = (status: number, message: string): never => {
	throw new FileError(status, message);
};

// the db or a transaction: both query the same way
export type Tx = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;
export type Row = typeof files.$inferSelect;

const db = () => getServer().db;

const toEntry = (r: Omit<Row, 'projectId'>): FileEntry => ({
	id: r.id,
	parentId: r.parentId,
	name: r.name,
	kind: r.kind,
	...(r.size != null && { size: r.size }),
	updatedAt: r.updatedAt
});

export const listFiles = (pid: string, tx: Tx = db()): FileEntry[] =>
	tx.select().from(files).where(eq(files.projectId, pid)).all().map(toEntry);

/** The row (with `hash`) of a file or folder of project `pid`; null if unknown or in another project. */
export const getFile = (pid: string, id: string, tx: Tx = db()): Row | null =>
	tx.select().from(files).where(and(eq(files.id, id), eq(files.projectId, pid))).get() ?? null;

/** getFile or a 404. */
export const fileOr404 = (pid: string, id: string, tx: Tx = db()): Row => getFile(pid, id, tx) ?? fail(404, 'File not found.');

export const getMainFileId = (pid: string): string | null =>
	db().select({ mainFileId: projects.mainFileId }).from(projects).where(eq(projects.id, pid)).get()?.mainFileId ?? null;

export function setMainFile(pid: string, id: string) {
	const row = fileOr404(pid, id);
	if (row.kind !== 'text' || !row.name.toLowerCase().endsWith('.tex')) fail(400, 'Only a .tex file can be the main document.');
	db().update(projects).set({ mainFileId: id }).where(eq(projects.id, pid)).run();
}

const siblingNames = (tx: Tx, pid: string, parentId: string | null, except = '') =>
	tx
		.select({ name: files.name })
		.from(files)
		.where(and(eq(files.projectId, pid), parentId === null ? isNull(files.parentId) : eq(files.parentId, parentId), ne(files.id, except)))
		.all()
		.map((r) => r.name);

function checkName(tx: Tx, pid: string, name: string, parentId: string | null, except?: string) {
	const bad = validateName(name, []);
	if (bad) fail(400, bad);
	const taken = validateName(name, siblingNames(tx, pid, parentId, except));
	if (taken) fail(409, taken);
}

function checkParent(tx: Tx, pid: string, parentId: string | null) {
	if (parentId !== null && fileOr404(pid, parentId, tx).kind !== 'folder') fail(400, 'The target is not a folder.');
}

// ponytail: folders count against the limit too, one number bounds the table
function checkCount(tx: Tx, pid: string) {
	const total = tx.select({ n: count() }).from(files).where(eq(files.projectId, pid)).get()!.n;
	if (total >= limits.projectMaxFiles) fail(413, `A project can have at most ${limits.projectMaxFiles} files.`);
}

export function createEntry(pid: string, { kind, name, parentId }: { kind: 'folder' | 'text'; name: string; parentId: string | null }): FileEntry {
	const entry = db().transaction((tx) => {
		checkParent(tx, pid, parentId);
		checkName(tx, pid, name, parentId);
		if (kind === 'text' && kindForName(name) !== 'text') fail(400, 'Upload images instead of creating them.');
		checkCount(tx, pid);
		const now = Date.now();
		const row = { id: randomUUID(), projectId: pid, parentId, name, kind, hash: null, size: null, createdAt: now, updatedAt: now };
		tx.insert(files).values(row).run();
		return toEntry(row); // a new text file is an empty Yjs doc: nothing to write
	});
	touchProject(pid);
	return entry;
}

export function renameOrMove(pid: string, id: string, change: { name?: string; parentId?: string | null }): FileEntry {
	const entry = db().transaction((tx) => {
		const row = fileOr404(pid, id, tx);
		const name = change.name ?? row.name;
		const parentId = change.parentId === undefined ? row.parentId : change.parentId;
		if (row.kind !== 'folder' && kindForName(name) !== kindForName(row.name))
			fail(400, 'Renaming can’t turn a text file into a binary file or back.');
		checkParent(tx, pid, parentId);
		// walk up from the target: reaching the moved entry means a move into itself or a descendant
		for (let p = parentId; p !== null; p = fileOr404(pid, p, tx).parentId) {
			if (p === id) fail(400, 'A folder can’t be moved into itself.');
		}
		checkName(tx, pid, name, parentId, id);
		const updated = { ...row, name, parentId, updatedAt: Date.now() };
		tx.update(files).set({ name, parentId, updatedAt: updated.updatedAt }).where(eq(files.id, id)).run();
		return toEntry(updated);
	});
	touchProject(pid);
	return entry;
}

/** The entry and all its descendants (ids), from one project's rows. */
export function withDescendants(id: string, all: Pick<Row, 'id' | 'parentId'>[]): string[] {
	const out = [id];
	for (let i = 0; i < out.length; i++) for (const f of all) if (f.parentId === out[i]) out.push(f.id);
	return out;
}

/** Removes the entry, its descendants, their Yjs docs and overrides; clears the main document if it went (research R4). */
export function deleteEntry(pid: string, id: string) {
	const textIds = db().transaction((tx) => {
		const all = tx.select({ id: files.id, parentId: files.parentId, kind: files.kind }).from(files).where(eq(files.projectId, pid)).all();
		if (!all.some((f) => f.id === id)) fail(404, 'File not found.');
		const doomed = withDescendants(id, all);
		const text = all.filter((f) => f.kind === 'text' && doomed.includes(f.id)).map((f) => f.id);
		tx.delete(overrides).where(inArray(overrides.fileId, doomed)).run();
		tx.delete(files).where(inArray(files.id, doomed)).run(); // one statement: the parent FK is checked at its end
		tx.delete(documents).where(inArray(documents.name, text)).run();
		tx.delete(updates).where(inArray(updates.docName, text)).run();
		tx.update(projects).set({ mainFileId: null }).where(and(eq(projects.id, pid), inArray(projects.mainFileId, doomed))).run();
		return text;
	});
	touchProject(pid);
	// open editors get kicked; onAuthenticate refuses the reconnect and onStoreDocument skips the late store
	for (const t of textIds) getServer().hocuspocus.closeConnections(t);
}

/** Upload one file (research R6): text when the extension is a text one and the bytes are UTF-8, else a blob.
 *  A name clash is a 409 with `existingId` unless `replace`; replacing keeps the id and refuses a kind change. */
export async function uploadFile(
	pid: string,
	parentId: string | null,
	name: string,
	bytes: Uint8Array,
	replace: boolean
): Promise<{ entry: FileEntry; replaced: boolean }> {
	if (bytes.length > limits.uploadMaxFileMb * 1024 * 1024) fail(413, `A file can be at most ${limits.uploadMaxFileMb} MB.`);
	let text: string | null = null;
	if (kindForName(name) === 'text') {
		try {
			text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		} catch {
			// not UTF-8: stored as binary
		}
	}
	const kind: FileKind = text === null ? 'binary' : 'text';
	// before the transaction (file I/O); a refused upload leaves an unreferenced blob, like any old blob (R1)
	const hash = kind === 'binary' ? putBlob(bytes) : null;
	const size = kind === 'binary' ? bytes.length : null;
	const result = db().transaction((tx) => {
		checkParent(tx, pid, parentId);
		const bad = validateName(name, []);
		if (bad) fail(400, bad);
		const lower = name.toLowerCase();
		const siblings = tx
			.select()
			.from(files)
			.where(and(eq(files.projectId, pid), parentId === null ? isNull(files.parentId) : eq(files.parentId, parentId)))
			.all();
		const existing = siblings.find((f) => f.name.toLowerCase() === lower);
		const now = Date.now();
		if (existing) {
			if (!replace) throw new FileError(409, `"${name}" already exists here.`, existing.id);
			if (existing.kind !== kind) fail(409, 'Replacing can’t turn a text file into a binary file or back.');
			const row = { ...existing, hash, size, updatedAt: now };
			tx.update(files).set({ hash, size, updatedAt: now }).where(eq(files.id, existing.id)).run();
			return { entry: toEntry(row), replaced: true };
		}
		checkCount(tx, pid);
		const row = { id: randomUUID(), projectId: pid, parentId, name, kind, hash, size, createdAt: now, updatedAt: now };
		tx.insert(files).values(row).run();
		return { entry: toEntry(row), replaced: false };
	});
	touchProject(pid);
	if (text !== null) await setText(result.entry.id, text); // through Yjs: open editors see a replaced text at once
	return result;
}

// ponytail: blobs are never garbage-collected (research R1); history (008) needs old ones, cleanup comes with backups (011)
export function putBlob(bytes: Uint8Array): string {
	const hash = createHash('sha256').update(bytes).digest('hex');
	const dir = join(getServer().dataDir, 'blobs');
	const path = join(dir, hash);
	if (!existsSync(path)) {
		mkdirSync(dir, { recursive: true });
		const tmp = `${path}.${randomUUID()}.tmp`;
		writeFileSync(tmp, bytes);
		renameSync(tmp, path);
	}
	return hash;
}

export const readBlob = (hash: string): Buffer => readFileSync(join(getServer().dataDir, 'blobs', hash));

export async function getText(id: string): Promise<string> {
	const conn = await getServer().hocuspocus.openDirectConnection(id);
	try {
		return conn.document!.getText('content').toString();
	} finally {
		await conn.disconnect();
	}
}

/** Replaces the whole text through Hocuspocus (research R3): persisted by onChange, live in open editors. */
export async function setText(id: string, text: string) {
	const conn = await getServer().hocuspocus.openDirectConnection(id);
	try {
		await conn.transact((doc) => {
			const t = doc.getText('content');
			t.delete(0, t.length);
			t.insert(0, text);
		});
	} finally {
		await conn.disconnect();
	}
}

/** A whole text as one Yjs update, for a document no one has open yet. */
export function textUpdate(text: string) {
	const doc = new Y.Doc();
	doc.getText('content').insert(0, text);
	return Buffer.from(Y.encodeStateAsUpdate(doc));
}
