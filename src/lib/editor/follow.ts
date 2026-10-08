// Collaborators writing the same line. A caret that remote text lands on stays put by default, so it ends up in
// front of what the other person typed; and Enter at the end of their line races their typing in flight.
import { countColumn, EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { getIndentation, IndentContext, indentString } from '@codemirror/language';
import { ySyncAnnotation } from 'y-codemirror.next';

/** Remote typing right at the caret pushes it along; a remote line break there doesn't, so it can't drag you onto their new line. */
export const followRemoteTyping = EditorState.transactionFilter.of((tr) => {
	if (!tr.docChanged || !tr.annotation(ySyncAnnotation)) return tr;
	const { ranges, mainIndex } = tr.startState.selection;
	const mapped = ranges.map((r) => {
		if (!r.empty) return r.map(tr.changes);
		let assoc = -1;
		tr.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
			if (fromA === r.head && toA === r.head && !text.toString().includes('\n')) assoc = 1;
		});
		return EditorSelection.cursor(tr.changes.mapPos(r.head, assoc));
	});
	return [tr, { selection: EditorSelection.create(mapped, mainIndex), sequential: true }];
});

/**
 * Enter at the end of a line puts the new line after the line's own break rather than before it. Same text, but
 * Yjs then anchors it to that break: letters someone is still typing at the end of the line stay on their line
 * (inserted at the same spot, Yjs orders the two by client id, so half the time theirs went onto the new line).
 */
// ponytail: the last line has no break to anchor to, so there it still falls through to the race
export const newlineBelow: StateCommand = ({ state, dispatch }) => {
	const r = state.selection.main;
	if (state.readOnly || state.selection.ranges.length > 1 || !r.empty) return false;
	const line = state.doc.lineAt(r.head);
	if (r.head !== line.to || line.number === state.doc.lines) return false;
	const cx = new IndentContext(state, { simulateBreak: r.head });
	const indent = indentString(state, getIndentation(cx, r.head) ?? countColumn(/^\s*/.exec(line.text)![0], state.tabSize));
	dispatch(
		state.update({
			changes: { from: line.to + 1, insert: indent + '\n' },
			selection: { anchor: line.to + 1 + indent.length },
			scrollIntoView: true,
			userEvent: 'input'
		})
	);
	return true;
};
