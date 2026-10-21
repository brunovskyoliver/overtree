import { describe, expect, it } from 'vitest';
import { inMath } from '../../src/lib/editor/math.ts';
import { CATEGORIES, searchSymbols } from '../../src/lib/editor/symbols.ts';
import { freeName, labelFor, packageEdit, pastedName, referenceFor, relativePath, usesBiblatex } from '../../src/lib/media.ts';
import { SEED } from '../../src/lib/server/collab.ts';
import { addPackages, ensureFolder, getMainFileId, getText, listFiles, setText, uploadFile } from '../../src/lib/server/files.ts';
import { memberships, type MemberRole } from '../../src/lib/server/schema.ts';
import * as filesRoute from '../../src/routes/api/projects/[pid]/files/+server.ts';
import * as packagesRoute from '../../src/routes/api/projects/[pid]/packages/+server.ts';
import { cleanup, connect, ev, hit, json, OWNER, project, start, status, user, waitFor, type Started } from './helpers.ts';

// Feature 015: images, figures, tables and symbols. Pure rules first, then the server (upload into figures/,
// free names, packages through Yjs) and its routes.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe('names and paths', () => {
	it('freeName suffixes -2, -3 … case-insensitively, before the extension', () => {
		expect(freeName('plot.png', ['other.png'])).toBe('plot.png');
		expect(freeName('plot.png', ['Plot.PNG'])).toBe('plot-2.png');
		expect(freeName('plot.png', ['plot.png', 'plot-2.png'])).toBe('plot-3.png');
		expect(freeName('README', ['README'])).toBe('README-2');
	});

	it('pastedName is pasted-YYYYMMDD-HHMMSS in local time', () => {
		expect(pastedName(new Date(2026, 0, 5, 9, 3, 7))).toBe('pasted-20260105-090307.png');
		expect(pastedName(new Date(2026, 11, 31, 23, 59, 59), 'jpg')).toBe('pasted-20261231-235959.jpg');
	});

	it('relativePath goes from the main document folder, with ../ when needed', () => {
		expect(relativePath('', 'figures/a.png')).toBe('figures/a.png');
		expect(relativePath('paper', 'paper/figures/a.png')).toBe('figures/a.png');
		expect(relativePath('paper', 'shared/a.png')).toBe('../shared/a.png');
		expect(relativePath('a/b', 'a/c/d.tex')).toBe('../c/d.tex');
	});

	it('labelFor keeps letters, digits, - and _', () => {
		expect(labelFor('pasted-20260105-090307.png')).toBe('pasted-20260105-090307');
		expect(labelFor('My plot (v2).pdf')).toBe('My-plot-v2');
		expect(labelFor('%%.png')).toBe('figure');
	});

	it('referenceFor: image → \\includegraphics, .tex → \\input, .bib → \\bibliography or \\addbibresource', () => {
		expect(referenceFor('figures/a.png')).toBe('\\includegraphics{figures/a.png}');
		expect(referenceFor('chapters/intro.tex')).toBe('\\input{chapters/intro}');
		expect(referenceFor('refs.bib')).toBe('\\bibliography{refs}');
		expect(referenceFor('refs.bib', true)).toBe('\\addbibresource{refs.bib}');
		expect(referenceFor('style.sty')).toBeNull();
		expect(usesBiblatex('\\usepackage[style=apa]{biblatex}')).toBe(true);
		expect(usesBiblatex('% \\usepackage{biblatex}')).toBe(false);
	});
});

