import { EditorSelection, EditorState } from '@codemirror/state';
import { ySyncAnnotation } from 'y-codemirror.next';
import { describe, expect, it } from 'vitest';
import { followRemoteTyping } from '../../src/lib/editor/follow.ts';

// The caret where a collaborator types (research: concurrent end-of-line editing).

const remote = ySyncAnnotation.of({} as never);
const at = (doc: string, pos: number) => EditorState.create({ doc, selection: EditorSelection.cursor(pos), extensions: followRemoteTyping });

describe('followRemoteTyping', () => {
	it('keeps the caret after remote text typed at it', () => {
		const s = at('- user should', 13).update({ changes: { from: 13, insert: ' have' }, annotations: remote }).state;
		expect(s.selection.main.head).toBe(18);
	});

	it('leaves the caret before a remote line break at it', () => {
		const s = at('- user should', 13).update({ changes: { from: 13, insert: '\n- ' }, annotations: remote }).state;
		expect(s.selection.main.head).toBe(13);
	});

	it('leaves local typing alone', () => {
		const s = at('abc', 3).update({ changes: { from: 3, insert: 'd' } }).state;
		expect(s.selection.main.head).toBe(3);
		expect(s.doc.toString()).toBe('abcd');
	});
});
