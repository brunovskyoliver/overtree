import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { limits, type FileKind } from '../files.ts';
import type { VersionInfo } from '../history-types.ts';
import { broadcast, canEdit, fileRoles } from './access.ts';
import { getServer } from './collab.ts';
import { fail, setText, withDescendants, type Row } from './files.ts';
import {
	blobText,
	closeVersion,
	currentText,
	getVersion,
	logTree,
	manifestPaths,
	readManifest,
	versionRow,
	type Manifest
} from './history.ts';
import { kickOverridden, touchProject } from './projects.ts';
import { documents, files, overrides, projects, updates } from './schema.ts';

// Restore a file or the whole project to a version (US2, research R5). The tree changes in one transaction; texts
// go through Hocuspocus as minimal edits by the restorer (no second write path, FR-012/013). Files deleted since
// come back with new ids (a deleted document's log can't be continued). Every change is checked against the
// restorer's per-file roles: a whole-project restore skips what they may not change and lists it (FR-019), a
// single-file restore refuses (FR-018). No SvelteKit imports (see history.ts).

const db = () => getServer().db;

type Create = {
	tid: string;
	id: string;
	parentId: string | null;
	name: string;
	kind: FileKind;
	hash: string | null;
	size: number | null;
};
type Move = { id: string; parentId: string | null; name: string };
type Plan = {
	creates: Create[]; // parents before children
	moves: Move[];
	binaries: { id: string; hash: string; size: number }[];
	texts: { id: string; text: string }[];
	deletes: Set<string>; // current ids, removed with one statement
	main: string | null | undefined; // undefined: unchanged
	skipped: Set<string>; // paths
};

const blobSize = (hash: string) => statSync(join(getServer().dataDir, 'blobs', hash)).size;

/** What restoring `target` (only file `only`, if given) changes, given the ids whose change is `blocked`. */
function plan(pid: string, userId: string, target: Manifest, only: string | undefined, blocked: Set<string>): Plan {
	return planner(pid, userId, target)(only, blocked);
}

/** Whether `userId` may restore each file of `target` on its own: the single-file plan run dry (no texts or blobs
 *  read, a text counts as changed), on one read of the tree and roles (diffVersion's `canRestore`, FR-018). Name
 *  clashes (409 on restore) aren't checked. */
export function restorable(pid: string, userId: string, target: Manifest): (fileId: string) => boolean {
	const run = planner(pid, userId, target);
	return (fileId) => {
		try {
			return run(fileId, new Set(), true).skipped.size === 0;
		} catch {
			return false;
		}
	};
}

/** `plan` with the current tree, the caller's roles and the same-path aliases read once. `dry`: decide only what
 *  is allowed, without reading texts, blobs or the main file. */
