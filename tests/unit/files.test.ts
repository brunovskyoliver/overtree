import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { attachCollab, SEED } from '../../src/lib/server/collab.ts';
import { openDb } from '../../src/lib/server/db.ts';
import {
	createEntry,
	deleteEntry,
	getMainFileId,
	getText,
	listFiles,
	renameOrMove,
	setMainFile,
	setText
} from '../../src/lib/server/files.ts';
import { documents, updates } from '../../src/lib/server/schema.ts';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	while (cleanup.length) await cleanup.pop()!();
});

const tempDir = () => mkdtempSync(join(tmpdir(), 'overtree-test-'));

async function start(dataDir = tempDir()) {
	const http = createServer();
	const collab = attachCollab(http, dataDir);
	await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
	const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/collab`;
	cleanup.push(async () => {
		for (const ws of collab.wss.clients) ws.terminate();
		http.closeAllConnections();
		await new Promise((r) => http.close(r));
		if (collab.db.$client.open) collab.db.$client.close();
	});
	return { ...collab, url };
}

async function connect(url: string, name: string) {
	const doc = new Y.Doc();
	const provider = new HocuspocusProvider({ url, name, document: doc });
	cleanup.push(() => provider.destroy());
	await new Promise<void>((resolve) => provider.on('synced', () => resolve()));
	return { provider, text: doc.getText('content') };
}

async function waitFor(check: () => boolean, ms = 3000) {
	const until = Date.now() + ms;
	while (!check()) {
		if (Date.now() > until) throw new Error('waitFor timed out');
		await new Promise((r) => setTimeout(r, 10));
	}
}

/** The status of the FileError `fn` throws. */
function status(fn: () => unknown) {
	try {
		fn();
	} catch (e) {
		return (e as { status?: number }).status;
	}
	throw new Error('expected a FileError');
}

const names = () => listFiles().map((f) => f.name).sort();
const mainId = () => listFiles().find((f) => f.name === 'main.tex')!.id;

describe('file service', () => {
	it('creates, renames, moves and deletes', async () => {
		await start();
		const chapters = createEntry({ kind: 'folder', name: 'chapters', parentId: null });
		const intro = createEntry({ kind: 'text', name: 'intro.tex', parentId: chapters.id });
		expect(intro).toMatchObject({ kind: 'text', parentId: chapters.id, name: 'intro.tex' });
		expect(await getText(intro.id)).toBe('');

		expect(renameOrMove(intro.id, { name: 'Intro.tex' }).name).toBe('Intro.tex'); // case-only rename of itself
		const moved = renameOrMove(intro.id, { parentId: null });
		expect(moved.parentId).toBeNull();
		renameOrMove(chapters.id, { name: 'parts' });
		expect(names()).toEqual(['Intro.tex', 'main.tex', 'parts']);

		deleteEntry(moved.id);
		expect(names()).toEqual(['main.tex', 'parts']);
		expect(status(() => deleteEntry(moved.id))).toBe(404);
	});

	it('refuses bad names, collisions, kind changes, cycles and non-folder parents', async () => {
		await start();
		const a = createEntry({ kind: 'folder', name: 'a', parentId: null });
		const b = createEntry({ kind: 'folder', name: 'b', parentId: a.id });
		const notes = createEntry({ kind: 'text', name: 'notes.txt', parentId: null });

		expect(status(() => createEntry({ kind: 'text', name: 'Main.TEX', parentId: null }))).toBe(409);
		expect(status(() => createEntry({ kind: 'text', name: 'x/y.tex', parentId: null }))).toBe(400);
		expect(status(() => createEntry({ kind: 'text', name: '..', parentId: null }))).toBe(400);
		expect(status(() => createEntry({ kind: 'text', name: 'logo.png', parentId: null }))).toBe(400);
		expect(status(() => createEntry({ kind: 'text', name: 'c.tex', parentId: notes.id }))).toBe(400);
		expect(status(() => renameOrMove(notes.id, { name: 'notes.png' }))).toBe(400);
		expect(status(() => renameOrMove(notes.id, { name: 'MAIN.tex' }))).toBe(409);
		expect(status(() => renameOrMove(a.id, { parentId: a.id }))).toBe(400);
		expect(status(() => renameOrMove(a.id, { parentId: b.id }))).toBe(400);
		expect(status(() => renameOrMove('nope', { name: 'x.tex' }))).toBe(404);
		createEntry({ kind: 'text', name: 'notes.txt', parentId: a.id });
		expect(status(() => renameOrMove(notes.id, { parentId: a.id }))).toBe(409); // taken in the target
		expect(status(() => setMainFile(notes.id))).toBe(400);
		expect(names()).toEqual(['a', 'b', 'main.tex', 'notes.txt', 'notes.txt']);
	});

	it('stops at the file-count limit', async () => {
		await start();
		process.env.PROJECT_MAX_FILES = '3';
		cleanup.push(() => delete process.env.PROJECT_MAX_FILES);
		createEntry({ kind: 'text', name: 'a.tex', parentId: null });
		createEntry({ kind: 'folder', name: 'f', parentId: null });
		expect(status(() => createEntry({ kind: 'text', name: 'b.tex', parentId: null }))).toBe(413);
	});

	it('deletes a folder with its descendants, their Yjs rows and the main marker', async () => {
		const server = await start();
		const ch = createEntry({ kind: 'folder', name: 'ch', parentId: null });
		const sub = createEntry({ kind: 'folder', name: 'sub', parentId: ch.id });
		const deep = createEntry({ kind: 'text', name: 'deep.tex', parentId: sub.id });
		await setText(deep.id, 'deep text'); // stores a snapshot on disconnect
		setMainFile(deep.id);
		const rowsOf = (id: string) => [
			...server.db.select().from(documents).all().filter((d) => d.name === id),
			...server.db.select().from(updates).all().filter((u) => u.docName === id)
		];
		expect(rowsOf(deep.id).length).toBeGreaterThan(0);

		deleteEntry(ch.id);
		expect(names()).toEqual(['main.tex']);
		expect(rowsOf(deep.id)).toEqual([]);
		expect(getMainFileId()).toBeNull();
	});

	it('a late store or change after delete does not bring the document back', async () => {
		const server = await start();
		const f = createEntry({ kind: 'text', name: 'gone.tex', parentId: null });
		const client = await connect(server.url, f.id);
		const direct = await server.hocuspocus.openDirectConnection(f.id);
		client.text.insert(0, 'typed');
		await waitFor(() => server.db.select().from(updates).all().some((u) => u.docName === f.id));

		deleteEntry(f.id);
		await direct.transact((doc) => doc.getText('content').insert(0, 'late ')); // onChange
		await direct.disconnect(); // runs onStoreDocument
		await new Promise((r) => setTimeout(r, 600)); // past the debounce
		expect(server.db.select().from(documents).all().filter((d) => d.name === f.id)).toEqual([]);
		expect(server.db.select().from(updates).all().filter((u) => u.docName === f.id)).toEqual([]);
	});

	it('refuses connections to deleted files', async () => {
		const server = await start();
		const f = createEntry({ kind: 'text', name: 'x.tex', parentId: null });
		deleteEntry(f.id);
		const doc = new Y.Doc();
		const provider = new HocuspocusProvider({ url: server.url, name: f.id, document: doc });
		cleanup.push(() => provider.destroy());
		await new Promise<void>((resolve) => provider.on('authenticationFailed', () => resolve()));
	});

	it('setText reaches a connected editor', async () => {
		const server = await start();
		const client = await connect(server.url, mainId());
		expect(client.text.toString()).toBe(SEED);
		await setText(mainId(), 'replaced\n');
		await waitFor(() => client.text.toString() === 'replaced\n');
		expect(await getText(mainId())).toBe('replaced\n');
	});

	it('upgrades a 002 data dir: main.tex keeps its text and becomes the main file', async () => {
		const dir = tempDir();
		// what 002 wrote: Yjs rows under the name 'main.tex', no files/project rows
		const legacy = openDb(dir);
		const doc = new Y.Doc();
		doc.getText('content').insert(0, '% from 002\n');
		const state = Buffer.from(Y.encodeStateAsUpdate(doc));
		legacy.insert(documents).values({ name: 'main.tex', state, updatedAt: 1 }).run();
		const more = new Y.Doc();
		Y.applyUpdate(more, state);
		const before = Y.encodeStateVector(more);
		more.getText('content').insert(more.getText('content').length, 'tail');
		legacy.insert(updates).values({ docName: 'main.tex', update: Buffer.from(Y.encodeStateAsUpdate(more, before)), createdAt: 2 }).run();
		legacy.$client.close();

		const server = await start(dir);
		const files = listFiles();
		expect(files).toMatchObject([{ name: 'main.tex', kind: 'text', parentId: null }]);
		expect(getMainFileId()).toBe(files[0].id);
		expect(server.db.select().from(documents).all().map((d) => d.name)).toEqual([files[0].id]);
		const client = await connect(server.url, files[0].id);
		expect(client.text.toString()).toBe('% from 002\ntail');
	});

	it('a project emptied by the user stays empty after a restart', async () => {
		const dir = tempDir();
		await start(dir);
		deleteEntry(mainId());
		await start(dir);
		expect(listFiles()).toEqual([]);
		expect(getMainFileId()).toBeNull();
	});
});
