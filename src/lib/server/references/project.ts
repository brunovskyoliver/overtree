import { posix } from 'node:path';
import { pathOf, type FileEntry } from '../../files.ts';
import { stripComment } from '../../outline.ts';
import type { AddResult, BibTarget, PreparedEntry, ReferenceContext } from '../../reference-types.ts';
import { BibIndex, formatEntry, freeKey, keyProblem, parseEntries, type Entry } from '../../references/bibtex.ts';
import { broadcast, canEdit, fileRoles, requireEditFiles, requireEditFolder } from '../access.ts';
import { getServer } from '../collab.ts';
import { createEntry, fail, getMainFileId, getText, listFiles } from '../files.ts';

// The project side of "Add reference" (017 US1, US3): which .bib files entries can go into, the keys and works
// already there, and the insert itself, an append through the file's Yjs document (Principle I) like typing.
// Loaded unbundled by server.ts: no SvelteKit imports here.

const isBib = (f: FileEntry) => f.kind === 'text' && f.name.toLowerCase().endsWith('.bib');
export const MAX_ENTRIES = 100;
const MAX_ENTRY_BYTES = 64 * 1024;

/** Paths (from the root) of the .bib files the main document loads with `\bibliography` or `\addbibresource`,
 *  relative to its folder, where latexmk runs (002 compile.ts). */
async function loadedBibs(all: FileEntry[], mainId: string | null): Promise<{ paths: string[]; dir: string }> {
	if (!mainId || !all.some((f) => f.id === mainId)) return { paths: [], dir: '' };
	const dir = posix.dirname(pathOf(mainId, all)).replace(/^\.$/, '');
	const code = (await getText(mainId)).split('\n').map(stripComment).join('\n');
	const paths: string[] = [];
	for (const m of code.matchAll(/\\(bibliography|addbibresource)(?:\[[^\]]*\])?\{([^}]*)\}/g)) {
		for (const raw of m[2].split(',').map((s) => s.trim()).filter(Boolean)) {
			const name = m[1] === 'bibliography' && !raw.toLowerCase().endsWith('.bib') ? `${raw}.bib` : raw;
			paths.push(posix.normalize(posix.join(dir, name)));
		}
	}
	return { paths: [...new Set(paths)], dir };
}

/** Every .bib in the project parsed into an index of keys and works (all files, also those the user can't edit:
 *  a key must be unique across the project). */
async function indexBibs(all: FileEntry[]): Promise<BibIndex> {
	const index = new BibIndex();
	for (const f of all.filter(isBib)) {
		const path = pathOf(f.id, all);
		for (const e of parseEntries(await getText(f.id))) index.add(e, path);
	}
	return index;
}

/** Where the user can put entries, the default first: a .bib the main document loads, else one it loads that
 *  doesn't exist yet (created on insert), else any other .bib the user may edit, else a new `references.bib` next
 *  to the main document. */
async function targets(pid: string, userId: string, all: FileEntry[]): Promise<BibTarget[]> {
	const { roleOf } = fileRoles(pid, userId);
	const { paths: loaded, dir } = await loadedBibs(all, getMainFileId(pid));
	const byPath = new Map(all.map((f) => [pathOf(f.id, all), f]));
	const folderOk = (path: string) => {
		const parent = posix.dirname(path).replace(/^\.$/, '');
		const folder = parent ? byPath.get(parent) : null;
		return (parent === '' || folder?.kind === 'folder') && canEdit(roleOf(folder?.id ?? null));
	};
	const out: BibTarget[] = [];
	for (const path of loaded) {
		const f = byPath.get(path);
		if (f && isBib(f) && canEdit(roleOf(f.id))) out.push({ fileId: f.id, path, loaded: true });
	}
	for (const path of loaded) if (!byPath.has(path) && folderOk(path)) out.push({ fileId: null, path, loaded: true });
	for (const f of all.filter(isBib)) {
		if (canEdit(roleOf(f.id)) && !out.some((t) => t.fileId === f.id)) out.push({ fileId: f.id, path: pathOf(f.id, all), loaded: false });
	}
	const fresh = posix.join(dir, 'references.bib');
	if (!out.length && !byPath.has(fresh) && folderOk(fresh)) out.push({ fileId: null, path: fresh, loaded: false });
	return out;
}

