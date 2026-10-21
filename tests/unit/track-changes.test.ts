import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
	acceptChanges,
	changesOf,
	clearChanges,
	keepAnchors,
	recordEdit,
	rejectChanges,
	resolveChanges,
	type Author,
	type DeleteChange
} from '../../src/lib/track-changes.ts';

// Track changes (013) on plain Yjs: what the editor's track plugin does for each local edit (src/lib/editor/track.ts),
// Accept/Reject, per-user undo and sync between two documents. The browser journeys are tests/e2e/track-changes.spec.ts.

const ANN: Author = { id: 'ann', name: 'Ann', color: '#81c995' };
const BOB: Author = { id: 'bob', name: 'Bob', color: '#8ab4f8' };

/** A document with `text` and the origin local typing carries (the editor's ySync config). */
function setup(text = 'hello world') {
	const doc = new Y.Doc();
	const t = doc.getText('content');
	t.insert(0, text);
	const origin = { local: true };
	const undo = new Y.UndoManager([t, changesOf(doc)], { trackedOrigins: new Set([origin]) });
	keepAnchors(undo, t);
	/** Replace [from, to) with `insert` as `author` would type it (null: tracking off). */
	const edit = (from: number, to: number, insert: string, author: Author | null = ANN) => {
		const before = resolveChanges(t);
		const deleted = t.toString().slice(from, to);
		doc.transact(() => {
			if (to > from) t.delete(from, to - from);
			if (insert) t.insert(from, insert);
		}, origin);
		recordEdit(t, [{ fromA: from, toA: to, fromB: from, toB: from + insert.length, deleted }], before, author, origin);
	};
	/** Type `s` one character at a time from `at`. */
	const type = (at: number, s: string, author: Author = ANN) => [...s].forEach((ch, i) => edit(at + i, at + i, ch, author));
	const list = () =>
		resolveChanges(t).map((r) => ({
			kind: r.change.kind,
			who: r.change.author.id,
			text: r.change.kind === 'insert' ? t.toString().slice(r.from, r.to) : r.change.text,
			at: r.from
		}));
	return { doc, t, undo, edit, type, list };
}

describe('recording suggestions', () => {
	it('records an insertion and merges adjacent typing by the same author into one', () => {
		const { t, type, edit, list } = setup();
		type(5, ' there');
		expect(t.toString()).toBe('hello there world');
		expect(list()).toEqual([{ kind: 'insert', who: 'ann', text: ' there', at: 5 }]);
		// typing just before it and inside it extends the same suggestion
		type(5, ',');
		edit(9, 9, 'X');
		expect(list()).toEqual([{ kind: 'insert', who: 'ann', text: ', thXere', at: 5 }]);
	});

	it("keeps another author's adjacent typing separate", () => {
		const { type, list } = setup();
		type(5, ' A');
		type(7, ' B', BOB);
		expect(list()).toEqual([
			{ kind: 'insert', who: 'ann', text: ' A', at: 5 },
			{ kind: 'insert', who: 'bob', text: ' B', at: 7 }
		]);
	});

	it('applies a deletion to the text and keeps the removed text; backspace and forward delete merge in order', () => {
		const { t, edit, list } = setup('one two three');
		// backspace "two" from its end
		edit(6, 7, '');
		edit(5, 6, '');
		edit(4, 5, '');
		expect(t.toString()).toBe('one  three');
		expect(list()).toEqual([{ kind: 'delete', who: 'ann', text: 'two', at: 4 }]);
		// forward delete " th" at the same place
		edit(4, 5, '');
		edit(4, 5, '');
		expect(list()).toEqual([{ kind: 'delete', who: 'ann', text: 'two t', at: 4 }]);
	});

	it('replacing a selection is a deletion followed by an insertion', () => {
		const { t, edit, list } = setup('one two three');
		edit(4, 7, '2');
		expect(t.toString()).toBe('one 2 three');
		expect(list()).toEqual([
			{ kind: 'delete', who: 'ann', text: 'two', at: 4 },
			{ kind: 'insert', who: 'ann', text: '2', at: 4 }
		]);
	});

	it('deleting text inside a suggested insertion shrinks it, deleting all of it drops the record', () => {
		const { t, type, edit, list, doc } = setup('ab');
		type(1, 'XYZ', BOB);
		edit(2, 3, ''); // Ann deletes the Y inside Bob's insertion: no deletion record
		expect(list()).toEqual([{ kind: 'insert', who: 'bob', text: 'XZ', at: 1 }]);
		edit(0, 4, ''); // a, X, Z and b: only a and b are proposed deletions
		expect(t.toString()).toBe('');
		expect(list()).toEqual([{ kind: 'delete', who: 'ann', text: 'ab', at: 0 }]);
		expect(changesOf(doc).size).toBe(1);
	});

	it('records nothing with tracking off, but still drops emptied insertions', () => {
		const { type, edit, list, doc } = setup('ab');
		type(1, 'XY');
		edit(0, 0, 'plain ', null);
		expect(list()).toEqual([{ kind: 'insert', who: 'ann', text: 'XY', at: 7 }]);
		edit(7, 9, '', null);
		expect(changesOf(doc).size).toBe(0);
	});
});

