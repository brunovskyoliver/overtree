import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { bold, figure, italic, link, section, table } from '../../src/lib/editor/commands.ts';

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
