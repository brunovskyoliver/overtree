import { HocuspocusProvider } from '@hocuspocus/provider';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { SEED } from '../../src/lib/server/collab.ts';
import {
	createEntry,
	deleteEntry,
	getFile,
	getMainFileId,
	getText,
	listFiles,
	renameOrMove,
	setMainFile,
	setText,
	uploadFile
} from '../../src/lib/server/files.ts';
import { documents, updates } from '../../src/lib/server/schema.ts';
import { cleanup, connect, project, start, status, tempDir, waitFor } from './helpers.ts';

/** A server with one fresh project (`pid`, the default for the helpers below). */
let pid = '';
async function setup(dir = tempDir()) {
	const server = await start(dir);
	pid = project();
	return server;
}

const names = (p = pid) => listFiles(p).map((f) => f.name).sort();
const mainId = () => listFiles(pid).find((f) => f.name === 'main.tex')!.id;

describe('file service', () => {
	it('creates, renames, moves and deletes', async () => {
		await setup();
		const chapters = createEntry(pid, { kind: 'folder', name: 'chapters', parentId: null });
		const intro = createEntry(pid, { kind: 'text', name: 'intro.tex', parentId: chapters.id });
		expect(intro).toMatchObject({ kind: 'text', parentId: chapters.id, name: 'intro.tex' });
		expect(await getText(intro.id)).toBe('');

		expect(renameOrMove(pid, intro.id, { name: 'Intro.tex' }).name).toBe('Intro.tex'); // case-only rename of itself
		const moved = renameOrMove(pid, intro.id, { parentId: null });
		expect(moved.parentId).toBeNull();
		renameOrMove(pid, chapters.id, { name: 'parts' });
		expect(names()).toEqual(['Intro.tex', 'main.tex', 'parts']);

		deleteEntry(pid, moved.id);
		expect(names()).toEqual(['main.tex', 'parts']);
		expect(status(() => deleteEntry(pid, moved.id))).toBe(404);
	});

	it('refuses bad names, collisions, kind changes, cycles and non-folder parents', async () => {
		await setup();
		const a = createEntry(pid, { kind: 'folder', name: 'a', parentId: null });
		const b = createEntry(pid, { kind: 'folder', name: 'b', parentId: a.id });
		const notes = createEntry(pid, { kind: 'text', name: 'notes.txt', parentId: null });

		expect(status(() => createEntry(pid, { kind: 'text', name: 'Main.TEX', parentId: null }))).toBe(409);
		expect(status(() => createEntry(pid, { kind: 'text', name: 'x/y.tex', parentId: null }))).toBe(400);
		expect(status(() => createEntry(pid, { kind: 'text', name: '..', parentId: null }))).toBe(400);
		expect(status(() => createEntry(pid, { kind: 'text', name: 'logo.png', parentId: null }))).toBe(400);
		expect(status(() => createEntry(pid, { kind: 'text', name: 'c.tex', parentId: notes.id }))).toBe(400);
		expect(status(() => renameOrMove(pid, notes.id, { name: 'notes.png' }))).toBe(400);
		expect(status(() => renameOrMove(pid, notes.id, { name: 'MAIN.tex' }))).toBe(409);
		expect(status(() => renameOrMove(pid, a.id, { parentId: a.id }))).toBe(400);
		expect(status(() => renameOrMove(pid, a.id, { parentId: b.id }))).toBe(400);
		expect(status(() => renameOrMove(pid, 'nope', { name: 'x.tex' }))).toBe(404);
		createEntry(pid, { kind: 'text', name: 'notes.txt', parentId: a.id });
		expect(status(() => renameOrMove(pid, notes.id, { parentId: a.id }))).toBe(409); // taken in the target
		expect(status(() => setMainFile(pid, notes.id))).toBe(400);
		expect(names()).toEqual(['a', 'b', 'main.tex', 'notes.txt', 'notes.txt']);
	});

	it('stops at the file-count limit', async () => {
		await setup();
		process.env.PROJECT_MAX_FILES = '3';
		cleanup.push(() => delete process.env.PROJECT_MAX_FILES);
		createEntry(pid, { kind: 'text', name: 'a.tex', parentId: null });
		createEntry(pid, { kind: 'folder', name: 'f', parentId: null });
		expect(status(() => createEntry(pid, { kind: 'text', name: 'b.tex', parentId: null }))).toBe(413);
	});

	it('deletes a folder with its descendants, their Yjs rows and the main marker', async () => {
		const server = await setup();
		const ch = createEntry(pid, { kind: 'folder', name: 'ch', parentId: null });
		const sub = createEntry(pid, { kind: 'folder', name: 'sub', parentId: ch.id });
		const deep = createEntry(pid, { kind: 'text', name: 'deep.tex', parentId: sub.id });
		await setText(deep.id, 'deep text'); // stores a snapshot on disconnect
		setMainFile(pid, deep.id);
		const rowsOf = (id: string) => [
			...server.db.select().from(documents).all().filter((d) => d.name === id),
			...server.db.select().from(updates).all().filter((u) => u.docName === id)
		];
		expect(rowsOf(deep.id).length).toBeGreaterThan(0);

		deleteEntry(pid, ch.id);
		expect(names()).toEqual(['main.tex']);
		expect(rowsOf(deep.id)).toEqual([]);
		expect(getMainFileId(pid)).toBeNull();
	});

	it('a late store or change after delete does not bring the document back', async () => {
		const server = await setup();
		const f = createEntry(pid, { kind: 'text', name: 'gone.tex', parentId: null });
		const client = await connect(server.url, f.id);
		const direct = await server.hocuspocus.openDirectConnection(f.id);
		client.text.insert(0, 'typed');
		await waitFor(() => server.db.select().from(updates).all().some((u) => u.docName === f.id));

		deleteEntry(pid, f.id);
		await direct.transact((doc) => doc.getText('content').insert(0, 'late ')); // onChange
		await direct.disconnect(); // runs onStoreDocument
		await new Promise((r) => setTimeout(r, 600)); // past the debounce
		expect(server.db.select().from(documents).all().filter((d) => d.name === f.id)).toEqual([]);
		expect(server.db.select().from(updates).all().filter((u) => u.docName === f.id)).toEqual([]);
	});

	it('refuses connections to deleted files', async () => {
		const server = await setup();
		const f = createEntry(pid, { kind: 'text', name: 'x.tex', parentId: null });
		deleteEntry(pid, f.id);
		const doc = new Y.Doc();
		const provider = new HocuspocusProvider({ url: server.url, name: f.id, document: doc, token: 'test:owner@test.local' });
		cleanup.push(() => provider.destroy());
		await new Promise<void>((resolve) => provider.on('authenticationFailed', () => resolve()));
	});

	it('setText reaches a connected editor', async () => {
		const server = await setup();
		const client = await connect(server.url, mainId());
		expect(client.text.toString()).toBe(SEED);
		await setText(mainId(), 'replaced\n');
		await waitFor(() => client.text.toString() === 'replaced\n');
		expect(await getText(mainId())).toBe('replaced\n');
	});

	it('a project emptied by the user stays empty after a restart', async () => {
		const dir = tempDir();
		await setup(dir);
		deleteEntry(pid, mainId());
		await start(dir);
		expect(listFiles(pid)).toEqual([]);
		expect(getMainFileId(pid)).toBeNull();
	});

	it('uploads: 409 with existingId, replace keeps the id, kind change refused, size limit', async () => {
		await setup();
		const bytes = (s: string) => new TextEncoder().encode(s);
		/** The FileError an async call rejects with. */
		const rejected = (p: Promise<unknown>) => p.then(() => expect.fail('expected a FileError'), (e) => e as { status: number; existingId?: string });

		const bib = await uploadFile(pid, null, 'refs.bib', bytes('@book{a}'), false);
		expect(bib).toMatchObject({ replaced: false, entry: { kind: 'text', name: 'refs.bib' } });
		expect(await rejected(uploadFile(pid, null, 'REFS.bib', bytes('x'), false))).toMatchObject({ status: 409, existingId: bib.entry.id });
		const again = await uploadFile(pid, null, 'refs.bib', bytes('@book{b}'), true);
		expect(again).toMatchObject({ replaced: true, entry: { id: bib.entry.id } });
		expect(await getText(bib.entry.id)).toBe('@book{b}');

		const png = await uploadFile(pid, null, 'dot.png', new Uint8Array([1, 2, 3]), false);
		const png2 = await uploadFile(pid, null, 'dot.png', new Uint8Array([4, 5, 6, 7]), true);
		expect(png2.entry).toMatchObject({ id: png.entry.id, kind: 'binary', size: 4 });

		// a non-UTF-8 .bib is binary, so it can't replace the text one
		expect((await rejected(uploadFile(pid, null, 'refs.bib', new Uint8Array([0xff, 0xfe]), true))).status).toBe(409);
		expect(await getText(bib.entry.id)).toBe('@book{b}');

		process.env.UPLOAD_MAX_FILE_MB = '1';
		cleanup.push(() => delete process.env.UPLOAD_MAX_FILE_MB);
		expect((await rejected(uploadFile(pid, null, 'big.png', new Uint8Array(1024 * 1024 + 1), false))).status).toBe(413);
		expect(names()).toEqual(['dot.png', 'main.tex', 'refs.bib']);
	});

	it('keeps projects apart: names, lookups, limits and deletes are per project', async () => {
		await setup();
		const other = project('other@test.local');
		const mine = createEntry(pid, { kind: 'text', name: 'notes.tex', parentId: null });
		// the same name in another project is fine
		const theirs = createEntry(other, { kind: 'text', name: 'notes.tex', parentId: null });
		expect(getFile(other, mine.id)).toBeNull();
		expect(status(() => renameOrMove(other, mine.id, { name: 'x.tex' }))).toBe(404);
		expect(status(() => deleteEntry(other, mine.id))).toBe(404);
		expect(status(() => setMainFile(other, mine.id))).toBe(404);
		// a folder of another project is no target
		const folder = createEntry(other, { kind: 'folder', name: 'f', parentId: null });
		expect(status(() => createEntry(pid, { kind: 'text', name: 'y.tex', parentId: folder.id }))).toBe(404);
		expect(status(() => renameOrMove(pid, mine.id, { parentId: folder.id }))).toBe(404);

		// three entries each, six in all: the limit of four counts per project
		process.env.PROJECT_MAX_FILES = '4';
		cleanup.push(() => delete process.env.PROJECT_MAX_FILES);
		createEntry(pid, { kind: 'text', name: 'third.tex', parentId: null });
		createEntry(pid, { kind: 'text', name: 'fourth.tex', parentId: null });
		createEntry(other, { kind: 'folder', name: 'g', parentId: null });
		expect(status(() => createEntry(pid, { kind: 'text', name: 'fifth.tex', parentId: null }))).toBe(413);

		deleteEntry(other, theirs.id);
		expect(names()).toEqual(['fourth.tex', 'main.tex', 'notes.tex', 'third.tex']);
		expect(names(other)).toEqual(['f', 'g', 'main.tex']);
	});
});
