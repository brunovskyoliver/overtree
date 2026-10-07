import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { and, asc, eq, gt, isNotNull, lte } from 'drizzle-orm';
import diff from 'fast-diff';
import * as Y from 'yjs';
import type { Compare, FileDiff, Segment, VersionDiff } from '../history-types.ts';
import { getServer } from './collab.ts';
import { fail, getMainFileId } from './files.ts';
import {
	blobText,
	changedFiles,
	currentText,
	flushHistory,
	getVersion,
	previousVersion,
	readManifest,
	userRefs,
	versionRow,
	type Manifest,
	type ManifestEntry,
	type Version
} from './history.ts';
import { restorable } from './restore.ts';
import { files, historyLog } from './schema.ts';

// Per-author diffs between two states of a project (research R4): a version and the current state, or a version
// and the one before it. Text files with the same id on both sides replay their history log into a Yjs doc and
// diff two snapshots of it, so every insert and delete carries the user whose update made it; everything else
// (deleted files, logs that don't add up) falls back to a plain text diff. No SvelteKit imports (see history.ts).

const db = () => getServer().db;
const NOW = Number.MAX_SAFE_INTEGER; // watermark of the current state: every log row

/** One side of a comparison: a manifest, the log watermark it was taken at, and texts already in memory. */
type Side = { manifest: Manifest; watermark: number; texts?: Map<string, string> };

const EMPTY: Side = { manifest: { mainFileId: null, entries: [] }, watermark: 0 };
const versionSide = (v: Version): Side => ({ manifest: readManifest(v.manifestHash), watermark: v.watermark });

/** The project now, with text hashes computed in memory (nothing stored). */
function currentSide(pid: string): Side {
	const texts = new Map<string, string>();
	const rows = db()
		.select({ id: files.id, parentId: files.parentId, name: files.name, kind: files.kind, hash: files.hash })
		.from(files)
		.where(eq(files.projectId, pid))
		.orderBy(asc(files.id))
		.all();
	const entries = rows.map((r): ManifestEntry => {
		if (r.kind !== 'text') return { ...r, hash: r.kind === 'binary' ? r.hash : null };
		const text = currentText(r.id);
		texts.set(r.id, text);
		return { ...r, hash: createHash('sha256').update(text, 'utf8').digest('hex') };
	});
	return { manifest: { mainFileId: getMainFileId(pid), entries }, watermark: NOW, texts };
}

const textOf = (side: Side, e: ManifestEntry) => side.texts?.get(e.id) ?? blobText(e.hash!);
const blobSize = (hash: string | null) => (hash ? statSync(join(getServer().dataDir, 'blobs', hash)).size : null);

/** Adjacent runs with the same op and author as one. */
function push(out: Segment[], s: Segment) {
	if (!s.text) return;
	const last = out.at(-1);
	if (last && last.op === s.op && last.userId === s.userId) last.text += s.text;
	else out.push(s);
}

/** Character diff without authorship (fast-diff); changes go to `userId`. */
export function plainSegments(older: string, newer: string, userId: string | null): Segment[] {
	const out: Segment[] = [];
	for (const [op, text] of diff(older, newer))
		push(out, op === diff.EQUAL ? { op: '=', text, userId: null } : { op: op === diff.INSERT ? '+' : '-', text, userId });
	return out;
}

type Run = { clock: number; end: number; userId: string | null };

/** Attributed segments of document `docName` from watermark `a` to `b` by replaying its log (research R4); null
 *  when the replay doesn't reproduce `older` and `newer` (rows missing, an update applied but not logged yet).
 *  ponytail: replays from the document's first row on every call; per-version Yjs checkpoints if it gets slow */
export function yjsSegments(docName: string, a: number, b: number, older: string, newer: string): Segment[] | null {
	const rows = db()
		.select({ id: historyLog.id, userId: historyLog.userId, update: historyLog.update })
		.from(historyLog)
		.where(and(eq(historyLog.docName, docName), lte(historyLog.id, b), isNotNull(historyLog.update)))
		.orderBy(asc(historyLog.id))
		.all();
	const doc = new Y.Doc({ gc: false });
	let i = 0;
	for (; i < rows.length && rows[i].id <= a; i++) Y.applyUpdate(doc, rows[i].update!);
	const before = Y.snapshot(doc);
	// who inserted which struct range, and whose delete set removed what, for the rows in (a, b]
	const inserted = new Map<number, Run[]>();
	const deleted: { ds: ReturnType<typeof Y.decodeUpdate>['ds']; userId: string | null }[] = [];
	for (const r of rows.slice(i)) {
		Y.applyUpdate(doc, r.update!);
		const { structs, ds } = Y.decodeUpdate(r.update!);
		for (const s of structs) {
			const runs = inserted.get(s.id.client) ?? [];
			runs.push({ clock: s.id.clock, end: s.id.clock + s.length, userId: r.userId });
			inserted.set(s.id.client, runs);
		}
		deleted.push({ ds, userId: r.userId });
	}
	const after = Y.snapshot(doc);
	const insertedBy = (id: Y.ID) => inserted.get(id.client)?.find((r) => r.clock <= id.clock && id.clock < r.end)?.userId ?? null;
	const deletedBy = (id: Y.ID) => deleted.find((d) => Y.isDeleted(d.ds, id))?.userId ?? null;
	const delta = doc.getText('content').toDelta(after, before, (type: 'added' | 'removed', id: Y.ID) => ({
		type,
		user: type === 'added' ? insertedBy(id) : deletedBy(id)
	})) as { insert: unknown; attributes?: { ychange?: { type: 'added' | 'removed'; user: string | null } } }[];
	const out: Segment[] = [];
	for (const op of delta) {
		if (typeof op.insert !== 'string') continue;
		const ch = op.attributes?.ychange;
		const kind: Segment['op'] = ch ? (ch.type === 'added' ? '+' : '-') : '=';
		push(out, { op: kind, text: op.insert, userId: ch?.user ?? null });
	}
	const side = (skip: '+' | '-') =>
		out
			.filter((s) => s.op !== skip)
			.map((s) => s.text)
			.join('');
	return side('+') === older && side('-') === newer ? out : null;
}