function planner(pid: string, userId: string, target: Manifest) {
	const cur = db().select().from(files).where(eq(files.projectId, pid)).all();
	const curById = new Map(cur.map((r) => [r.id, r]));
	const tById = new Map(target.entries.map((e) => [e.id, e]));
	const curPaths = manifestPaths(cur);
	const tPaths = manifestPaths(target.entries);
	const { all, roleOf } = fileRoles(pid, userId);

	// A file deleted and created again at the same path (an earlier restore recreates with new ids) is the same file:
	// the target entry is restored onto the current one instead of deleting it and recreating it next to itself.
	const curAt = new Map(cur.filter((r) => !tById.has(r.id)).map((r) => [`${r.kind}:${curPaths.get(r.id)!.toLowerCase()}`, r.id]));
	const alias = new Map<string, string>(); // target id → current id
	for (const e of target.entries) {
		const c = curById.has(e.id) ? undefined : curAt.get(`${e.kind}:${tPaths.get(e.id)!.toLowerCase()}`);
		if (c) alias.set(e.id, c);
	}
	const targetOf = new Map([...alias].map(([t, c]) => [c, t])); // current id → aliased target id

	return (only: string | undefined, blocked: Set<string>, dry = false): Plan => {
		// a new folder has no role of its own yet: the existing folder it was created in decides
		const anchor = new Map<string, string | null>();
		const anchorOf = (id: string | null) => (id !== null && anchor.has(id) ? anchor.get(id)! : id);
		const editable = (id: string | null) => canEdit(roleOf(anchorOf(id)));
		const p: Plan = {
			creates: [],
			moves: [],
			binaries: [],
			texts: [],
			deletes: new Set(),
			main: undefined,
			skipped: new Set()
		};

		// in scope: everything, or the file plus the folders of its version path that are gone
		let scope: Set<string> | null = null;
		if (only !== undefined) {
			const kind = (curById.get(only) ?? tById.get(only))?.kind ?? fail(404, 'File not found.');
			if (kind === 'folder') fail(400, 'Only files can be restored one by one.');
			const tOnly = tById.has(only) ? only : targetOf.get(only);
			scope = new Set([only, ...(tOnly ? [tOnly] : []), ...(alias.has(only) ? [alias.get(only)!] : [])]);
			const goneFolder = (a: string | null): a is string => a !== null && !curById.has(a) && !alias.has(a);
			for (let a = (tOnly && tById.get(tOnly)?.parentId) ?? null; goneFolder(a); a = tById.get(a)?.parentId ?? null) scope.add(a);
		}
		const inScope = (id: string) => scope === null || scope.has(id);

		// target id → current id: the same file, the aliased one, or the one recreated for it
		const idMap = new Map<string, string>();
		for (const e of target.entries) if (curById.has(e.id)) idMap.set(e.id, e.id);
		for (const [t, c] of alias) idMap.set(t, c);
		const parentOf = (tid: string | null): string | null | undefined => (tid === null ? null : idMap.get(tid));

		// recreations, parents first
		const depth = (id: string) => tPaths.get(id)!.split('/').length;
		const gone = target.entries
			.filter((e) => !curById.has(e.id) && !alias.has(e.id) && inScope(e.id))
			.sort((a, b) => depth(a.id) - depth(b.id));
		for (const e of gone) {
			const parentId = parentOf(e.parentId);
			if (parentId === undefined) {
				p.skipped.add(tPaths.get(e.id)!);
				continue;
			}
			// single file: a gone folder whose name is in use by a folder again is that folder
			if (scope !== null && e.kind === 'folder') {
				const same = cur.find((r) => r.parentId === parentId && r.kind === 'folder' && r.name.toLowerCase() === e.name.toLowerCase());
				if (same) {
					idMap.set(e.id, same.id);
					continue;
				}
			}
			if (blocked.has(e.id) || !editable(parentId)) {
				p.skipped.add(tPaths.get(e.id)!);
				continue;
			}
			const id = randomUUID();
			idMap.set(e.id, id);
			anchor.set(id, anchorOf(parentId));
			const hash = e.kind === 'binary' ? e.hash : null;
			p.creates.push({
				tid: e.id,
				id,
				parentId,
				name: e.name,
				kind: e.kind,
				hash,
				size: hash && !dry ? blobSize(hash) : null
			});
			if (e.kind === 'text' && !dry) p.texts.push({ id, text: blobText(e.hash!) });
		}

		// files in both: back to their place, name and content
		for (const c of cur) {
			const e = tById.get(c.id) ?? tById.get(targetOf.get(c.id) ?? '');
			if (!e || !inScope(c.id)) continue;
			const path = curPaths.get(c.id)!;
			const parentId = parentOf(e.parentId);
			// its old folder isn't restored: left as it is, content included, so `skipped` only lists unchanged paths
			if (parentId === undefined) {
				p.skipped.add(path);
				continue;
			}
			if (parentId !== c.parentId || e.name !== c.name) {
				const ok =
					!blocked.has(c.id) && withDescendants(c.id, all).every((id) => editable(id)) && (parentId === c.parentId || editable(parentId));
				if (ok) p.moves.push({ id: c.id, parentId, name: e.name });
				else p.skipped.add(path);
			}
			if (c.kind === 'text' && dry) {
				if (!editable(c.id)) p.skipped.add(path);
			} else if (c.kind === 'text') {
				const text = blobText(e.hash!);
				if (text !== currentText(c.id)) {
					if (editable(c.id)) p.texts.push({ id: c.id, text });
					else p.skipped.add(path);
				}
			} else if (c.kind === 'binary' && e.hash && e.hash !== c.hash) {
				if (editable(c.id)) p.binaries.push({ id: c.id, hash: e.hash, size: dry ? 0 : blobSize(e.hash) });
				else p.skipped.add(path);
			}
		}

		// files added since: removed; a folder only once nothing stays in it
		for (const c of cur) {
			if (tById.has(c.id) || targetOf.has(c.id) || !inScope(c.id)) continue;
			if (editable(c.id)) p.deletes.add(c.id);
			else p.skipped.add(curPaths.get(c.id)!);
		}
		const moved = new Map(p.moves.map((m) => [m.id, m]));
		const finalParent = (r: Row) => (moved.has(r.id) ? moved.get(r.id)!.parentId : r.parentId);
		for (let changed = true; changed; ) {
			changed = false;
			for (const id of p.deletes) {
				if (cur.some((r) => !p.deletes.has(r.id) && finalParent(r) === id)) {
					p.deletes.delete(id);
					p.skipped.add(curPaths.get(id)!);
					changed = true;
				}
			}
		}

		if (scope === null && !dry) {
			const main = target.mainFileId === null ? null : idMap.get(target.mainFileId);
			const currentMain = db().select({ m: projects.mainFileId }).from(projects).where(eq(projects.id, pid)).get()?.m ?? null;
			if (main !== undefined && main !== currentMain) p.main = main;
		}
		return p;
	};
}

