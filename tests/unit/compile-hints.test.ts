import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hintFor } from '../../src/lib/compile-hints.ts';
import type { LogEntry } from '../../src/lib/compile-types.ts';
import { parseLog } from '../../src/lib/log-parser.ts';

// 016: hints against real logs. tests/fixtures/hints/<name>.tex compiled in the sandbox (pdflatex, medium image)
// gives <name>.log next to it; REFRESH_HINT_LOGS=1 compiles them again (needs Docker).
const dir = new URL('../fixtures/hints/', import.meta.url);
const log = (name: string) => readFileSync(new URL(`${name}.log`, dir), 'utf8');
// the project around the fixtures, for file-not-found suggestions
const paths = ['main.tex', 'figs/plot.png', 'chapters/chapter1.tex', 'refs.bib'];

/** The first entry of the fixture's log whose message matches, with its hint. */
function entry(name: string, message: RegExp): LogEntry & { hint: NonNullable<LogEntry['hint']> } {
	const e = parseLog(log(name)).find((e) => message.test(e.message));
	expect(e, `${name}: no entry matching ${message}`).toBeDefined();
	const hint = hintFor(e!, { paths });
	expect(hint, `${name}: no hint for ${e!.message}`).toBeDefined();
	return { ...e!, hint: hint! };
}

describe.runIf(process.env.REFRESH_HINT_LOGS)('refresh the fixture logs', { timeout: 120_000 }, () => {
	it('compiles every fixture', async () => {
		const { runCompile } = await import('../../src/lib/server/compile.ts');
		const names = readdirSync(dir).filter((f) => f.endsWith('.tex'));
		await Promise.all(
			names.map(async (f) => {
				const files = [{ path: 'main.tex', data: readFileSync(new URL(f, dir)) }];
				const r = await runCompile({ files, mainPath: 'main.tex', compiler: 'pdflatex', stopOnFirstError: false });
				writeFileSync(new URL(f.replace(/\.tex$/, '.log'), dir), r.log ?? '');
			})
		);
	});
});

