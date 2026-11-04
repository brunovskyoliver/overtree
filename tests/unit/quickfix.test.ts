import { readFileSync } from 'node:fs';
import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { hintFor } from '../../src/lib/compile-hints.ts';
import type { HintAction } from '../../src/lib/compile-types.ts';
import { entryRange } from '../../src/lib/editor/lint.ts';
import { changedRanges, fixChanges, type Change } from '../../src/lib/editor/quickfix.ts';
import { parseLog } from '../../src/lib/log-parser.ts';

// Quick fixes (Hint.action) against the real logs of tests/fixtures/hints (see compile-hints.test.ts). Each fix was
// also checked by compiling the fixed fixture with pdflatex: the error it targets is gone.
const dir = new URL('../fixtures/hints/', import.meta.url);
const paths = ['main.tex', 'figs/plot.png', 'chapters/chapter1.tex', 'refs.bib'];
const apply = (text: string, changes: Change[]) => [...changes].reverse().reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text);

/** The fixture's source after the quick fix of its first entry matching `message`, and the fix's label. */
function fixed(name: string, message: RegExp) {
	const tex = readFileSync(new URL(`${name}.tex`, dir), 'utf8');
	const e = parseLog(readFileSync(new URL(`${name}.log`, dir), 'utf8')).find((e) => message.test(e.message))!;
	const hint = hintFor(e, { paths })!;
	expect(hint.action, `${name}: no quick fix`).toBeDefined();
	const changes = fixChanges(tex, hint.action!, entryRange(Text.of(tex.split('\n')), { ...e, hint }), hint.token);
	expect(changes, `${name}: the fix doesn't apply`).not.toBeNull();
	return { label: hint.action!.label, before: tex, after: apply(tex, changes!) };
}

describe('quick fixes on real logs', () => {
	it.each([
		['undefined-includegraphics', 'graphicx'],
		['undefined-url', 'url'],
		['undefined-si', 'siunitx'],
		['undefined-toprule', 'booktabs'],
		['env-align', 'amsmath']
	])('%s: loads %s below the preamble’s last \\usepackage (or \\documentclass)', (name, pkg) => {
		const { label, before, after } = fixed(name, /undefined/i);
		expect(label).toBe(`Add \\usepackage{${pkg}}`);
		expect(after.replace(`\n\\usepackage{${pkg}}`, '')).toBe(before);
		expect(after.indexOf(`\\usepackage{${pkg}}`)).toBeLessThan(after.indexOf('\\begin{document}'));
	});

	it.each([
		['env-mismatch', /ended by/, 'Change to \\end{itemize}', '\\end{enumerate}', '\\end{itemize}'],
		['sty-typo', /not found/, 'Change to graphicx', '{graphix}', '{graphicx}'],
		['input-missing', /not found/, 'Change to chapters/chapter1', '{chapter1}', '{chapters/chapter1}'],
		['image-missing', /not found/, 'Change to figs/plot.png', 'figs/plott.png', 'figs/plot.png']
	])('%s: %s', (name, message, label, from, to) => {
		const r = fixed(name, message);
		expect(r.label).toBe(label);
		expect(r.after).toBe(r.before.replace(from, to));
	});

	it('offers nothing it can’t be sure of: an unknown command or environment with no close match, a stray &', () => {
		for (const [name, message] of [['undefined-unknown', /Undefined control/], ['env-unknown', /undefined/], ['alignment-tab', /alignment tab/]] as const) {
			const e = parseLog(readFileSync(new URL(`${name}.log`, dir), 'utf8')).find((e) => message.test(e.message))!;
			expect(hintFor(e, { paths })?.action, name).toBeUndefined();
		}
	});
});

describe('fixChanges', () => {
	const doc = '\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\begin{document}\n\\begin{itemise}\n\\item a\n\\end{itemise}\nx \\\\\n\\end{document}';
	const at = (token: string) => ({ from: doc.indexOf(token), to: doc.indexOf(token) + token.length });
	const env: HintAction = { label: 'Rename to itemize', env: 'itemize' };

	it('renames an environment at its \\begin and its \\end', () => {
		const changes = fixChanges(doc, env, at('\\begin{itemise}'), '\\begin{itemise}')!;
		expect(apply(doc, changes)).toBe(doc.replaceAll('itemise', 'itemize'));
		// both new texts blink
		expect(changedRanges(changes).map((r) => apply(doc, changes).slice(r.from, r.to))).toEqual(['\\begin{itemize}', '\\end{itemize}']);
	});

	it('removes text with an empty replace', () => {
		const from = doc.indexOf('x \\\\') + 2;
		const changes = fixChanges(doc, { label: 'Remove \\\\', replace: '' }, { from, to: from + 2 }, '\\\\')!;
		expect(apply(doc, changes)).toBe(doc.replace('x \\\\', 'x '));
	});

	it('refuses when the text moved on, the package is loaded or there is no preamble', () => {
		expect(fixChanges(doc, env, at('\\item a'), '\\begin{itemise}')).toBeNull(); // the token isn't at the range
		expect(fixChanges(doc, { label: '', usepackage: 'inputenc' }, { from: 0, to: 0 })).toBeNull();
		expect(fixChanges('\\section{A}\n\\includegraphics{x}', { label: '', usepackage: 'graphicx' }, { from: 0, to: 0 })).toBeNull();
		// a package named inside a list counts as loaded
		expect(fixChanges(doc.replace('{inputenc}', '{inputenc,graphicx}'), { label: '', usepackage: 'graphicx' }, { from: 0, to: 0 })).toBeNull();
	});

	it('adds a package after \\documentclass when the preamble has no \\usepackage, also on one line', () => {
		const one = '\\documentclass{article}\\begin{document}x\\end{document}';
		expect(apply(one, fixChanges(one, { label: '', usepackage: 'url' }, { from: 0, to: 0 })!)).toBe(
			'\\documentclass{article}\\usepackage{url}\n\\begin{document}x\\end{document}'
		);
		const two = '\\documentclass{article}\n\\begin{document}\nx\n\\end{document}';
		expect(apply(two, fixChanges(two, { label: '', usepackage: 'url' }, { from: 0, to: 0 })!)).toBe(
			'\\documentclass{article}\n\\usepackage{url}\n\\begin{document}\nx\n\\end{document}'
		);
	});
});