/** Changed entries (target ids) that would end up next to a same-named entry or inside themselves. */
function conflicts(pid: string, p: Plan): string[] {
	const cur = db().select().from(files).where(eq(files.projectId, pid)).all();
	const moved = new Map(p.moves.map((m) => [m.id, m]));
	const created = new Map(p.creates.map((c) => [c.id, c]));
	const final = [
		...cur
			.filter((r) => !p.deletes.has(r.id))
			.map((r) => ({
				id: r.id,
				parentId: r.parentId,
				name: r.name,
				...moved.get(r.id)
			})),
		...p.creates
	];
	const changedTid = (id: string) => (moved.has(id) ? id : created.get(id)?.tid);
	const out = new Set<string>();
	const groups = new Map<string, string[]>();
	for (const f of final) {
		const key = `${f.parentId}/${f.name.toLowerCase()}`;
		groups.set(key, [...(groups.get(key) ?? []), f.id]);
	}
	for (const ids of groups.values()) if (ids.length > 1) for (const id of ids) if (changedTid(id)) out.add(changedTid(id)!);
	const parent = new Map(final.map((f) => [f.id, f.parentId]));
	for (const m of p.moves) {
		const seen = new Set<string>();
		for (let at = m.parentId; at !== null && at !== undefined && !seen.has(at); at = parent.get(at) ?? null) {
			seen.add(at);
			if (at === m.id) out.add(m.id);
		}
	}
	return [...out];
}

/** The tree part of a plan (restore, and pulls from GitHub, 012 T012). */
export type TreePlan = Pick<Plan, 'moves' | 'binaries' | 'deletes' | 'main'> & { creates: Omit<Create, 'tid'>[] };

/** Applies `p`'s creates, moves, binary changes, deletes and main file in one transaction (413 over the project's
 *  file limit), logged as one tree change by `actor` (null: system), then kicks open editors of deleted texts and
 *  broadcasts `tree`. False when `p` changes nothing in the tree (texts are the caller's). */
