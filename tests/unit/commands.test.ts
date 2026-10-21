import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { bold, cite, figuresCommand, italic, link, section, symbolCommand, tableCommand, tableSnippet } from '../../src/lib/editor/commands.ts';

/** Run `cmd` on `doc` where `[` `]` mark the selection and `|` a cursor; return the result in the same notation. */
function run(cmd: StateCommand, doc: string) {
	const cursor = doc.indexOf('|');
	const from = cursor >= 0 ? cursor : doc.indexOf('[');
	const to = cursor >= 0 ? cursor : doc.indexOf(']') - 1;
	let state = EditorState.create({
		doc: doc.replace(/[|[\]]/g, ''),
		selection: EditorSelection.single(from, to)
	});
	let transactions = 0;
	expect(
		cmd({
			state,
			dispatch: (tr) => {
				transactions++;
				state = tr.state;
			}
		})
	).toBe(true);
	expect(transactions).toBe(1); // one dispatch = one undo step
	const { from: a, to: b } = state.selection.main;
	const text = state.doc.toString();
	return a === b ? text.slice(0, a) + '|' + text.slice(a) : text.slice(0, a) + '[' + text.slice(a, b) + ']' + text.slice(b);
}

describe('wrapping commands', () => {
	it('Bold and Italic keep the selection (US4-1) or put the cursor inside (US4-2)', () => {
		expect(run(bold, 'a [important] b')).toBe('a \\textbf{[important]} b');
		expect(run(italic, 'a [important] b')).toBe('a \\textit{[important]} b');
		expect(run(bold, 'a | b')).toBe('a \\textbf{|} b');
		expect(run(italic, '|')).toBe('\\textit{|}');
	});

	it('Section wraps the selection or puts the cursor in the braces (US4-3)', () => {
		expect(run(section, '[Intro]')).toBe('\\section{[Intro]}');
		expect(run(section, 'x\n|')).toBe('x\n\\section{|}');
	});

	it('Section in the middle of a paragraph goes on a line of its own', () => {
		expect(run(section, 'text [Intro] more')).toBe('text \n\\section{[Intro]}\n more');
	});

	it('Bold and Italic unwrap what they wrapped, like a word processor', () => {
		expect(run(bold, 'a \\textbf{[word]} b')).toBe('a [word] b');
		expect(run(bold, 'a [\\textbf{word}] b')).toBe('a [word] b');
		expect(run(italic, '\\textit{|}')).toBe('|');
		// two separate groups selected together are wrapped, not mangled
		expect(run(bold, '[\\textbf{a} \\textbf{b}]')).toBe('\\textbf{[\\textbf{a} \\textbf{b}]}');
		// a different command around the selection: wrap
		expect(run(bold, '\\textit{[w]}')).toBe('\\textit{\\textbf{[w]}}');
	});

	it('Link puts the selection in the text and the cursor in the URL (US4-4)', () => {
		expect(run(link, 'see [here] now')).toBe('see \\href{|}{here} now');
		expect(run(link, '|')).toBe('\\href{|}{}');
	});
});

const FIGURE = `\\begin{figure}[htbp]
    \\centering
    \\includegraphics[width=0.8\\linewidth]{figures/plot.png}
    \\caption{|}
    \\label{fig:plot}
\\end{figure}`;

const TABLE_3x2 = `\\begin{table}[htbp]
    \\centering
    \\begin{tabular}{ll}
        \\toprule
        | &  \\\\
        \\midrule
         &  \\\\
         &  \\\\
        \\bottomrule
    \\end{tabular}
    \\caption{}
    \\label{tab:}
\\end{table}`;

const plot = { path: 'figures/plot.png', label: 'plot' };

describe('figure and table blocks (015)', () => {
	it('a figure on an empty line puts the caret in the caption', () => {
		expect(run(figuresCommand([plot]), 'a\n|\nb')).toBe(`a\n${FIGURE}\nb`);
	});

	it('starts a new line when the cursor line has text, and replaces a selection', () => {
		expect(run(figuresCommand([plot]), 'Some text|')).toBe(`Some text\n${FIGURE}`);
		expect(run(tableCommand(3, 2), 'keep [drop] tail')).toBe(`keep \n${TABLE_3x2}\n tail`);
	});

	it('a 3 × 2 table: header rule after the first row, the caret in the first cell', () => {
		expect(run(tableCommand(3, 2), '|')).toBe(TABLE_3x2);
		expect(tableSnippet(1, 3)).not.toContain('\\midrule');
		expect(tableSnippet(1, 3)).toContain('\\begin{tabular}{lll}');
	});

	it('caption, width and braces in user text: the caret after the caption, the text as typed', () => {
		const out = run(figuresCommand([{ path: 'figures/a.png', label: 'a', caption: 'Set {x} ${y}', width: 0.5 }]), '|');
		expect(out).toContain('\\includegraphics[width=0.5\\linewidth]{figures/a.png}');
		expect(out).toContain('\\caption{Set {x} ${y}|}');
	});

	it('two figures: the first caption gets the caret', () => {
		const out = run(figuresCommand([plot, { path: 'figures/b.png', label: 'b' }]), '|');
		expect(out.match(/\\begin\{figure\}/g)).toHaveLength(2);
		expect(out.indexOf('|')).toBeLessThan(out.indexOf('figures/b.png'));
	});
});

describe('symbol insertion (015)', () => {
	it('outside math wraps the command in $…$', () => {
		expect(run(symbolCommand('\\alpha'), 'x |')).toBe('x $\\alpha$|');
		expect(run(symbolCommand('\\alpha'), 'x [sel] y')).toBe('x $\\alpha$| y');
	});

	it('inside math inserts it bare, spaced from a following letter', () => {
		expect(run(symbolCommand('\\alpha'), '$x + |$')).toBe('$x + \\alpha|$');
		expect(run(symbolCommand('\\alpha'), '$|x$')).toBe('$\\alpha |x$');
		// `[` `]` mark selections in `run`: \( \) here
		expect(run(symbolCommand('\\{'), '\\(|x\\)')).toBe('\\(\\{|x\\)');
	});
});

describe('cite (017 US1)', () => {
	it('inserts \\cite{keys} at the cursor or in place of the selection', () => {
		expect(run(cite(['smith2021deep']), 'as shown |.')).toBe('as shown \\cite{smith2021deep}|.');
		expect(run(cite(['a', 'b']), 'see [here] now')).toBe('see \\cite{a,b}| now');
	});

	it('inside a citation argument, puts the keys there, replacing the half-typed key', () => {
		expect(run(cite(['smith2021deep']), 'x \\cite{|}')).toBe('x \\cite{smith2021deep|}');
		// (the notation's [ ] mark a selection, so no optional argument here; the completion tests cover those)
		expect(run(cite(['b2']), 'x \\citep{a, sm|}')).toBe('x \\citep{a, b2|}');
	});
});
