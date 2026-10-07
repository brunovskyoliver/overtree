import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { pathOf } from '../../src/lib/files.ts';
import { collectProject } from '../../src/lib/server/compile.ts';
import { createEntry, getMainFileId, listFiles } from '../../src/lib/server/files.ts';
import { projects } from '../../src/lib/server/schema.ts';
import { exportZip, importZipAsProject } from '../../src/lib/server/zip.ts';
import { readTree, zips } from '../fixtures/projects/zips.ts';
import { start, status, user } from './helpers.ts';

// Project zip export/import (research R7, SC-003, SC-007; 005: import creates a project). Each test gets a fresh data dir.

const MULTI = Object.fromEntries(
	Object.entries(readTree(join(import.meta.dirname, '../fixtures/projects/multi'))).map(([p, d]) => [p, new Uint8Array(d)])
);

const importZip = (bytes: Uint8Array, title = 'Imported') => importZipAsProject(user().id, title, bytes);

/** Every file of the project by path, content as bytes. */
const contents = async (pid: string) => Object.fromEntries((await collectProject(pid)).files.map((f) => [f.path, new Uint8Array(f.data)]));
const paths = (pid: string) => {
	const all = listFiles(pid);
	return all.map((f) => pathOf(f.id, all) + (f.kind === 'folder' ? '/' : '')).sort();
};
const mainPath = (pid: string) => {
	const id = getMainFileId(pid);
	return id && pathOf(id, listFiles(pid));
};

describe('project zip', () => {
	it('round trip: export then import gives the same tree and byte-identical files (SC-003)', async () => {
		await start();
		const pid = importZip(zips.roundtrip());
		expect(await contents(pid)).toEqual(MULTI);
		expect(mainPath(pid)).toBe('main.tex');
		createEntry(pid, { kind: 'folder', name: 'empty', parentId: null }, user().id);
		const before = paths(pid);

		const exported = await exportZip(pid);
		expect(Object.keys(unzipSync(exported)).sort()).toEqual(before);
		const copy = importZip(exported);
		expect(copy).not.toBe(pid);
		expect(paths(copy)).toEqual(before); // the empty folder is kept
		expect(await contents(copy)).toEqual(MULTI);
		expect(listFiles(copy).find((f) => f.name === 'refs.bib')!.kind).toBe('text');
		expect(listFiles(copy).find((f) => f.name === 'dot.png')!.kind).toBe('binary');
	});

	it('creates a project owned by the importer with the given title', async () => {
		const server = await start();
		const pid = importZip(zips.roundtrip(), '  Thesis  ');
		expect(server.db.select().from(projects).all()).toMatchObject([{ id: pid, title: 'Thesis', ownerId: user().id }]);
		expect(status(() => importZip(zips.roundtrip(), ' '))).toBe(422);
	});

	it('strips a wrapper folder and skips __MACOSX and .DS_Store', async () => {
		await start();
		expect(await contents(importZip(zips.wrapped()))).toEqual(MULTI);
		const junk = importZip(zips.junk());
		expect(await contents(junk)).toEqual(MULTI);
		expect(paths(junk).some((p) => p.includes('MACOSX') || p.includes('DS_Store'))).toBe(false);
	});

	it('skips unsafe entries and writes nothing outside the project (SC-007)', async () => {
		const { dataDir } = await start();
		const pid = importZip(zips.evil());
		expect(paths(pid)).toEqual(['main.tex']); // no ../evil.tex, /abs.tex, C:\x.tex or symlink
		for (const name of readdirSync(dataDir)) expect(name).toMatch(/^(overtree\.db.*|blobs|compile)$/);
		expect(readdirSync(join(dataDir, '..')).some((n) => n.includes('evil'))).toBe(false);
	});

	it('refuses bombs, too many entries and non-zips without creating a project', async () => {
		const server = await start();
		vi.stubEnv('IMPORT_MAX_MB', '1');
		try {
			expect(status(() => importZip(zips.bomb()))).toBe(413);
		} finally {
			vi.unstubAllEnvs();
		}
		expect(status(() => importZip(zips['too-many']()))).toBe(413);
		expect(status(() => importZip(zips['not-a-zip']()))).toBe(400);
		expect(status(() => importZip(new Uint8Array()))).toBe(400);
		expect(status(() => importZip(zipSync({ '__MACOSX/x': strToU8('only junk') })))).toBe(400);
		expect(server.db.select().from(projects).all()).toEqual([]);
	});

	it('picks the main document: root main.tex, else the shallowest .tex with \\documentclass, else none', async () => {
		await start();
		const doc = strToU8('\\documentclass{article}\n');
		expect(mainPath(importZip(zipSync({ 'b.tex': strToU8('no class'), 'sub/a.tex': doc, 'sub/deep/c.tex': doc, 'z/a.tex': doc })))).toBe('sub/a.tex');
		expect(mainPath(importZip(zipSync({ 'notes.tex': strToU8('no class'), 'x.txt': strToU8('x') })))).toBeNull();
	});

	it('stores a .tex that is not UTF-8 as binary', async () => {
		await start();
		const pid = importZip(zipSync({ 'main.tex': strToU8('ok'), 'latin.tex': new Uint8Array([0x63, 0x61, 0x66, 0xe9]) }));
		expect(listFiles(pid).find((f) => f.name === 'latin.tex')).toMatchObject({ kind: 'binary', size: 4 });
		expect(listFiles(pid).find((f) => f.name === 'main.tex')!.kind).toBe('text');
	});
});
