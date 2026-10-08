import { EditorSelection, EditorState } from '@codemirror/state';
import { ySyncAnnotation } from 'y-codemirror.next';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { followRemoteTyping, newlineBelow } from '../../src/lib/editor/follow.ts';

// Two people on the same line: the caret where a collaborator types, and Enter at the end of their line.

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

describe('newlineBelow', () => {
	const enter = (doc: string, pos: number) => {
		let out: { from: number; text: string; state: EditorState } | null = null;
		newlineBelow({
			state: EditorState.create({ doc, selection: EditorSelection.cursor(pos) }),
			dispatch: (tr) => tr.changes.iterChanges((from, _t, _f, _tb, text) => (out = { from, text: text.toString(), state: tr.state }))
		});
		return out as { from: number; text: string; state: EditorState } | null;
	};

	it('puts the new line after the line break, keeping indentation', () => {
		const r = enter('  abc\nX', 5)!;
		expect(r.from).toBe(6);
		expect(r.state.doc.toString()).toBe('  abc\n  \nX');
		expect(r.state.selection.main.head).toBe(8);
	});

	it('falls back to the default Enter mid-line and on the last line', () => {
		expect(enter('abc\nX', 1)).toBeNull();
		expect(enter('abc\nX', 5)).toBeNull();
	});

	it("keeps a collaborator's in-flight letters on their line, whichever client id wins", () => {
		for (const [ca, cb] of [[1, 2], [2, 1]]) {
			const a = new Y.Doc();
			a.clientID = ca;
			const b = new Y.Doc();
			b.clientID = cb;
			a.getText('t').insert(0, 'abc\nX');
			Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
			a.getText('t').insert(3, 'd'); // A still typing at the end of line 1
			b.getText('t').insert(enter('abc\nX', 3)!.from, '\n'); // B presses Enter there before it arrives
			Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
			Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
			expect(a.getText('t').toString()).toBe('abcd\n\nX');
		}
	});
});