/** `GET /api/projects/:pid/references`. */
export async function referenceContext(pid: string, userId: string): Promise<ReferenceContext> {
	const all = listFiles(pid);
	const index = await indexBibs(all);
	return { targets: await targets(pid, userId, all), keys: [...index.keys.keys()] };
}

/** Entries prepared against the project: default keys made unique, duplicates found. */
export async function prepareEntries(pid: string, entries: Entry[]): Promise<PreparedEntry[]> {
	const index = await indexBibs(listFiles(pid));
	return entries.map((e) => {
		const p = index.prepare(e);
		// later entries of one batch must not get the same key
		if (!p.duplicate) index.add({ ...e, key: p.key }, '');
		return p;
	});
}

/** The one entry in `text`, or a 400. */
function oneEntry(text: unknown): Entry {
	if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_ENTRY_BYTES) fail(400, 'Each entry must be BibTeX text of at most 64 KB.');
	const entries = parseEntries(text as string);
	if (entries.length !== 1) fail(400, 'Each entry must be exactly one BibTeX entry.');
	const bad = keyProblem(entries[0].key);
	if (bad) fail(400, bad);
	return entries[0];
}

/** Appends `texts` (one BibTeX entry each) to the target .bib as `userId`, creating it when the target is a new
 *  file. A work already in the project (same DOI or arXiv id) isn't added again and answers with its key; a key in
 *  use gets a letter appended. Access: edit on the file, or on its folder when it is created. */
export async function addEntries(pid: string, userId: string, target: { fileId?: unknown; path?: unknown }, texts: unknown): Promise<AddResult> {
	if (!Array.isArray(texts) || !texts.length || texts.length > MAX_ENTRIES) fail(400, `Send 1 to ${MAX_ENTRIES} entries.`);
	const entries = (texts as unknown[]).map(oneEntry);
	let all = listFiles(pid);
	let file = typeof target.fileId === 'string' ? all.find((f) => f.id === target.fileId) : undefined;
	if (typeof target.fileId === 'string') {
		if (!file || !isBib(file)) fail(404, 'That .bib file is gone. Pick another one.');
		requireEditFiles(pid, userId, [file!.id]);
	} else {
		// a new file only where the dialog offered one: the server works the targets out again
		const t = (await targets(pid, userId, all)).find((t) => t.fileId === null && t.path === target.path);
		if (!t) fail(400, 'Pick a .bib file to add the reference to.');
		const parentPath = posix.dirname(t!.path).replace(/^\.$/, '');
		const parentId = parentPath ? (all.find((f) => f.kind === 'folder' && pathOf(f.id, all) === parentPath)?.id ?? null) : null;
		requireEditFolder(pid, userId, parentId);
		const created = createEntry(pid, { kind: 'text', name: posix.basename(t!.path), parentId }, userId);
		broadcast(pid, { type: 'tree' });
		all = listFiles(pid);
		file = all.find((f) => f.id === created.id);
	}
	const index = await indexBibs(all);
	const keys: string[] = [];
	const blocks: string[] = [];
	for (const e of entries) {
		const dup = index.duplicate(e);
		if (dup) {
			keys.push(dup.key);
			continue;
		}
		const key = freeKey(e.key, index.keys.keys());
		index.add({ ...e, key }, '');
		keys.push(key);
		blocks.push(formatEntry({ ...e, key }));
	}
	if (blocks.length) {
		const conn = await getServer().hocuspocus.openDirectConnection(file!.id, { userId, projectId: pid });
		try {
			await conn.transact((doc) => {
				const t = doc.getText('content');
				const cur = t.toString();
				const sep = !cur.trim() ? '' : cur.endsWith('\n\n') ? '' : cur.endsWith('\n') ? '\n' : '\n\n';
				t.insert(t.length, `${sep}${blocks.join('\n\n')}\n`);
			});
		} finally {
			await conn.disconnect();
		}
	}
	return { fileId: file!.id, path: pathOf(file!.id, all), keys, added: blocks.length };
}
