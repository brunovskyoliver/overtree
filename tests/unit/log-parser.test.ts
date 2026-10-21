import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseChktex, parseLog } from '../../src/lib/log-parser.ts';
import { runCompile } from '../../src/lib/server/compile.ts';

// SC-003: real logs from the container (Docker + texlive/texlive:latest-medium, see quickstart.md).
// Each fixture's first line reads `% expect: <level> line <n>`. All 10 pass; no accepted misses.
const dir = new URL('../fixtures/latex/', import.meta.url);
const fixtures = readdirSync(dir).filter((f) => f.startsWith('err-'));
const logs = new Map<string, string>();

describe('parseLog on real logs', { timeout: 120_000 }, () => {
	beforeAll(async () => {
		await Promise.all(
			fixtures.map(async (f) => {
				const files = [{ path: 'main.tex', data: readFileSync(new URL(f, dir)) }];
				const r = await runCompile({ files, mainPath: 'main.tex', compiler: 'pdflatex', stopOnFirstError: false });
				logs.set(f, r.log ?? '');
			})
		);
	}, 120_000);

	it('has ten fixtures', () => expect(fixtures).toHaveLength(10));

	it.each(fixtures)('%s', (f) => {
		const [, level, line] = readFileSync(new URL(f, dir), 'utf8').match(/^% expect: (\w+) line (\d+)/)!;
		const entry = parseLog(logs.get(f)!).find((e) => e.level === level && e.line);
		expect(entry).toMatchObject({ level, line: Number(line), file: 'main.tex' });
	});
});

describe('parseLog', () => {
	it('takes the line of a `!` error from the following l.<n>', () => {
		const entries = parseLog('! LaTeX Error: Something.\n\nSee the manual.\n...\nl.12 \\oops\n');
		expect(entries).toEqual([{ level: 'error', message: 'LaTeX Error: Something.', line: 12, context: '\\oops', raw: '! LaTeX Error: Something.' }]);
	});

	it('skips the -halt-on-error closing line', () => {
		const entries = parseLog('./main.tex:12: Undefined control sequence.\n./main.tex:12:  ==> Fatal error occurred, no output PDF file produced!\n');
		expect(entries).toHaveLength(1);
		expect(entries[0].message).toBe('Undefined control sequence.');
	});

	it('drops a `!` error already reported in file:line form', () => {
		const entries = parseLog('./main.tex:3: Undefined control sequence.\nl.3 \\foo\n! Undefined control sequence.\nl.3 \\foo\n');
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ file: 'main.tex', line: 3 });
	});

	it('joins (pkg) continuation lines and reads the input line', () => {
		const log = [
			'(./main.aux)',
			'Package hyperref Warning: Token not allowed in a PDF string (Unicode):',
			'(hyperref)                removing `math shift\' on input line 4.',
			'Class foo Warning: Plain.'
		].join('\n');
		expect(parseLog(log)).toMatchObject([
			{ level: 'warning', file: 'main.tex', line: 4, message: "Token not allowed in a PDF string (Unicode): removing `math shift'" },
			{ level: 'warning', file: 'main.tex', message: 'Plain' }
		]);
	});

	it('gives no file to warnings while packages load and keeps foreign files', () => {
		const log = '(/tex/foo.sty\nPackage foo Warning: Early on input line 99.\n)\n/tex/geometry.sty:1017: Package keyval Error: x undefined.\n';
		const [warning, error] = parseLog(log);
		expect(warning.file).toBeUndefined();
		expect(error).toMatchObject({ file: '/tex/geometry.sty', line: 1017 });
	});

	it('reads boxes with and without a line', () => {
		const log = '(./main.aux)\nUnderfull \\hbox (badness 10000) in paragraph at lines 8--9\nOverfull \\vbox (3.0pt too high) has occurred while \\output is active';
		expect(parseLog(log).map((e) => [e.level, e.line])).toEqual([
			['typesetting', 8],
			['typesetting', undefined]
		]);
	});

	it('keeps the l.<n> text of a file:line error as its context (016)', () => {
		const [e] = parseLog('./main.tex:4: Undefined control sequence.\nl.4 \\includegraphics\n                    {plot.png}\n');
		expect(e).toMatchObject({ line: 4, context: '\\includegraphics' });
	});

	it('places a `! File … not found.` prompt at the emergency stop after it, and keeps the stop reason (016)', () => {
		const log = "! LaTeX Error: File `chapter1.tex' not found.\n\n./main.tex:4: Emergency stop.\n<read *>\nl.4 \\input{chapter1}\n*** (cannot \\read from terminal in nonstop modes)\n";
		const [missing, stop] = parseLog(log);
		expect(missing).toMatchObject({ file: 'main.tex', line: 4, message: "LaTeX Error: File `chapter1.tex' not found." });
		expect(stop).toMatchObject({ message: 'Emergency stop.', context: 'cannot \\read from terminal in nonstop modes' });
	});

	it('skips the `!  ==> Fatal error` closing line too', () => {
		expect(parseLog('! Emergency stop.\n!  ==> Fatal error occurred, no output PDF file produced!\n')).toHaveLength(1);
	});
});

describe('parseChktex (016)', () => {
	it("reads the job's file:line:column:length:kind:number:message lines", () => {
		const out = "./main.tex:3:7:1:Warning:18:Use either `` or '' as an alternative to `\"'.\nch/a.tex:1:4:3:Warning:11:You should use \\ldots to achieve an ellipsis.\n\n";
		expect(parseChktex(out)).toEqual([
			{ level: 'chktex', file: 'main.tex', line: 3, column: 7, length: 1, message: "Use either `` or '' as an alternative to `\"'. (ChkTeX 18)", raw: out.split('\n')[0] },
			{ level: 'chktex', file: 'ch/a.tex', line: 1, column: 4, length: 3, message: 'You should use \\ldots to achieve an ellipsis. (ChkTeX 11)', raw: out.split('\n')[1] }
		]);
	});
});