describe('packageEdit', () => {
	it('adds missing packages on the line after \\documentclass, once', () => {
		const doc = '\\documentclass[a4paper]{article}\n\\usepackage{amsmath}\n\\begin{document}\n';
		const edit = packageEdit(doc, ['graphicx', 'amsmath', 'graphicx'])!;
		expect(edit.added).toEqual(['graphicx']);
		const out = doc.slice(0, edit.at) + edit.insert + doc.slice(edit.at);
		expect(out).toBe('\\documentclass[a4paper]{article}\n\\usepackage{graphicx}\n\\usepackage{amsmath}\n\\begin{document}\n');
		expect(packageEdit(out, ['graphicx'])).toBeNull();
	});

	it('sees packages in a list and with options, ignores comments, knows beamer loads graphicx', () => {
		expect(packageEdit('\\documentclass{article}\n\\usepackage[final]{booktabs,graphicx}', ['graphicx', 'booktabs'])).toBeNull();
		expect(packageEdit('\\documentclass{article}\n% \\usepackage{graphicx}', ['graphicx'])?.added).toEqual(['graphicx']);
		expect(packageEdit('\\documentclass{beamer}\n', ['graphicx'])).toBeNull();
		expect(packageEdit('\\section{No preamble}', ['graphicx'])).toBeNull();
		expect(packageEdit('\\documentclass{article}', ['graphicx'])).toEqual({ at: 23, insert: '\n\\usepackage{graphicx}', added: ['graphicx'] });
	});
});

describe('inMath (the palette rule)', () => {
	const at = (marked: string) => inMath(marked.replace('|', ''), marked.indexOf('|'));
	it('$…$, $$…$$, \\(…\\), \\[…\\] and math environments', () => {
		expect(at('text |')).toBe(false);
		expect(at('$x|$')).toBe(true);
		expect(at('$x$ and |')).toBe(false);
		expect(at('$$x + |$$')).toBe(true);
		expect(at('$$x$$ |')).toBe(false);
		expect(at('\\(a|\\)')).toBe(true);
		expect(at('\\[a\\] |')).toBe(false);
		expect(at('\\begin{align*}\na &= |\n\\end{align*}')).toBe(true);
		expect(at('\\begin{align}\\end{align} |')).toBe(false);
		expect(at('\\begin{itemize}\n\\item |')).toBe(false);
	});

	it('escaped dollars, comments, line breaks and \\text{…} inside math', () => {
		expect(at('costs \\$5 and |')).toBe(false);
		expect(at('% a $ in a comment\n|')).toBe(false);
		expect(at('$a \\\\[2pt] |$')).toBe(true);
		expect(at('$a \\text{if |}$')).toBe(false);
		expect(at('$a \\text{if {b}} |$')).toBe(true);
	});
});

describe('symbols', () => {
	it('six categories, unique commands, searchable by name or command', () => {
		expect(CATEGORIES.map((c) => c.name)).toEqual(['Greek', 'Operators', 'Relations', 'Arrows', 'Delimiters', 'Misc']);
		const cmds = CATEGORIES.flatMap((c) => c.symbols.map((s) => s.cmd));
		expect(new Set(cmds).size).toBe(cmds.length);
		expect(searchSymbols('alpha').map((s) => s.cmd)).toEqual(['\\alpha']);
		expect(searchSymbols('\\leq').map((s) => s.cmd)).toEqual(['\\leq']);
		expect(searchSymbols('right arrow').map((s) => s.cmd)).toContain('\\rightarrow');
		expect(searchSymbols('  ')).toEqual([]);
	});
});

// --- server -----------------------------------------------------------------------------------

const B = 'b@test.local';
function member(server: Started, pid: string, email: string, role: MemberRole) {
	server.db.insert(memberships).values({ projectId: pid, userId: user(email).id, role, viaLink: false, createdAt: Date.now() }).run();
}

function form(fields: Record<string, string | File>) {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return new Request('http://x/', { method: 'POST', body: f });
}
const image = (name: string) => new File([PNG], name, { type: 'image/png' });

