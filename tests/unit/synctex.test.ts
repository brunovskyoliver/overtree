// The fixture is a real compile of tests/fixtures/projects/multi (pdflatex, texlive/texlive:latest-medium, 3 pages of
// 612×792 bp). Regenerate it with this script (run with `node`, Docker + the TeX Live image needed):
//
//   import { writeFileSync } from 'node:fs';
//   import { runCompile } from '../../src/lib/server/compile.ts';
//   import { readTree } from '../fixtures/projects/zips.ts';
//   const files = Object.entries(readTree('tests/fixtures/projects/multi')).map(([path, d]) => ({ path, data: Buffer.from(d) }));
//   const r = await runCompile({ files, mainPath: 'main.tex', compiler: 'pdflatex', stopOnFirstError: false, timeoutMs: 60000 });
//   writeFileSync('tests/fixtures/synctex/multi.synctex.gz', r.synctex!);
//   process.exit(0);
//
// multi.sync.json is what compileOnce would write, with made-up file ids.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileDir } from '../../src/lib/server/compile.ts';
import { buildIndex, forward, forwardSearch, reverse, reverseSearch, type SyncJson } from '../../src/lib/server/synctex.ts';
import { project, start } from './helpers.ts';

const FIXTURE = join(import.meta.dirname, '../fixtures/synctex');
const gz = readFileSync(join(FIXTURE, 'multi.synctex.gz'));
const sync: SyncJson = JSON.parse(readFileSync(join(FIXTURE, 'multi.sync.json'), 'utf8'));
const index = buildIndex(gz, sync);
const centre = (b: { x: number; y: number; width: number; height: number }) => [b.x + b.width / 2, b.y + b.height / 2] as const;

describe('synctex parser', () => {
	it('maps the project inputs and nothing else', () => {
		expect([...new Set(index.files.values())].sort()).toEqual(['f-intro', 'f-main', 'f-two']);
		expect(index.pages.size).toBe(3);
	});

	it('forward: a line of chapters/intro.tex lands on page 1, inside the page, below the heading', () => {
		const r = forwardSearch(index, 'f-intro', 3)!;
		expect(r.page).toBe(1);
		expect(r.boxes).toHaveLength(1);
		const [b] = r.boxes;
		// a text line: inside the 612×792 page with 1in margins, about one line high, under the section heading
		expect(b.x).toBeGreaterThan(72);
		expect(b.x + b.width).toBeLessThan(612 - 72);
		expect(b.y).toBeGreaterThan(72);
		expect(b.y + b.height).toBeLessThan(792 - 72);
		expect(b.height).toBeGreaterThan(5);
		expect(b.height).toBeLessThan(15);
		expect(b.y).toBeGreaterThan(forwardSearch(index, 'f-intro', 1)!.boxes[0].y);
	});

	it('reverse of that box returns the file and line', () => {
		const [x, y] = centre(forwardSearch(index, 'f-intro', 3)!.boxes[0]);
		const r = reverseSearch(index, 1, x, y)!;
		expect(r.fileId).toBe('f-intro');
		expect(Math.abs(r.line - 3)).toBeLessThanOrEqual(2);
	});

	it('round-trips main.tex and the \\include-d chapter on their pages', () => {
		const main = forwardSearch(index, 'f-main', 13)!; // "As shown by \cite{knuth84}." after the \include page break
		expect(main.page).toBe(3);
		expect(reverseSearch(index, 3, ...centre(main.boxes[0]))).toEqual({ fileId: 'f-main', line: 13 });
		const two = forwardSearch(index, 'f-two', 3)!;
		expect(two.page).toBe(2);
		expect(reverseSearch(index, 2, ...centre(two.boxes[0]))?.fileId).toBe('f-two');
	});

	it('a line without records falls back to the nearest earlier line that has some', () => {
		expect(forwardSearch(index, 'f-intro', 4)).toEqual(forwardSearch(index, 'f-intro', 3));
		expect(forwardSearch(index, 'f-intro', 400)).toEqual(forwardSearch(index, 'f-intro', 5));
		// nothing earlier (the preamble): the first line that has records
		expect(forwardSearch(index, 'f-main', 1)?.page).toBe(1);
	});

	it('TeX Live and generated inputs map to nothing', () => {
		expect(forwardSearch(index, 'f-refs', 1)).toBeNull(); // refs.bib is read by bibtex, not TeX
		// the bibliography entry comes from main.bbl
		const entry = [...index.pages.get(3)!.records].find((r) => r.kind === '(' && r.tag !== 1 && r.line === 7)!;
		expect(reverseSearch(index, 3, ...centre(entry.rect!))).toBeNull();
	});

	it('a point outside every box goes to the nearest record', () => {
		const [, y] = centre(forwardSearch(index, 'f-intro', 3)!.boxes[0]);
		expect(reverseSearch(index, 1, 600, y)).toEqual({ fileId: 'f-intro', line: 4 }); // right margin: the line's end
	});
});

describe('loadIndex', () => {
	it('answers only for the last PDF of the project', async () => {
		await start();
		const pid = project();
		const dir = compileDir(pid);
		mkdirSync(dir, { recursive: true });
		expect(await forward(pid, 'fixture', 'f-intro', 3)).toBeNull(); // no compile yet
		copyFileSync(join(FIXTURE, 'multi.synctex.gz'), join(dir, 'output.synctex.gz'));
		writeFileSync(join(dir, 'sync.json'), JSON.stringify(sync));
		expect((await forward(pid, 'fixture', 'f-intro', 3))?.page).toBe(1);
		expect(await forward(pid, 'older', 'f-intro', 3)).toBeNull();
		expect((await reverse(pid, 'fixture', 1, ...centre((await forward(pid, 'fixture', 'f-intro', 3))!.boxes[0])))?.fileId).toBe('f-intro');
	});
});