/** The only author of the project's log rows in (a, b], else null (attribution of plain diffs, research R4). */
function soleAuthor(pid: string, a: number, b: number): string | null {
	const ids = db()
		.selectDistinct({ userId: historyLog.userId })
		.from(historyLog)
		.where(and(eq(historyLog.projectId, pid), gt(historyLog.id, a), lte(historyLog.id, b), isNotNull(historyLog.userId)))
		.limit(2)
		.all();
	return ids.length === 1 ? ids[0].userId : null;
}

/** Version `vid` of project `pid` against the current state (`current`) or against the version before it
 *  (`previous`: what this version changed), as `userId` sees it. 404 for a version of another project. */
export function diffVersion(pid: string, vid: number, compare: Compare, userId: string): VersionDiff {
	const v = versionRow(pid, vid) ?? fail(404, 'Version not found.');
	flushHistory(); // the replay reads the log up to now
	let older: Side, newer: Side;
	if (compare === 'previous') {
		const prev = previousVersion(v);
		older = prev ? versionSide(prev) : EMPTY;
		newer = versionSide(v);
	} else {
		older = versionSide(v);
		newer = currentSide(pid);
	}
	const target = compare === 'previous' ? newer.manifest : older.manifest; // the state a restore goes back to
	const oldById = new Map(older.manifest.entries.map((e) => [e.id, e]));
	const newById = new Map(newer.manifest.entries.map((e) => [e.id, e]));
	// the single-file restore's own rules (moves back, recreated folders, same-path aliases), run dry (FR-018)
	const canRestore = restorable(pid, userId, target);
	let sole: string | null | undefined;
	const fallbackUser = () => (sole === undefined ? (sole = soleAuthor(pid, older.watermark, newer.watermark)) : sole);

	const changed = changedFiles(older.manifest, newer.manifest);
	// a file deleted and created again at the same path (a restore recreates deleted files with new ids) is one file
	const at = (e: ManifestEntry, path: string) => `${e.kind}:${path.toLowerCase()}`;
	const deletedAt = new Map(changed.filter((c) => c.change === 'deleted').map((c) => [at(oldById.get(c.id)!, c.path), c.id]));
	const pairedWith = new Map<string, string>(); // added id → deleted id
	for (const c of changed) {
		const d = c.change === 'added' ? deletedAt.get(at(newById.get(c.id)!, c.path)) : undefined;
		if (d) pairedWith.set(c.id, d);
	}
	const paired = new Set(pairedWith.values());

	const out: FileDiff[] = [];
	for (const c of changed) {
		if (paired.has(c.id)) continue;
		const o = oldById.get(pairedWith.get(c.id) ?? c.id);
		const n = newById.get(c.id);
		const kind = (n ?? o)!.kind;
		if (kind === 'folder') continue;
		if (pairedWith.has(c.id) && o!.hash === n!.hash) continue;
		const change = pairedWith.has(c.id) ? 'edited' : c.change;
		const file: FileDiff = { id: c.id, path: c.path, ...(c.from && { oldPath: c.from }), kind, change, canRestore: canRestore(c.id) };
		if (kind === 'binary') file.size = { old: o ? blobSize(o.hash) : null, new: n ? blobSize(n.hash) : null };
		else {
			const before = o ? textOf(older, o) : '';
			const after = n ? textOf(newer, n) : '';
			file.segments = (n && !pairedWith.has(c.id) && yjsSegments(c.id, older.watermark, newer.watermark, before, after)) || plainSegments(before, after, fallbackUser());
		}
		out.push(file);
	}
	out.sort((x, y) => x.path.localeCompare(y.path));
	const users = userRefs(out.flatMap((f) => f.segments?.flatMap((s) => (s.userId ? [s.userId] : [])) ?? []));
	return { version: getVersion(pid, v, userId), files: out, users: [...users.values()] };
}
