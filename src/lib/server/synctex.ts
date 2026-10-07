import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { SyncBox, SyncCode, SyncPdf } from '../synctex.ts';
import { compileDir } from './compile.ts';

// SyncTeX navigation (research R9): the compile's `output.synctex.gz` parsed here, in TypeScript (Principle III: no
// TeX tools in the app). The format is line based: a preamble (Unit, X/Y Offset, Magnification), `Input:<tag>:<path>`
// lines (anywhere, also between pages), and per page `{n` … `}n` with box records `[`/`(` (vbox/hbox, closed by
// `]`/`)`), void boxes `v`/`h` and points `x` (char), `k` (kern), `g` (glue), `$` (math), each
// `<kind><tag>,<line>[,<column>]:<h>,<v>[:<W>[,<H>,<D>]]` in scaled points from the page's top-left, v on the baseline.

/** What `compileOnce` writes next to the synctex file: the paths as they were when it compiled. */
export type SyncJson = { pdfId: string; mainPath: string; paths: Record<string, string> };

type Rect = SyncBox;
type Rec = {
	kind: string;
	tag: number;
	line: number;
	h: number;
	v: number;
	rect?: Rect; // boxes only
	parent?: Rec; // the innermost enclosing hbox
	children?: Rec[]; // hboxes: their direct records
};
type Page = { records: Rec[] };

export type SyncIndex = { pages: Map<number, Page>; files: Map<number, string> };

