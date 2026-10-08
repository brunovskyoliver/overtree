// A caret that remote text lands on stays put by default, so it ends up in front of what the other person typed.
// Someone sitting at the end of a line that a collaborator is still writing would then split their word with Enter.
import { EditorSelection, EditorState } from '@codemirror/state';
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