describe('hintFor on real logs', () => {
	it.each([
		['undefined-includegraphics', '\\includegraphics', 'graphicx', 4],
		['undefined-url', '\\url', 'url', 3],
		['undefined-si', '\\SI', 'siunitx', 3],
		['undefined-toprule', '\\toprule', 'booktabs', 4]
	])('%s: names the package', (name, cmd, pkg, line) => {
		const e = entry(name, /^Undefined control sequence/);
		expect(e.line).toBe(line);
		expect(e.hint.token).toBe(cmd);
		expect(e.hint.explanation).toContain(`\`${cmd}\``);
		expect(e.hint.explanation).toContain(`${pkg} package`);
		expect(e.hint.fix).toContain(`\\usepackage{${pkg}}`);
	});

	it('an unknown command: spelling or a missing definition', () => {
		const e = entry('undefined-unknown', /^Undefined control sequence/);
		expect(e.hint.token).toBe('\\frobnicate');
		expect(e.hint.explanation).toContain('doesn’t know the command `\\frobnicate`');
		expect(e.hint.fix).toContain('\\newcommand');
	});

	it('a misspelled command: suggests the right one', () => {
		const e = hintFor({ level: 'error', message: 'Undefined control sequence.', context: 'Some \\txtbf', raw: '' }, { paths });
		expect(e?.fix).toBe('Did you mean `\\textbf`?');
	});

	it('Environment align undefined: amsmath', () => {
		const e = entry('env-align', /Environment align undefined/);
		expect(e.line).toBe(3);
		expect(e.hint.fix).toContain('\\usepackage{amsmath}');
		expect(e.hint.token).toBe('\\begin{align}');
	});

	it('an unknown environment: check the name or define it', () => {
		const e = entry('env-unknown', /Environment frobenv undefined/);
		expect(e.hint.explanation).toContain('no environment called `frobenv`');
		expect(e.hint.fix).toContain('\\newenvironment');
	});

	it('a misspelled package: a typo, with the right name', () => {
		const e = entry('sty-typo', /File `graphix.sty' not found/);
		expect(e.line).toBe(3); // nonstop mode stops at the next line
		expect(e.hint.explanation).toContain('typo of `graphicx`');
		expect(e.hint.fix).toBe('Change it to `\\usepackage{graphicx}`.');
		expect(e.hint.token).toBe('graphix');
	});

	it('a package the image lacks: points to the full image', () => {
		const e = entry('sty-missing', /File `doesnotexist.sty' not found/);
		expect(e.hint.explanation).toContain('isn’t installed in this TeX image');
		expect(e.hint.fix).toContain('TEXLIVE_IMAGE=texlive/texlive:latest-full');
	});

	it('a missing image: suggests the closest existing path', () => {
		const e = entry('image-missing', /Error: File `figs\/plott.png' not found/);
		expect(e.line).toBe(4);
		expect(e.hint.fix).toBe('Did you mean `figs/plot.png`?');
	});

	it('a missing \\input: the same file in another folder, written without .tex', () => {
		const e = entry('input-missing', /File `chapter1.tex' not found/);
		expect(e.line).toBe(4);
		expect(e.hint.fix).toBe('Did you mean `chapters/chapter1`?');
		expect(e.hint.token).toBe('chapter1');
	});

	it('a missing file with nothing close: upload it', () => {
		const e = hintFor({ level: 'error', message: "LaTeX Error: File `zzz/totally-else.pdf' not found.", raw: '' }, { paths });
		expect(e?.fix).toBe('Upload `totally-else.pdf` into the project, or fix the path.');
	});

	it('Missing \\begin{document}', () => {
		const e = entry('missing-begin-document', /Missing \\begin\{document\}/);
		expect(e.line).toBe(2);
		expect(e.hint.fix).toContain('Move text out of the preamble');
	});

	it('Runaway argument (end of file): names the command', () => {
		const e = entry('runaway', /^File ended while scanning use of/);
		expect(e.hint.token).toBe('\\textbf');
		expect(e.hint.fix).toContain('missing `}` after the argument of `\\textbf`');
	});

	it('Paragraph ended before: names the command', () => {
		// the message of tests/fixtures/latex/err-runaway.tex (a short \newcommand* argument across a blank line)
		const hint = hintFor({ level: 'error', file: 'main.tex', line: 7, message: 'Paragraph ended before \\shout was complete.', raw: '' }, { paths });
		expect(hint?.token).toBe('\\shout');
	});

	it("Too many }'s", () => {
		const e = entry('too-many-braces', /^Too many \}'s/);
		expect(e.line).toBe(3);
		expect(e.hint.explanation).toContain('no `{` to match it');
	});

	it('Extra }, or forgotten $', () => {
		const e = entry('extra-brace-math', /^Extra \}, or forgotten \$/);
		expect(e.hint.fix).toContain('braces opened inside math must close inside it');
	});

	it('Missing $ inserted: the math-only character', () => {
		const e = entry('missing-dollar', /^Missing \$ inserted/);
		expect(e.line).toBe(3);
		expect(e.hint.token).toBe('^');
		expect(e.hint.fix).toContain('`$…$`');
	});

	it('\\begin ended by another \\end', () => {
		const e = entry('env-mismatch', /ended by \\end\{enumerate\}/);
		expect(e.line).toBe(5);
		expect(e.hint.explanation).toBe('`\\begin{itemize}` on line 3 is closed by `\\end{enumerate}`.');
		expect(e.hint.token).toBe('\\end{enumerate}');
	});

	it('Misplaced alignment tab: escape the &', () => {
		expect(entry('alignment-tab', /^Misplaced alignment tab/).hint.fix).toContain('`\\&`');
	});

	it('an undefined reference names the key and suggests a rerun', () => {
		const e = entry('undefined-ref', /^Reference `sec:nope'/);
		expect(e.line).toBe(3);
		expect(e.hint.token).toBe('sec:nope');
		expect(e.hint.explanation).toContain('\\label{sec:nope}');
		expect(e.hint.fix).toContain('one more compile');
	});

	it('an undefined citation names the key and the bibliography', () => {
		const e = entry('undefined-cite', /^Citation `nobody2020'/);
		expect(e.hint.explanation).toContain('`nobody2020`');
		expect(e.hint.fix).toContain('.bib file');
		expect(entry('undefined-cite', /^There were undefined references/).hint.fix).toContain('compile once more');
	});

	it('overfull and underfull boxes: mild', () => {
		const over = entry('boxes', /^Overfull/);
		expect(over.hint.explanation).toBe('A line sticks out by 201pt: TeX couldn’t find a good place to break it. Usually harmless.');
		expect(entry('boxes', /^Underfull/).hint.explanation).toContain('Usually harmless');
	});

	it('Emergency stop without \\end{document}', () => {
		const e = entry('no-end', /^Emergency stop/);
		expect(e.context).toBe('job aborted, no legal \\end found');
		expect(e.hint.fix).toContain('Add \\end{document}');
	});

	it('Emergency stop after another error: fix that one', () => {
		const e = entry('input-missing', /^Emergency stop/);
		expect(e.hint.fix).toContain('the error listed just before');
	});

	it('every fixture gets a hint for each of its errors', () => {
		for (const f of readdirSync(dir).filter((f) => f.endsWith('.log'))) {
			const errors = parseLog(readFileSync(new URL(f, dir), 'utf8')).filter((e) => e.level === 'error');
			for (const e of errors) expect(hintFor(e, { paths }), `${f}: ${e.message}`).toBeDefined();
		}
	});

	it('ChkTeX warnings get none (their message is the explanation)', () => {
		expect(hintFor({ level: 'chktex', message: 'Use either `` or ...', raw: '' }, { paths })).toBeUndefined();
	});
});
