// Toolbar insertions (contracts/ui.md). StateCommands, so an EditorView or a bare {state, dispatch} works.
import { snippet } from '@codemirror/autocomplete';
import { EditorSelection, type EditorState, type StateCommand, type Transaction } from '@codemirror/state';
import { inMath } from './math.ts';

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

/** `\section{sel}` on a line of its own (a heading in the middle of a paragraph splits it), the title selected. */
export const section: StateCommand = ({ state, dispatch }) => {
	const title = state.sliceDoc(state.selection.main.from, state.selection.main.to);
	const open = '\\section{';
	return insertBlock(state, dispatch, `${open}${title}}`, open.length, open.length + title.length);
};

/** Insert snippet `template` on its own lines in place of the main selection: tab stops `${}` in order, the first
 *  selected (CodeMirror's snippet fields, as in completion snippets: Tab moves on, Escape leaves). Templates hold
 *  no user text: CodeMirror's parser misplaces tab stops after several escaped braces. */
export const snippetBlock =
	(template: string): StateCommand =>
	({ state, dispatch }) => {
		const { from, to } = state.selection.main;
		const before = state.sliceDoc(state.doc.lineAt(from).from, from);
		const after = state.sliceDoc(to, state.doc.lineAt(to).to);
		const text = (before.trim() ? '\n' : '') + template + (after.trim() ? '\n' : '');
		snippet(text)({ state, dispatch }, null, from, to);
		return true;
	};

export type FigureSpec = { path: string; label: string; caption?: string; width?: number };

/** A `figure` with the image centred at `width` × line width. */
export function figureBlock({ path, label, caption = '', width = 0.8 }: FigureSpec) {
	return `\\begin{figure}[htbp]
    \\centering
    \\includegraphics[width=${width}\\linewidth]{${path}}
    \\caption{${caption}}
    \\label{fig:${label}}
\\end{figure}`;
}

/** A booktabs `table` of `rows` × `cols`, the first row being the header: a tab stop per cell, then the caption
 *  and the label; the caret starts in the first cell. */
export function tableSnippet(rows: number, cols: number) {
	const row = '        ' + Array(cols).fill('${}').join(' & ') + ' \\\\';
	const body = Array.from({ length: rows }, (_, i) => (i === 1 ? ['        \\midrule', row] : [row])).flat();
	return [
		'\\begin{table}[htbp]',
		'    \\centering',
		`    \\begin{tabular}{${'l'.repeat(cols)}}`,
		'        \\toprule',
		...body,
		'        \\bottomrule',
		'    \\end{tabular}',
		'    \\caption{${}}',
		'    \\label{tab:${}}',
		'\\end{table}'
	].join('\n');
}

/** A figure block per entry, one after the other, on their own lines; the caret at the end of the first caption. */
export const figuresCommand =
	(figures: FigureSpec[]): StateCommand =>
	({ state, dispatch }) => {
		const text = figures.map(figureBlock).join('\n');
		const caret = text.indexOf('\\caption{') + '\\caption{'.length + (figures[0].caption ?? '').length;
		return insertBlock(state, dispatch, text, caret, caret);
	};

export const tableCommand = (rows: number, cols: number) => snippetBlock(tableSnippet(rows, cols));

/** `cmd` at the caret: as it is in math mode, else wrapped in `$…$` (math.ts has the rule). In math, a command
 *  ending in a letter gets a space when a letter follows, so `\alpha` before `x` doesn't become `\alphax`. */
export const symbolCommand =
	(cmd: string): StateCommand =>
	({ state, dispatch }) => {
		const { from, to } = state.selection.main;
		const math = inMath(state.doc.toString(), from);
		const insert = !math ? `$${cmd}$` : /[A-Za-z]$/.test(cmd) && /^[A-Za-z]/.test(state.sliceDoc(to, to + 1)) ? `${cmd} ` : cmd;
		dispatch(
			state.update({
				changes: { from, to, insert },
				selection: EditorSelection.cursor(from + insert.length),
				scrollIntoView: true,
				userEvent: 'input'
			})
		);
		return true;
	};
