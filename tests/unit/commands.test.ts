import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { bold, cite, figure, italic, link, section, table } from '../../src/lib/editor/commands.ts';

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

const FIGURE = `\\begin{figure}[h]
    \\centering
    \\includegraphics[width=0.5\\linewidth]{[example-image]}
    \\caption{Caption}
    \\label{fig:label}
\\end{figure}`;

const TABLE = `\\begin{table}[h]
    \\centering
    \\begin{tabular}{|c|c|}
        \\hline
        [A] & B \\\\
        \\hline
        C & D \\\\
        \\hline
    \\end{tabular}
    \\caption{Caption}
    \\label{tab:label}
\\end{table}`;

describe('block commands (US4-5)', () => {
	it('Figure on an empty line selects the image placeholder', () => {
		expect(run(figure, 'a\n|\nb')).toBe(`a\n${FIGURE}\nb`);
	});

	it('Table on an empty line selects the first cell', () => {
		expect(run(table, '|')).toBe(TABLE);
	});

	it('starts a new line when the cursor line has text, and replaces a selection', () => {
		expect(run(figure, 'Some text|')).toBe(`Some text\n${FIGURE}`);
		expect(run(table, 'keep [drop] tail')).toBe(`keep \n${TABLE}\n tail`);
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