describe('review', () => {
	it('accept keeps the text, reject undoes it: insertions are deleted, deletions come back in place', () => {
		const { t, type, edit, list } = setup('one two three');
		type(13, '!');
		edit(3, 7, ''); // " two"
		const [del, ins] = resolveChanges(t);
		expect(del.change.kind).toBe('delete');
		rejectChanges(t, [del.id]);
		expect(t.toString()).toBe('one two three!');
		acceptChanges(t.doc!, [ins.id]);
		expect(t.toString()).toBe('one two three!');
		expect(list()).toEqual([]);
	});

	it('reject all handles a deletion next to an insertion (a replacement) and nested suggestions', () => {
		const { t, type, edit } = setup('one two three');
		edit(4, 7, '2');
		type(5, ' and', BOB); // Bob types right after Ann's replacement
		type(7, 'X'); // Ann types inside Bob's insertion: her own record, nested
		expect(t.toString()).toBe('one 2 aXnd three');
		rejectChanges(t, resolveChanges(t).map((r) => r.id));
		expect(t.toString()).toBe('one two three');
		expect(changesOf(t.doc!).size).toBe(0);
	});

	it('accept all keeps the proposed text', () => {
		const { t, edit, type } = setup('one two three');
		edit(4, 7, '2');
		type(0, '> ');
		acceptChanges(t.doc!, resolveChanges(t).map((r) => r.id));
		expect(t.toString()).toBe('> one 2 three');
		expect(changesOf(t.doc!).size).toBe(0);
	});

	it('review edits are not on the reviewer\'s undo stack', () => {
		const { t, type, undo } = setup('ab');
		type(1, 'X');
		undo.clear();
		rejectChanges(t, resolveChanges(t).map((r) => r.id));
		expect(undo.canUndo()).toBe(false);
	});
});

describe('undo', () => {
	it('undoing a tracked insertion removes its text and its record; redo brings both back', () => {
		const { t, type, undo, list } = setup();
		type(5, ' there');
		undo.undo();
		expect(t.toString()).toBe('hello world');
		expect(list()).toEqual([]);
		undo.redo();
		expect(list()).toEqual([{ kind: 'insert', who: 'ann', text: ' there', at: 5 }]);
	});

	it('undoing a tracked deletion restores the text and drops the record', () => {
		const { t, edit, undo, list } = setup();
		edit(5, 11, '');
		expect(list()).toEqual([{ kind: 'delete', who: 'ann', text: ' world', at: 5 }]);
		undo.undo();
		expect(t.toString()).toBe('hello world');
		expect(list()).toEqual([]);
	});

	it('after undo and redo the other side and a reload place the suggestions right too', () => {
		const a = setup('one two three');
		const mirror = () => {
			const b = new Y.Doc();
			Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));
			return resolveChanges(b.getText('content')).map((r) => [r.change.kind, r.from, r.to]);
		};
		a.type(0, 'new ');
		a.undo.stopCapturing();
		a.edit(7, 11, ''); // " two"
		a.undo.undo();
		a.undo.undo();
		a.undo.redo();
		a.undo.redo();
		expect(a.t.toString()).toBe('new one three');
		expect(mirror()).toEqual([
			['insert', 0, 4],
			['delete', 7, 7]
		]);
		// the re-anchoring is part of the steps: undo still takes each back in one go
		a.undo.undo();
		expect(a.t.toString()).toBe('new one two three');
		expect(mirror()).toEqual([['insert', 0, 4]]);
		a.undo.undo();
		expect(a.t.toString()).toBe('one two three');
		expect(mirror()).toEqual([]);
		expect(a.undo.canUndo()).toBe(false);
	});

	it('an undo step taken apart from earlier typing goes back to the shorter suggestion', () => {
		const { t, type, undo, list } = setup();
		type(5, ' A');
		undo.stopCapturing();
		type(7, 'B');
		undo.undo();
		expect(t.toString()).toBe('hello A world');
		expect(list()).toEqual([{ kind: 'insert', who: 'ann', text: ' A', at: 5 }]);
	});
});

describe('sync', () => {
	it('records travel with the document and resolve to the same places, also after offline edits on both sides', () => {
		const a = setup('one two three');
		const b = new Y.Doc();
		const bt = b.getText('content');
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));
		a.edit(4, 7, '2');
		bt.insert(0, 'B: '); // concurrently on the other side
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));
		Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b));
		expect(bt.toString()).toBe('B: one 2 three');
		const seen = resolveChanges(bt).map((r) => [r.change.kind, r.from, r.to]);
		expect(seen).toEqual([
			['delete', 7, 7],
			['insert', 7, 8]
		]);
		expect(seen).toEqual(resolveChanges(a.t).map((r) => [r.change.kind, r.from, r.to]));
		expect((resolveChanges(bt)[0].change as DeleteChange).text).toBe('two');
	});

	it('clearChanges drops every record', () => {
		const { doc, type } = setup();
		type(0, 'x');
		doc.transact(() => clearChanges(doc));
		expect(changesOf(doc).size).toBe(0);
	});
});
