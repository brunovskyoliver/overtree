// Toolbar insertions (contracts/ui.md). StateCommands, so an EditorView or a bare {state, dispatch} works.
import { EditorSelection, type EditorState, type StateCommand, type Transaction } from '@codemirror/state';

/** `before[sel]after`; the selection (or cursor) moves inside. Already wrapped in exactly that (the markup right
 *  around the selection, or the selection is the whole `before…after`): unwraps instead, like Bold in a word processor. */
export const wrap =
	(before: string, after: string): StateCommand =>
	({ state, dispatch }) => {
		const spec = state.changeByRange((r) => {
			if (state.sliceDoc(r.from - before.length, r.from) === before && state.sliceDoc(r.to, r.to + after.length) === after)
				return {
					changes: [
						{ from: r.from - before.length, to: r.from },
						{ from: r.to, to: r.to + after.length }
					],
					range: EditorSelection.range(r.anchor - before.length, r.head - before.length)
				};
			const sel = state.sliceDoc(r.from, r.to);
			const inner = sel.slice(before.length, sel.length - after.length);
			if (sel.length >= before.length + after.length && sel.startsWith(before) && sel.endsWith(after) && balanced(inner))
				return {
					changes: { from: r.from, to: r.to, insert: inner },
					range: EditorSelection.range(r.from, r.from + inner.length)
				};
			return {
				changes: [
					{ from: r.from, insert: before },
					{ from: r.to, insert: after }
				],
				range: EditorSelection.range(r.anchor + before.length, r.head + before.length)
			};
		});
		dispatch(state.update(spec, { scrollIntoView: true, userEvent: 'input' }));
		return true;
	};

/** Braces in `s` pair up, so `\textbf{a} \textbf{b}` selected whole isn't mistaken for one `\textbf{…}`. */
function balanced(s: string) {
	let depth = 0;
	for (let i = 0; i < s.length; i++) {
		if (s[i] === '\\') i++;
		else if (s[i] === '{') depth++;
		else if (s[i] === '}' && --depth < 0) return false;
	}
	return depth === 0;
}

export const bold = wrap('\\textbf{', '}');
export const italic = wrap('\\textit{', '}');

/** `\href{|}{sel}`: the selection becomes the link text, the cursor goes to the URL. */
export const link: StateCommand = ({ state, dispatch }) => {
	const spec = state.changeByRange((r) => ({
		changes: [
			{ from: r.from, insert: '\\href{}{' },
			{ from: r.to, insert: '}' }
		],
		range: EditorSelection.cursor(r.from + '\\href{'.length)
	}));
	dispatch(state.update(spec, { scrollIntoView: true, userEvent: 'input' }));
	return true;
};

/** Insert `text` on its own lines in place of the main selection and select `text.slice(start, end)`. */
function insertBlock(state: EditorState, dispatch: (tr: Transaction) => void, text: string, start: number, end: number) {
	const { from, to } = state.selection.main;
	const before = state.sliceDoc(state.doc.lineAt(from).from, from);
	const after = state.sliceDoc(to, state.doc.lineAt(to).to);
	const lead = before.trim() ? '\n' : '';
	const insert = lead + text + (after.trim() ? '\n' : '');
	const at = from + lead.length;
	dispatch(
		state.update({
			changes: { from, to, insert },
			selection: EditorSelection.single(at + start, at + end),
			scrollIntoView: true,
			userEvent: 'input'
		})
	);
	return true;
}

const block =
	(text: string, placeholder: string): StateCommand =>
	({ state, dispatch }) =>
		insertBlock(state, dispatch, text, text.indexOf(placeholder), text.indexOf(placeholder) + placeholder.length);

/** `\section{sel}` on a line of its own (a heading in the middle of a paragraph splits it), the title selected. */
export const section: StateCommand = ({ state, dispatch }) => {
	const title = state.sliceDoc(state.selection.main.from, state.selection.main.to);
	const open = '\\section{';
	return insertBlock(state, dispatch, `${open}${title}}`, open.length, open.length + title.length);
};

export const figure = block(
	`\\begin{figure}[h]
    \\centering
    \\includegraphics[width=0.5\\linewidth]{example-image}
    \\caption{Caption}
    \\label{fig:label}
\\end{figure}`,
	'example-image'
);

export const table = block(
	`\\begin{table}[h]
    \\centering
    \\begin{tabular}{|c|c|}
        \\hline
        A & B \\\\
        \\hline
        C & D \\\\
        \\hline
    \\end{tabular}
    \\caption{Caption}
    \\label{tab:label}
\\end{table}`,
	'A'
);
