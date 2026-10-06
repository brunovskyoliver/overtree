// `\begin{}` → `\end{}` name mirroring and Enter auto-close (research R12).
import { snippet, type Completion } from '@codemirror/autocomplete';
import { indentUnit } from '@codemirror/language';
import { EditorState, Prec, StateEffect, StateField, Transaction, type Extension, type StateCommand } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { stripComment } from '../outline.ts';

type Range = { from: number; to: number };
type Mirror = { begin: Range; end: Range };

const startMirror = StateEffect.define<Mirror>();

const validName = (state: EditorState, r: Range) => r.from <= r.to && /^[^{}\\\s%]*$/.test(state.sliceDoc(r.from, r.to));
const inside = (pos: number, r: Range) => pos >= r.from && pos <= r.to;
const map = (r: Range, tr: { changes: { mapPos(pos: number, assoc: number): number } }) => ({
	from: tr.changes.mapPos(r.from, -1),
	to: tr.changes.mapPos(r.to, 1)
});

/** The begin and end name ranges while the cursor stays in the begin name. */
const mirrorField = StateField.define<Mirror | null>({
	create: () => null,
	update(value, tr) {
		for (const e of tr.effects) if (e.is(startMirror)) return e.value;
		if (!value) return null;
		const next = { begin: map(value.begin, tr), end: map(value.end, tr) };
		return inside(tr.state.selection.main.head, next.begin) && validName(tr.state, next.begin) ? next : null;
	}
});

// Typing in the begin name rewrites the end name in the same transaction (one undo step, one Yjs update).
const mirrorFilter = EditorState.transactionFilter.of((tr) => {
	const m = tr.startState.field(mirrorField, false);
	// only the user's own edits: remote Yjs changes and undo carry no user event
	if (!m || !tr.docChanged || !tr.annotation(Transaction.userEvent)) return tr;
	const begin = map(m.begin, tr);
	const end = map(m.end, tr);
	const doc = tr.newDoc;
	const name = doc.sliceString(begin.from, begin.to);
	if (!inside(tr.newSelection.main.head, begin) || !/^[^{}\\\s%]*$/.test(name) || doc.sliceString(end.from, end.to) === name) return tr;
	return [tr, { changes: { from: end.from, to: end.to, insert: name }, sequential: true }];
});

/** `apply` of the `\begin{}` completion: the snippet, then the mirror between its two names. */
export function applyBegin(view: EditorView, completion: Completion, from: number, to: number) {
	snippet('\\begin{${1}}\n\t${2}\n\\end{}')(view, completion, from, to);
	const { state } = view;
	const head = state.selection.main.head; // in the empty begin name
	const endLine = state.doc.line(state.doc.lineAt(head).number + 2);
	const at = endLine.from + endLine.text.indexOf('\\end{}') + '\\end{'.length;
	view.dispatch({ effects: startMirror.of({ begin: { from: head, to: head }, end: { from: at, to: at } }) });
}

const BEGIN_AT_END = /\\begin\{([^}]+)\}(?:\[[^\]]*\]|\{[^}]*\})*\s*$/;

/** Enter right after `\begin{name}` (args allowed) with no surplus `\end{name}` below: open an indented line and close it. */
export const closeEnvironment: StateCommand = ({ state, dispatch }) => {
	const sel = state.selection;
	if (sel.ranges.length > 1 || !sel.main.empty) return false;
	const head = sel.main.head;
	const line = state.doc.lineAt(head);
	if (head !== line.to || stripComment(line.text) !== line.text) return false;
	const m = BEGIN_AT_END.exec(line.text);
	if (!m) return false;
	const name = m[1];
	const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// ponytail: scans to the end of the document on each such Enter, fine for the 5,000-line budget
	let balance = 0;
	for (const t of state.sliceDoc(head).matchAll(new RegExp(`\\\\(begin|end)\\{${esc}\\}`, 'g'))) balance += t[1] === 'end' ? 1 : -1;
	if (balance > 0) return false;
	const indent = /^\s*/.exec(line.text)![0];
	const inner = `\n${indent}${state.facet(indentUnit)}`;
	dispatch(
		state.update({
			changes: { from: head, insert: `${inner}\n${indent}\\end{${name}}` },
			selection: { anchor: head + inner.length },
			scrollIntoView: true,
			userEvent: 'input'
		})
	);
	return true;
};

/** For LaTeX tabs: the mirror and the Enter key (above the default Enter, below the completion popup's). */
export const environments: Extension = [mirrorField, mirrorFilter, Prec.high(keymap.of([{ key: 'Enter', run: closeEnvironment }]))];
