import { mkdtempSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { pathOf } from '../../src/lib/files.ts';
import { attachCollab } from '../../src/lib/server/collab.ts';
import { collectProject } from '../../src/lib/server/compile.ts';
import { createEntry, getMainFileId, getText, listFiles } from '../../src/lib/server/files.ts';
import { exportZip, importZip } from '../../src/lib/server/zip.ts';
import { readTree, zips } from '../fixtures/projects/zips.ts';

// Project zip export/import (research R7, SC-003, SC-007). Each test gets a fresh data dir.
const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	while (cleanup.length) await cleanup.pop()!();
});

async function start() {
	const dataDir = mkdtempSync(join(tmpdir(), 'overtree-test-'));
	const http = createServer();
	attachCollab(http, dataDir);
	await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
	cleanup.push(async () => {
		http.closeAllConnections();
		await new Promise((r) => http.close(r));
	});
	return dataDir;
}

const MULTI = Object.fromEntries(
	Object.entries(readTree(join(import.meta.dirname, '../fixtures/projects/multi'))).map(([p, d]) => [p, new Uint8Array(d)])
);

/** Every file of the project by path, content as bytes. */
const contents = async () => Object.fromEntries((await collectProject()).files.map((f) => [f.path, new Uint8Array(f.data)]));
const paths = () => {
	const all = listFiles();
	return all.map((f) => pathOf(f.id, all) + (f.kind === 'folder' ? '/' : '')).sort();
};
const mainPath = () => {
	const id = getMainFileId();
	return id && pathOf(id, listFiles());
};

function status(fn: () => unknown) {
	try {
		fn();
	} catch (e) {
		return (e as { status?: number }).status;
	}
	throw new Error('expected a FileError');
}

describe('project zip', () => {
	it('round trip: export then import gives the same tree and byte-identical files (SC-003)', async () => {
		await start();
		importZip(zips.roundtrip());
		expect(await contents()).toEqual(MULTI);
		expect(mainPath()).toBe('main.tex');
		createEntry({ kind: 'folder', name: 'empty', parentId: null });
		const before = paths();

		const exported = await exportZip();
		expect(Object.keys(unzipSync(exported)).sort()).toEqual(before);
		importZip(exported);
		expect(paths()).toEqual(before); // the empty folder is kept
		expect(await contents()).toEqual(MULTI);
		expect(listFiles().find((f) => f.name === 'refs.bib')!.kind).toBe('text');
		expect(listFiles().find((f) => f.name === 'dot.png')!.kind).toBe('binary');
	});

	it('strips a wrapper folder and skips __MACOSX and .DS_Store', async () => {
		await start();
		importZip(zips.wrapped());
		expect(await contents()).toEqual(MULTI);
		importZip(zips.junk());
		expect(await contents()).toEqual(MULTI);
		expect(paths().some((p) => p.includes('MACOSX') || p.includes('DS_Store'))).toBe(false);
	});

	it('skips unsafe entries and writes nothing outside the project (SC-007)', async () => {
		const dataDir = await start();
		importZip(zips.evil());
		expect(paths()).toEqual(['main.tex']); // no ../evil.tex, /abs.tex, C:\x.tex or symlink
		for (const name of readdirSync(dataDir)) expect(name).toMatch(/^(overtree\.db.*|blobs|compile)$/);
		expect(readdirSync(join(dataDir, '..')).some((n) => n.includes('evil'))).toBe(false);
	});

	it('refuses bombs, too many entries and non-zips without changing the project', async () => {
		await start();
		const before = paths();
		const text = await getText(listFiles()[0].id);
		expect(status(() => importZip(zips.bomb()))).toBe(413);
		expect(status(() => importZip(zips['too-many']()))).toBe(413);
		expect(status(() => importZip(zips['not-a-zip']()))).toBe(400);
		expect(status(() => importZip(new Uint8Array()))).toBe(400);
		expect(status(() => importZip(zipSync({ '__MACOSX/x': strToU8('only junk') })))).toBe(400);
		expect(paths()).toEqual(before);
		expect(await getText(listFiles()[0].id)).toBe(text);
	});

	it('picks the main document: root main.tex, else the shallowest .tex with \\documentclass, else none', async () => {
		await start();
		const doc = strToU8('\\documentclass{article}\n');
		importZip(zipSync({ 'b.tex': strToU8('no class'), 'sub/a.tex': doc, 'sub/deep/c.tex': doc, 'z/a.tex': doc }));
		expect(mainPath()).toBe('sub/a.tex');
		importZip(zipSync({ 'notes.tex': strToU8('no class'), 'x.txt': strToU8('x') }));
		expect(mainPath()).toBeNull();
	});

	it('stores a .tex that is not UTF-8 as binary', async () => {
		await start();
		importZip(zipSync({ 'main.tex': strToU8('ok'), 'latin.tex': new Uint8Array([0x63, 0x61, 0x66, 0xe9]) }));
		expect(listFiles().find((f) => f.name === 'latin.tex')).toMatchObject({ kind: 'binary', size: 4 });
		expect(listFiles().find((f) => f.name === 'main.tex')!.kind).toBe('text');
	});
});
