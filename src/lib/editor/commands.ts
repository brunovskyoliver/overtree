// Toolbar insertions (contracts/ui.md). StateCommands, so an EditorView or a bare {state, dispatch} works.
import { EditorSelection, type StateCommand } from '@codemirror/state';

/** `before[sel]after`; the selection (or cursor) moves inside. */
export const wrap =
	(before: string, after: string): StateCommand =>
	({ state, dispatch }) => {
		const spec = state.changeByRange((r) => ({
			changes: [
				{ from: r.from, insert: before },
				{ from: r.to, insert: after }
			],
			range: EditorSelection.range(r.anchor + before.length, r.head + before.length)
		}));
		dispatch(state.update(spec, { scrollIntoView: true, userEvent: 'input' }));
		return true;
	};

export const bold = wrap('\\textbf{', '}');
export const italic = wrap('\\textit{', '}');
export const section = wrap('\\section{', '}');

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

/** Insert `block` on its own lines in place of the main selection and select `placeholder`. */
const block =
	(text: string, placeholder: string): StateCommand =>
	({ state, dispatch }) => {
		const { from, to } = state.selection.main;
		const before = state.sliceDoc(state.doc.lineAt(from).from, from);
		const after = state.sliceDoc(to, state.doc.lineAt(to).to);
		const lead = before.trim() ? '\n' : '';
		const insert = lead + text + (after.trim() ? '\n' : '');
		const start = from + lead.length + text.indexOf(placeholder);
		dispatch(
			state.update({
				changes: { from, to, insert },
				selection: EditorSelection.single(start, start + placeholder.length),
				scrollIntoView: true,
				userEvent: 'input'
			})
		);
		return true;
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
