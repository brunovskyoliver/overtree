import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { attachCollab } from '../../src/lib/server/collab.ts';
import { collectProject, compileDir, compileProject, tarProject } from '../../src/lib/server/compile.ts';
import { createEntry, deleteEntry, FileError, listFiles, setMainFile, setText, uploadFile } from '../../src/lib/server/files.ts';
import { zipSync } from 'fflate';
import { importZip } from '../../src/lib/server/zip.ts';
import { readTree } from '../fixtures/projects/zips.ts';

// Real Docker with texlive/texlive:latest-medium (see quickstart.md). Each test gets a fresh data dir.
const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	while (cleanup.length) await cleanup.pop()!();
});

async function start() {
	const http = createServer();
	const collab = attachCollab(http, mkdtempSync(join(tmpdir(), 'overtree-test-')));
	await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
	cleanup.push(async () => {
		http.closeAllConnections();
		await new Promise((r) => http.close(r));
	});
}

/** Puts a fixture project into the (fresh) project; root files replace the seeded main.tex. */
async function load(name: string) {
	for (const [path, bytes] of Object.entries(readTree(join(import.meta.dirname, '../fixtures/projects', name)))) {
		const parts = path.split('/');
		let parentId: string | null = null;
		for (const folder of parts.slice(0, -1)) {
			const found = listFiles().find((f) => f.parentId === parentId && f.name === folder);
			parentId = (found ?? createEntry({ kind: 'folder', name: folder, parentId })).id;
		}
		await uploadFile(parentId, parts.at(-1)!, bytes, true);
	}
}

const idOf = (name: string) => listFiles().find((f) => f.name === name)!.id;
const outputLog = () => readFileSync(join(compileDir(), 'output.log'), 'utf8');

describe('multi-file compile', { timeout: 60_000 }, () => {
	it('compiles the multi project with \\input, \\include, an image and bibtex', async () => {
		await start();
		await load('multi');
		const r = await compileProject({ stopOnFirstError: false });
		expect(r.status).toBe('success');
		const log = outputLog();
		expect(log).toContain('chapters/intro.tex');
		expect(log).toContain('<figures/dot.png');
		expect(log).not.toContain("Citation `knuth84' undefined");
		// \pdfcompresslevel=0 in the fixture: the page streams are plain text, `[(INTR)28(O-MARKER)]TJ` with kerns dropped
		const pdf = readFileSync(join(compileDir(), 'output.pdf')).toString('latin1').replace(/\)-?\d+\(/g, '');
		expect(pdf).toContain('INTRO-MARKER');
		expect(pdf).toContain('TeXbook'); // the bibliography entry's title
	});

	it('compiles a main document in a subfolder relative to its folder', async () => {
		await start();
		await load('sub-main');
		setMainFile(idOf('thesis.tex'));
		const r = await compileProject({ stopOnFirstError: false });
		expect(r.status).toBe('success');
		expect(r.entries.filter((e) => e.level === 'error')).toEqual([]);
	});

	it('links an error in an included file to that file and line', async () => {
		await start();
		await load('multi');
		const intro = idOf('intro.tex');
		await setText(intro, '\\section{Introduction}\n\nThis chapter holds the INTRO-MARKER text.\n\\undefinedmacro\n');
		const r = await compileProject({ stopOnFirstError: false });
		expect(r.entries.find((e) => e.level === 'error')).toMatchObject({ file: 'chapters/intro.tex', line: 4, fileId: intro });
	});

	it('fails without starting a container when there is no main document', async () => {
		await start();
		deleteEntry(idOf('main.tex'));
		const r = await compileProject({ stopOnFirstError: false });
		expect(r).toMatchObject({ status: 'failure', message: expect.stringMatching(/^No main document\./), entries: [] });
	});
});

// SC-002: thesis-like projects zipped from their source folders at test time; page counts in samples/README.md
describe('sample projects', { timeout: 60_000 }, () => {
	it.each([
		['thesis-book', 17],
		['article-biblatex', 2],
		['report-sty', 5]
	])('imports and compiles %s to %i pages', async (name, pages) => {
		await start();
		importZip(zipSync(readTree(join(import.meta.dirname, '../fixtures/projects/samples', name))));
		const r = await compileProject({ stopOnFirstError: false });
		expect(r.status).toBe('success');
		const log = outputLog();
		expect(log).toMatch(new RegExp(`Output written on \\S+ \\(${pages} pages?,`));
		expect(log).not.toMatch(/undefined (citation|reference)|Citation .* undefined|Reference .* undefined/i);
	});
});

describe('tarProject', () => {
	it('never writes absolute or parent paths; the service refuses such names', async () => {
		await start();
		await load('multi');
		expect(() => createEntry({ kind: 'text', name: '../x.tex', parentId: null })).toThrow(FileError);
		const { files } = await collectProject();
		const listed = execFileSync('tar', ['-tf', '-'], { input: tarProject(files), encoding: 'utf8' }).trim().split('\n');
		expect(listed.sort()).toEqual(['chapters/intro.tex', 'chapters/two.tex', 'figures/dot.png', 'main.tex', 'refs.bib']);
		for (const p of listed) expect(p).not.toMatch(/^\/|(^|\/)\.\.(\/|$)/);
	});

	it('splits long paths into prefix and name, and refuses paths over 255 bytes', () => {
		const long = `${'d'.repeat(120)}/${'f'.repeat(90)}.tex`;
		const tar = tarProject([{ path: long, data: Buffer.from('x') }]);
		expect(execFileSync('tar', ['-tf', '-'], { input: tar, encoding: 'utf8' }).trim()).toBe(long);
		expect(() => tarProject([{ path: `${'d'.repeat(200)}/${'f'.repeat(90)}`, data: Buffer.from('') }])).toThrow(/too long/);
	});
});