describe('upload into figures/', () => {
	it("replace: 'rename' never overwrites", async () => {
		await start();
		const pid = project();
		const a = await uploadFile(pid, null, 'shot.png', PNG, 'rename', user().id);
		const b = await uploadFile(pid, null, 'shot.png', PNG, 'rename', user().id);
		const c = await uploadFile(pid, null, 'SHOT.png', PNG, 'rename', user().id);
		expect([a.entry.name, b.entry.name, c.entry.name]).toEqual(['shot.png', 'shot-2.png', 'SHOT-3.png']);
		expect(a.replaced || b.replaced || c.replaced).toBe(false);
	});

	it('ensureFolder makes the folder once and refuses a file of that name', async () => {
		await start();
		const pid = project();
		const one = ensureFolder(pid, null, 'figures', user().id);
		expect(ensureFolder(pid, null, 'Figures', user().id).id).toBe(one.id);
		await uploadFile(pid, null, 'notes.txt', new TextEncoder().encode('x'), false, user().id);
		expect(status(() => ensureFolder(pid, null, 'notes.txt', user().id))).toBe(409);
	});

	it('the route makes figures/ when missing and picks free names (US1-1, US1-3)', async () => {
		await start();
		const pid = project();
		const first = await hit(filesRoute.POST, ev(OWNER, { pid }, form({ file: image('pasted-20260105-090307.png'), parentId: '', folder: 'figures', replace: 'rename' })));
		const second = await hit(filesRoute.POST, ev(OWNER, { pid }, form({ file: image('pasted-20260105-090307.png'), parentId: '', folder: 'figures', replace: 'rename' })));
		expect([first.status, second.status]).toEqual([201, 201]);
		const folders = listFiles(pid).filter((f) => f.kind === 'folder');
		expect(folders.map((f) => f.name)).toEqual(['figures']);
		expect(listFiles(pid).filter((f) => f.parentId === folders[0].id).map((f) => f.name).sort()).toEqual([
			'pasted-20260105-090307-2.png',
			'pasted-20260105-090307.png'
		]);
	});

	it('readers are refused and no folder is made; an oversized image leaves no folder (US1-6, US1-7)', async () => {
		const server = await start();
		const pid = project();
		member(server, pid, B, 'reader');
		const r = await hit(filesRoute.POST, ev(B, { pid }, form({ file: image('a.png'), parentId: '', folder: 'figures', replace: 'rename' })));
		expect(r.status).toBe(403);
		process.env.UPLOAD_MAX_FILE_MB = '1';
		cleanup.push(() => delete process.env.UPLOAD_MAX_FILE_MB);
		const big = new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
		const r2 = await hit(filesRoute.POST, ev(OWNER, { pid }, form({ file: big, parentId: '', folder: 'figures', replace: 'rename' })));
		expect(r2.status).toBe(413);
		expect(listFiles(pid).map((f) => f.name)).toEqual(['main.tex']);
	});
});

describe('packages through Yjs', () => {
	it('adds graphicx after \\documentclass into a connected editor, once (US1-4)', async () => {
		const server = await start();
		const pid = project();
		const main = getMainFileId(pid)!;
		await setText(main, SEED.replace('\\usepackage{graphicx} % Required for inserting images\n', ''), {});
		const a = await connect(server.url, main);
		expect(await addPackages(pid, ['graphicx'], { userId: user().id, projectId: pid })).toEqual(['graphicx']);
		await waitFor(() => a.text.toString().startsWith('\\documentclass{article}\n\\usepackage{graphicx}\n'));
		expect(await addPackages(pid, ['graphicx'], { userId: user().id, projectId: pid })).toEqual([]);
		expect((await getText(main)).match(/graphicx/g)).toHaveLength(1);
	});

	it('the route needs edit access on the main document', async () => {
		const server = await start();
		const pid = project();
		member(server, pid, B, 'reader');
		expect((await hit(packagesRoute.POST, ev(B, { pid }, json('POST', { packages: ['booktabs'] })))).status).toBe(403);
		expect((await hit(packagesRoute.POST, ev(OWNER, { pid }, json('POST', { packages: ['x}'] })))).status).toBe(400);
		const ok = await hit(packagesRoute.POST, ev(OWNER, { pid }, json('POST', { packages: ['booktabs'] })));
		expect(ok).toEqual({ status: 200, body: { added: ['booktabs'] } });
		expect(await getText(getMainFileId(pid)!)).toContain('\\documentclass{article}\n\\usepackage{booktabs}\n');
	});
});
