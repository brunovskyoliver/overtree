import * as Y from 'yjs';

// Track changes (013, plan.md D1–D4): suggestions live in the file's Yjs document, in the map `changes` next to the
// text `content`, so they sync, persist, merge offline and reach history like the text itself. Each record is
// anchored with relative positions: an insertion to its first and last character, a deletion to the character
// before the gap its text left. Deletions are applied to the text (compile and GitHub see the proposed version);
// the record keeps the removed text for Reject. Shared by the editor and the server (restore clears records).

export const CHANGES = 'changes';
/** Transaction origin of Accept and Reject: not on anyone's undo stack, never recorded as a suggestion. */
export const REVIEW = 'track-changes:review';

export type Author = { id: string; name: string; color: string };
type Pos = Record<string, unknown>; // Y.relativePositionToJSON, plain JSON
export type InsertChange = { kind: 'insert'; author: Author; at: number; start: Pos; end: Pos };
export type DeleteChange = { kind: 'delete'; author: Author; at: number; start: Pos; text: string };
export type Change = InsertChange | DeleteChange;
/** A record at its place in the text now: an insertion spans [from, to), a deletion sits at from (= to). */
export type Resolved = { id: string; change: Change; from: number; to: number };
/** One change of a local edit: [fromA, toA) of the old text (`deleted`) became [fromB, toB) of the new text. */
export type Edit = { fromA: number; toA: number; fromB: number; toB: number; deleted: string };

export const changesOf = (doc: Y.Doc) => doc.getMap<Change>(CHANGES);

const rel = (t: Y.Text, index: number, assoc: number): Pos =>
	JSON.parse(JSON.stringify(Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(t, index, assoc))));

/** `follow`: through text an undo or redo brought back (Item.redone, known only to the client that did it). */
function abs(t: Y.Text, p: Pos, follow = true): number | null {
	const a = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(p), t.doc!, follow);
	return a && a.type === t ? a.index : null;
}

/** Where a record is now; null for an insertion whose text is all gone (or anchors this doc hasn't seen yet). */
function place(t: Y.Text, c: Change): [number, number] | null {
	const from = abs(t, c.start);
	if (from === null) return null;
	if (c.kind === 'delete') return [from, from];
	const to = abs(t, c.end);
	return to !== null && to > from ? [from, to] : null;
}

