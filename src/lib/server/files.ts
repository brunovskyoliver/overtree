import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm';
import * as Y from 'yjs';
import { kindForName, limits, validateName, type FileEntry, type FileKind } from '../files.ts';
import { getServer, SEED } from './collab.ts';
import type { Db } from './db.ts';
import { documents, files, project, updates } from './schema.ts';

// File service (research R1–R5). Synchronous where SQLite is enough; text content only through Hocuspocus.

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

const fail = (status: number, message: string): never => {
	throw new FileError(status, message);
};

// the db or a transaction: both query the same way
type Tx = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;
export type Row = typeof files.$inferSelect;

const db = () => getServer().db;

const toEntry = (r: Row): FileEntry => ({
	id: r.id,
	parentId: r.parentId,
	name: r.name,
	kind: r.kind,
	...(r.size != null && { size: r.size }),
	updatedAt: r.updatedAt
});

export const listFiles = (): FileEntry[] => db().select().from(files).all().map(toEntry);

/** The row (with `hash`) of a file or folder; 404 if unknown. */
export function getFile(id: string, tx: Tx = db()): Row {
	return tx.select().from(files).where(eq(files.id, id)).get() ?? fail(404, 'File not found.');
}

export const getMainFileId = (): string | null =>
	db().select().from(project).where(eq(project.id, 'main')).get()?.mainFileId ?? null;

function writeMain(tx: Tx, mainFileId: string | null) {
	tx.insert(project)
		.values({ id: 'main', mainFileId })
		.onConflictDoUpdate({ target: project.id, set: { mainFileId } })
		.run();
}

export function setMainFile(id: string) {
	const row = getFile(id);
	if (row.kind !== 'text' || !row.name.toLowerCase().endsWith('.tex')) fail(400, 'Only a .tex file can be the main document.');
	writeMain(db(), id);
}

const siblingNames = (tx: Tx, parentId: string | null, except = '') =>
	tx
		.select({ name: files.name })
		.from(files)
		.where(and(parentId === null ? isNull(files.parentId) : eq(files.parentId, parentId), ne(files.id, except)))
		.all()
		.map((r) => r.name);

function checkName(tx: Tx, name: string, parentId: string | null, except?: string) {
	const bad = validateName(name, []);
	if (bad) fail(400, bad);
	const taken = validateName(name, siblingNames(tx, parentId, except));
	if (taken) fail(409, taken);
}

function checkParent(tx: Tx, parentId: string | null) {
	if (parentId !== null && getFile(parentId, tx).kind !== 'folder') fail(400, 'The target is not a folder.');
}

export function createEntry({ kind, name, parentId }: { kind: 'folder' | 'text'; name: string; parentId: string | null }): FileEntry {
	return db().transaction((tx) => {
		checkParent(tx, parentId);
		checkName(tx, name, parentId);
		if (kind === 'text' && kindForName(name) !== 'text') fail(400, 'Upload images instead of creating them.');
		// ponytail: folders count against the limit too, one number bounds the table
		const total = tx.select({ n: count() }).from(files).get()!.n;
		if (total >= limits.projectMaxFiles) fail(413, `A project can have at most ${limits.projectMaxFiles} files.`);
		const now = Date.now();
		const row = { id: randomUUID(), parentId, name, kind, hash: null, size: null, createdAt: now, updatedAt: now };
		tx.insert(files).values(row).run();
		return toEntry(row); // a new text file is an empty Yjs doc: nothing to write
	});
}

export function renameOrMove(id: string, change: { name?: string; parentId?: string | null }): FileEntry {
	return db().transaction((tx) => {
		const row = getFile(id, tx);
		const name = change.name ?? row.name;
		const parentId = change.parentId === undefined ? row.parentId : change.parentId;
		if (row.kind !== 'folder' && kindForName(name) !== kindForName(row.name))
			fail(400, 'Renaming can’t turn a text file into a binary file or back.');
		checkParent(tx, parentId);
		// walk up from the target: reaching the moved entry means a move into itself or a descendant
		for (let p = parentId; p !== null; p = getFile(p, tx).parentId) {
			if (p === id) fail(400, 'A folder can’t be moved into itself.');
		}
		checkName(tx, name, parentId, id);
		const updated = { ...row, name, parentId, updatedAt: Date.now() };
		tx.update(files).set({ name, parentId, updatedAt: updated.updatedAt }).where(eq(files.id, id)).run();
		return toEntry(updated);
	});
}