const RECORD = /^([[(vhxkg$])(\d+),(\d+)(?:,-?\d+)?:(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/;
const SP_PER_BP = 65781.76; // 65536 sp/pt × 72.27 pt/in ÷ 72 bp/in
// latexmk runs in /tmp/p/$MAIN_DIR (compile.ts): absolute inputs start with this, relative ones are from the main's folder
const ROOT = '/tmp/p/';

/** Parse an `output.synctex.gz` and map its inputs to project files with the compile's `sync.json`. Inputs outside
 *  the project (TeX Live, generated .aux/.bbl) map to nothing. */
export function buildIndex(gz: Buffer, sync: SyncJson): SyncIndex {
	const files = new Map<number, string>();
	const pages = new Map<number, Page>();
	let unit = 1;
	let mag = 1000;
	let xOff = 0;
	let yOff = 0;
	const pt = (sp: number, off: number) => ((sp * unit + off) * mag) / 1000 / SP_PER_BP;
	const size = (sp: number) => (Math.abs(sp) * unit * mag) / 1000 / SP_PER_BP;

	let page: Page | undefined;
	const open: Rec[] = []; // boxes not closed yet, innermost last
	const hbox = () => open.findLast((b) => b.kind === '(');

	for (const raw of gunzipSync(gz).toString('utf8').split('\n')) {
		const line = raw.trimEnd();
		if (line.startsWith('Input:')) {
			const [, tag, ...rest] = line.split(':');
			const fileId = fileOf(rest.join(':'), sync);
			if (fileId) files.set(Number(tag), fileId);
		} else if (line.startsWith('Unit:')) unit = Number(line.slice(5)) || 1;
		else if (line.startsWith('Magnification:')) mag = Number(line.slice(14)) || 1000;
		// ponytail: offsets are read as sp; current engines write 0 (the 1in margin is already in the coordinates)
		else if (line.startsWith('X Offset:')) xOff = Number(line.slice(9)) || 0;
		else if (line.startsWith('Y Offset:')) yOff = Number(line.slice(9)) || 0;
		else if (line[0] === '{') {
			page = { records: [] };
			pages.set(Number(line.slice(1)), page);
			open.length = 0;
		} else if (line[0] === '}') page = undefined;
		else if (line === ']' || line === ')') open.pop();
		else if (page) {
			const m = RECORD.exec(line);
			if (!m) continue; // form refs (`f`, `<`, `>`), byte offsets (`!`), anything newer
			const [, kind, tag, ln, h, v, w, ht, d] = m;
			const rec: Rec = { kind, tag: Number(tag), line: Number(ln), h: pt(Number(h), xOff), v: pt(Number(v), yOff), parent: hbox() };
			if (ht !== undefined) {
				const height = size(Number(ht));
				rec.rect = { x: rec.h, y: rec.v - height, width: size(Number(w)), height: height + size(Number(d)) };
			}
			page.records.push(rec);
			rec.parent?.children!.push(rec);
			if (kind === '[' || kind === '(') open.push(rec);
			if (kind === '(') rec.children = [];
		}
	}
	return { pages, files };
}

/** The project file of a synctex input path, if it is one. */
function fileOf(name: string, { mainPath, paths }: SyncJson): string | undefined {
	const abs = name.startsWith('/') ? posix.normalize(name) : posix.normalize(posix.join(ROOT, posix.dirname(mainPath), name));
	return abs.startsWith(ROOT) ? paths[abs.slice(ROOT.length)] : undefined;
}

const area = (r?: Rect) => (r ? r.width * r.height : 0);
const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

/** Source → PDF: the boxes of `line` of `fileId` on the first page that has it. A line without records (blank,
 *  comment, edited since) falls back to the nearest earlier line that has some, else the nearest later one. */
export function forwardSearch(index: SyncIndex, fileId: string, line: number): SyncPdf | null {
	const tags = new Set([...index.files].filter(([, id]) => id === fileId).map(([tag]) => tag));
	const all = [...index.pages].flatMap(([n, p]) => p.records.filter((r) => tags.has(r.tag)).map((r) => ({ n, r })));
	if (!all.length) return null;
	const lines = all.map(({ r }) => r.line);
	const earlier = lines.filter((l) => l <= line);
	const target = earlier.length ? Math.max(...earlier) : Math.min(...lines);
	const hits = all.filter(({ r }) => r.line === target);
	const n = Math.min(...hits.map((h) => h.n));
	const recs = hits.filter((h) => h.n === n).map((h) => h.r);

	// a point or void box stands for the line box (hbox) it sits in; vboxes only when nothing else matched
	const rects = (vbox: boolean) =>
		recs
			.filter((r) => (r.kind === '[') === vbox)
			.map((r) => (r.kind === '(' || r.kind === '[' ? r.rect : (r.parent?.rect ?? r.rect)))
			.filter((r): r is Rect => area(r) > 0);
	let boxes = [...new Set(rects(false))];
	if (!boxes.length) boxes = [...new Set(rects(true))];
	// nested or repeated boxes: keep the outermost, once
	boxes = boxes.filter((b, i) => !boxes.some((o, j) => o !== b && inside(b, o) && (!inside(o, b) || j < i)));
	return { page: n, boxes };
}

/** PDF → source: the record under the point (x, y in PDF points from the page's top-left). The line box (hbox) is
 *  the smallest one around the point, else the nearest by vertical then horizontal distance; in it, the last record
 *  starting left of the point (the word clicked). Null when that record comes from no project file (US3 #6). */
export function reverseSearch(index: SyncIndex, page: number, x: number, y: number): SyncCode | null {
	const gap = (p: number, lo: number, len: number) => Math.max(lo - p, p - (lo + len), 0);
	// [vertical gap, horizontal gap, area]: 0, 0 for the boxes around the point, the smallest of those first
	const key = (r: Rect) => [gap(y, r.y, r.height), gap(x, r.x, r.width), area(r)];
	const before = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
	const boxes = (index.pages.get(page)?.records ?? []).filter((r) => r.kind === '(' && area(r.rect) > 0);
	const box = boxes.map((r) => ({ r, k: key(r.rect!) })).sort((a, b) => before(a.k, b.k))[0]?.r;
	if (!box) return null;
	const pick = (r: Rec) => (index.files.has(r.tag) ? { fileId: index.files.get(r.tag)!, line: Math.max(r.line, 1) } : null);
	const left = box.children!.filter((k) => k.h <= x);
	const word = left.length ? left.reduce((a, b) => (b.h >= a.h ? b : a)) : box.children![0];
	return (word && pick(word)) ?? pick(box);
}

// ponytail: 4 parsed files in memory, keyed by project + pdfId (one synctex per project on disk); upgrade: size-based cap
const MAX_CACHED = 4;
const cache = new Map<string, Promise<SyncIndex | null>>();

/** The parsed synctex of the project's last PDF, or null when `pdfId` isn't that PDF or there is no synctex. */
export function loadIndex(pid: string, pdfId: string, root: string | null = null): Promise<SyncIndex | null> {
	const key = `${pid}:${root ?? ''}:${pdfId}`;
	let entry = cache.get(key);
	if (entry) cache.delete(key); // re-insert: most recently used last
	entry ??= (async () => {
		const dir = compileDir(pid, root);
		try {
			const sync: SyncJson = JSON.parse(await readFile(join(dir, 'sync.json'), 'utf8'));
			if (sync.pdfId !== pdfId) return null;
			return buildIndex(await readFile(join(dir, 'output.synctex.gz')), sync);
		} catch {
			return null;
		}
	})();
	cache.set(key, entry);
	// a miss isn't cached: the compile writing this pdfId's files may still be finishing
	void entry.then((index) => index || cache.get(key) !== entry || cache.delete(key));
	while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
	return entry;
}

export async function forward(pid: string, pdfId: string, fileId: string, line: number) {
	const index = await loadIndex(pid, pdfId);
	return index && forwardSearch(index, fileId, line);
}

export async function reverse(pid: string, pdfId: string, page: number, x: number, y: number) {
	const index = await loadIndex(pid, pdfId);
	return index && reverseSearch(index, page, x, y);
}