/** Every visible record in text order. */
export function resolveChanges(t: Y.Text): Resolved[] {
	const out: Resolved[] = [];
	changesOf(t.doc!).forEach((change, id) => {
		const at = place(t, change);
		if (at) out.push({ id, change, from: at[0], to: at[1] });
	});
	return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

// not crypto.randomUUID(): browsers only have it on https and localhost, a LAN server may be plain http
let seq = 0;
const newId = (t: Y.Text) => `${t.doc!.clientID.toString(36)}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/**
 * Records a local edit, already applied to `t`, as suggestions by `author` (null: tracking is off, only the
 * cleanup runs). `before` is resolveChanges() of the text before the edit. Typing next to the author's own
 * insertion or deletion extends it; text deleted inside any tracked insertion just goes (the suggestion shrinks).
 * Written with `origin`, the editor's sync origin, so the author's undo takes record and text back together.
 */
export function recordEdit(t: Y.Text, edits: Edit[], before: Resolved[], author: Author | null, origin: unknown, now = Date.now()) {
	const map = changesOf(t.doc!);
	const inserts = before.filter((r) => r.change.kind === 'insert');
	const writes = new Map<string, Change>();
	const drops = new Set<string>();
	const latest = <C extends Change>(r: Resolved) => (writes.get(r.id) ?? r.change) as C;
	const mine = (r: Resolved, kind: Change['kind']) => r.change.kind === kind && r.change.author.id === author?.id && !drops.has(r.id);

	t.doc!.transact(() => {
		if (author)
			for (const e of edits) {
				if (e.toA > e.fromA) {
					// the deleted text outside tracked insertions (sorted by start, so overlaps join)
					let kept = '';
					let at = e.fromA;
					for (const r of inserts) {
						if (r.to <= at || r.from >= e.toA) continue;
						if (r.from > at) kept += e.deleted.slice(at - e.fromA, r.from - e.fromA);
						at = Math.max(at, r.to);
					}
					if (at < e.toA) kept += e.deleted.slice(at - e.fromA);
					if (kept) {
						// the author's deletion right before (forward delete) or right after (backspace) joins this one
						const left = before.find((r) => mine(r, 'delete') && r.from === e.fromA);
						const right = before.find((r) => mine(r, 'delete') && r.from === e.toA && r !== left);
						const id = left?.id ?? right?.id ?? newId(t);
						const text = (left ? latest<DeleteChange>(left).text : '') + kept + (right ? latest<DeleteChange>(right).text : '');
						if (left && right) drops.add(right.id);
						writes.set(id, { kind: 'delete', author, at: now, start: rel(t, e.fromB, -1), text });
					}
				}
				if (e.toB > e.fromB) {
					// inside the author's own insertion: its anchors already cover the new text
					if (inserts.some((r) => mine(r, 'insert') && r.from < e.fromA && e.toA < r.to)) continue;
					const end = inserts.find((r) => mine(r, 'insert') && r.to === e.fromA);
					const start = inserts.find((r) => mine(r, 'insert') && r.from === e.toA && r !== end);
					if (end) {
						const tail = start ? latest<InsertChange>(start).end : rel(t, e.toB, -1);
						writes.set(end.id, { ...latest<InsertChange>(end), at: now, end: tail });
						if (start) drops.add(start.id);
					} else if (start) writes.set(start.id, { ...latest<InsertChange>(start), at: now, start: rel(t, e.fromB, 0) });
					else writes.set(newId(t), { kind: 'insert', author, at: now, start: rel(t, e.fromB, 0), end: rel(t, e.toB, -1) });
				}
			}
		for (const [id, c] of writes) if (!drops.has(id)) map.set(id, c);
		for (const id of drops) map.delete(id);
		// insertions whose text is all gone (deleted by anyone, tracked or not)
		if (edits.some((e) => e.toA > e.fromA))
			map.forEach((c, id) => {
				if (c.kind === 'insert' && !writes.has(id) && abs(t, c.start) !== null && !place(t, c)) map.delete(id);
			});
	}, origin);
}

/**
 * Undo and redo bring text back as new Yjs items; only this client knows which old items they replace (Item.redone
 * is not synced), so on every other client and after a reload a record anchored to the old ones lands elsewhere.
 * After each step, such records are anchored afresh, folded into the same undo/redo step.
 */
export function keepAnchors(undo: Y.UndoManager, t: Y.Text) {
	const map = changesOf(t.doc!);
	const moved = (p: Pos) => abs(t, p) !== abs(t, p, false);
	undo.on('stack-item-popped', ({ type }: { type: 'undo' | 'redo' }) => {
		const stale = [...map.entries()].filter(([, c]) => moved(c.start) || (c.kind === 'insert' && moved(c.end)));
		if (!stale.length) return;
		// still inside undo()/redo(): with the manager as origin this lands on the opposite stack, like the step itself
		t.doc!.transact(() => {
			for (const [id, c] of stale) {
				const from = abs(t, c.start)!;
				if (c.kind === 'delete') map.set(id, { ...c, start: rel(t, from, -1) });
				else map.set(id, { ...c, start: rel(t, from, 0), end: rel(t, abs(t, c.end)!, -1) });
			}
		}, undo);
		const stack = type === 'undo' ? undo.redoStack : undo.undoStack;
		if (stack.length < 2) return;
		const add = stack.pop()!;
		const step = stack.at(-1)!;
		step.insertions = Y.mergeDeleteSets([step.insertions, add.insertions]);
		step.deletions = Y.mergeDeleteSets([step.deletions, add.deletions]);
	});
}

/** Accept: the text stays as it is, the records go. */
export function acceptChanges(doc: Y.Doc, ids: string[]) {
	const map = changesOf(doc);
	doc.transact(() => ids.forEach((id) => map.delete(id)), REVIEW);
}

/** Reject: an insertion's text is deleted, a deletion's text comes back at its place; the records go. Each record
 *  is placed afresh, so rejecting several (nested ones too) in one go stays right. */
export function rejectChanges(t: Y.Text, ids: string[]) {
	const map = changesOf(t.doc!);
	t.doc!.transact(() => {
		for (const id of ids) {
			const c = map.get(id);
			if (!c) continue;
			const at = place(t, c);
			if (at && c.kind === 'insert') t.delete(at[0], at[1] - at[0]);
			else if (at && c.kind === 'delete') t.insert(at[0], c.text);
			map.delete(id);
		}
	}, REVIEW);
}

/** Drops every record (a restore writes a version's plain text, plan.md D6). Call inside a transaction. */
export function clearChanges(doc: Y.Doc) {
	const map = changesOf(doc);
	for (const id of [...map.keys()]) map.delete(id);
}