/** Removes the entry, its descendants and their Yjs docs; clears the main document if it went (research R4). */
export function deleteEntry(id: string) {
	const textIds = db().transaction((tx) => {
		const all = tx.select({ id: files.id, parentId: files.parentId, kind: files.kind }).from(files).all();
		if (!all.some((f) => f.id === id)) fail(404, 'File not found.');
		const doomed = [id];
		for (let i = 0; i < doomed.length; i++) for (const f of all) if (f.parentId === doomed[i]) doomed.push(f.id);
		const text = all.filter((f) => f.kind === 'text' && doomed.includes(f.id)).map((f) => f.id);
		tx.delete(files).where(inArray(files.id, doomed)).run(); // one statement: the parent FK is checked at its end
		tx.delete(documents).where(inArray(documents.name, text)).run();
		tx.delete(updates).where(inArray(updates.docName, text)).run();
		tx.update(project).set({ mainFileId: null }).where(inArray(project.mainFileId, doomed)).run();
		return text;
	});
	// open editors get kicked; onConnect refuses the reconnect and onStoreDocument skips the late store
	for (const t of textIds) getServer().hocuspocus.closeConnections(t);
}

/** Upload one file (research R6): text when the extension is a text one and the bytes are UTF-8, else a blob.
 *  A name clash is a 409 with `existingId` unless `replace`; replacing keeps the id and refuses a kind change. */
export async function uploadFile(
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
		checkParent(tx, parentId);
		const bad = validateName(name, []);
		if (bad) fail(400, bad);
		const lower = name.toLowerCase();
		const siblings = tx
			.select()
			.from(files)
			.where(parentId === null ? isNull(files.parentId) : eq(files.parentId, parentId))
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
		const total = tx.select({ n: count() }).from(files).get()!.n;
		if (total >= limits.projectMaxFiles) fail(413, `A project can have at most ${limits.projectMaxFiles} files.`);
		const row = { id: randomUUID(), parentId, name, kind, hash, size, createdAt: now, updatedAt: now };
		tx.insert(files).values(row).run();
		return { entry: toEntry(row), replaced: false };
	});
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
function textUpdate(text: string) {
	const doc = new Y.Doc();
	doc.getText('content').insert(0, text);
	return Buffer.from(Y.encodeStateAsUpdate(doc));
}

/** Zip import (research R7): every file and Yjs doc swapped for `rows` in one transaction, so a failure changes
 *  nothing. `texts` holds the content of the new text files (fresh ids: stored updates, nobody has them open).
 *  Parents must come before their children in `rows`. */
export function replaceProject(rows: Row[], texts: Map<string, string>, mainFileId: string | null) {
	const old = db().transaction((tx) => {
		const text = tx.select({ id: files.id }).from(files).where(eq(files.kind, 'text')).all().map((r) => r.id);
		tx.delete(files).run(); // one statement: the parent FK is checked at its end
		tx.delete(documents).run();
		tx.delete(updates).run();
		const now = Date.now();
		for (const row of rows) tx.insert(files).values(row).run();
		for (const [docName, t] of texts) tx.insert(updates).values({ docName, update: textUpdate(t), createdAt: now }).run();
		writeMain(tx, mainFileId);
		return text;
	});
	// like deleteEntry: open editors of the old files get kicked
	for (const t of old) getServer().hocuspocus.closeConnections(t);
}

/** First start, or a 001/002 data dir: create `main.tex` as the main document (research R2). Runs once: the
 *  `project` row marks it done, so a project the user emptied stays empty. */
export function ensureProject() {
	db().transaction((tx) => {
		if (tx.select().from(project).get()) return;
		const id = randomUUID();
		const now = Date.now();
		tx.insert(files).values({ id, parentId: null, name: 'main.tex', kind: 'text', createdAt: now, updatedAt: now }).run();
		// 001/002 named the doc 'main.tex': keep its text and history under the new id
		const moved =
			tx.update(documents).set({ name: id }).where(eq(documents.name, 'main.tex')).run().changes +
			tx.update(updates).set({ docName: id }).where(eq(updates.docName, 'main.tex')).run().changes;
		// the seed as one stored update, like 001 did in onLoadDocument; synchronous, so no client sees an empty doc
		if (!moved) tx.insert(updates).values({ docName: id, update: textUpdate(SEED), createdAt: now }).run();
		writeMain(tx, id);
	});
}
