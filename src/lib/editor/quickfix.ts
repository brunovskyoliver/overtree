// One-click fixes for compile errors (Hint.action): the editor's quick fix in the marker's tooltip and the logs'
// Fix button. The change is applied to the text as it is now and blinks, so you see what it did; Ctrl+Z takes it back.
import type { EditorView } from '@codemirror/view';
import type { HintAction } from '../compile-types.ts';
import { flash } from './flash.ts';

export type Change = { from: number; to: number; insert: string };

/** The changes `action` makes in `doc`, its token at `range`; null when it no longer applies: the token isn't there
 *  any more, the package is loaded already, or this file has no preamble (a chapter: fix it in the main document). */
export function fixChanges(doc: string, action: HintAction, range: { from: number; to: number }, token?: string): Change[] | null {
	if ('usepackage' in action) {
		const begin = doc.indexOf('\\begin{document}');
		const cls = doc.search(/\\documentclass\b/);
		if (begin < 0 || cls < 0 || cls > begin) return null;
		const preamble = doc.slice(0, begin);
		if (new RegExp(`\\\\usepackage\\s*(\\[[^\\]]*\\])?\\s*\\{[^}]*\\b${action.usepackage}\\b`).test(preamble)) return null;
		// below the last \usepackage line, else below \documentclass
		// ponytail: a \usepackage whose options run over several lines gets the new one after its first line
		const last = [...preamble.matchAll(/^[ \t]*\\usepackage\b/gm)].at(-1)?.index ?? cls;
		const eol = preamble.indexOf('\n', last);
		const line = `\\usepackage{${action.usepackage}}`;
		return [eol < 0 ? { from: begin, to: begin, insert: `${line}\n` } : { from: eol, to: eol, insert: `\n${line}` }];
	}
	if (!token || doc.slice(range.from, range.to) !== token) return null;
	if ('replace' in action) return [{ from: range.from, to: range.to, insert: action.replace }];
	// env: the token is \begin{old}; its \end is the first \end{old} after it
	const old = token.slice('\\begin{'.length, -1);
	const changes = [{ from: range.from, to: range.to, insert: `\\begin{${action.env}}` }];
	const end = doc.indexOf(`\\end{${old}}`, range.to);
	if (end >= 0) changes.push({ from: end, to: end + `\\end{${old}}`.length, insert: `\\end{${action.env}}` });
	return changes;
}

/** Where `changes` (sorted, not overlapping) put their text in the new document. */
export function changedRanges(changes: Change[]): { from: number; to: number }[] {
	let shift = 0;
	return changes.map((c) => {
		const from = c.from + shift;
		shift += c.insert.length - (c.to - c.from);
		return { from, to: from + c.insert.length };
	});
}

/** Apply `action` in `view` (one undo step) and blink what changed; false when it no longer applies or is read-only. */
export function applyFix(view: EditorView, action: HintAction, range: { from: number; to: number }, token?: string): boolean {
	const changes = !view.state.readOnly && fixChanges(view.state.doc.toString(), action, range, token);
	if (!changes) return false;
	view.dispatch({ changes, userEvent: 'input.fix', scrollIntoView: true });
	flash(view, ...changedRanges(changes));
	view.focus();
	return true;
}