export function applyTree(pid: string, actor: string | null, p: TreePlan): boolean {
	const tree = p.creates.length + p.moves.length + p.binaries.length + p.deletes.size > 0 || p.main !== undefined;
	if (!tree) return false;
	const deletedTexts: string[] = [];
	db().transaction((tx) => {
		const count = tx.select({ id: files.id }).from(files).where(eq(files.projectId, pid)).all().length;
		if (count - p.deletes.size + p.creates.length > limits.projectMaxFiles)
			fail(413, `A project can have at most ${limits.projectMaxFiles} files.`);
		const now = Date.now();
		for (const c of p.creates)
			tx.insert(files)
				.values({
					id: c.id,
					projectId: pid,
					parentId: c.parentId,
					name: c.name,
					kind: c.kind,
					hash: c.hash,
					size: c.size,
					createdAt: now,
					updatedAt: now
				})
				.run();
		for (const m of p.moves) tx.update(files).set({ parentId: m.parentId, name: m.name, updatedAt: now }).where(eq(files.id, m.id)).run();
		for (const b of p.binaries) tx.update(files).set({ hash: b.hash, size: b.size, updatedAt: now }).where(eq(files.id, b.id)).run();
		if (p.deletes.size) {
			const doomed = [...p.deletes];
			deletedTexts.push(
				...tx
					.select({ id: files.id })
					.from(files)
					.where(and(inArray(files.id, doomed), eq(files.kind, 'text')))
					.all()
					.map((r) => r.id)
			);
			tx.delete(overrides).where(inArray(overrides.fileId, doomed)).run();
			tx.delete(files).where(inArray(files.id, doomed)).run(); // one statement: the parent FK is checked at its end
			tx.delete(documents).where(inArray(documents.name, deletedTexts)).run();
			tx.delete(updates).where(inArray(updates.docName, deletedTexts)).run();
			tx.update(projects)
				.set({ mainFileId: null })
				.where(and(eq(projects.id, pid), inArray(projects.mainFileId, doomed)))
				.run();
		}
		if (p.main !== undefined) tx.update(projects).set({ mainFileId: p.main }).where(eq(projects.id, pid)).run();
		logTree(pid, actor, tx);
	});
	touchProject(pid);
	// open editors of removed files get kicked, as on delete (files.ts deleteEntry)
	for (const t of deletedTexts) getServer().hocuspocus.closeConnections(t);
	broadcast(pid, { type: 'tree' });
	if (p.moves.length) kickOverridden(pid);
	return true;
}

/** Restore project `pid` (or only file `fileId`) to version `vid` as `userId`; the project role is the caller's
 *  check (E). `version` is the new `restore` version, null when nothing changed; `skipped` lists the paths left
 *  as they are (whole project only; a single file is refused with 403 instead). */
export async function restoreVersion(
	pid: string,
	vid: number,
	userId: string,
	fileId?: string
): Promise<{ version: VersionInfo | null; skipped: string[] }> {
	const v = versionRow(pid, vid) ?? fail(404, 'Version not found.');
	const target = readManifest(v.manifestHash);

	// synchronous up to the text writes: no tree change can come in between plan and apply
	closeVersion(pid, 'edit'); // the state before the restore stays a version of its own
	const blocked = new Set<string>();
	let p = plan(pid, userId, target, fileId, blocked);
	for (let bad = conflicts(pid, p); bad.length; bad = conflicts(pid, p)) {
		if (fileId !== undefined) fail(409, 'A file with that name is in the way; rename or move it first.');
		for (const id of bad) blocked.add(id);
		p = plan(pid, userId, target, fileId, blocked);
	}
	if (fileId !== undefined && p.skipped.size) fail(403, 'You don’t have edit access to this file.');

	const tree = applyTree(pid, userId, p);
	// live in open editors; collaborators' undo managers don't track it (research R5)
	for (const t of p.texts) await setText(t.id, t.text, { userId, projectId: pid });

	if (!tree && !p.texts.length) return { version: null, skipped: [...p.skipped].sort() };
	const version = closeVersion(pid, 'restore', { restoredFrom: v.id })!;
	return {
		version: getVersion(pid, version, userId),
		skipped: [...p.skipped].sort()
	};
}
