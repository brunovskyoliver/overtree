import { pathOf } from '../files.ts';
import { buildRegExp, describe, expand, lineStarts, matches, MATCH_CAP, type SearchFile, type SearchOptions, type SearchResult } from '../search.ts';
import { canEdit, fileRoles } from './access.ts';
import { getServer } from './collab.ts';
import { fail, fileOr404, listFiles } from './files.ts';
import { closeVersion, currentText } from './history.ts';

// Project search and replace (014 plan D1–D4). Reads the current text of every text file (the live Hocuspocus doc,
// else the stored state); replacements are Yjs edits through a direct connection carrying the user, so history
// credits them and open editors get them like a collaborator's typing (Principle I). The project role is the
// route's check; per-file roles (overrides) decide what may be replaced.

/** Search options from the query string (`?q=…&case=1&word=1&regex=1`) or a JSON body with the same keys. */
export function searchOptions(p: URLSearchParams | Record<string, unknown>): SearchOptions {
	const get = (k: string) => (p instanceof URLSearchParams ? p.get(k) : p[k]);
	const query = get('q');
	if (typeof query !== 'string' || !query) fail(400, 'Type something to search for.');
	const on = (k: string) => [true, '1', 'true'].includes(get(k) as string | boolean);
	return { query: query as string, caseSensitive: on('case'), wholeWord: on('word'), regex: on('regex') };
}

function regExp(o: SearchOptions): RegExp {
	const re = buildRegExp(o);
	return re instanceof RegExp ? re : fail(400, re.error);
}

/** Text files of the project with their paths, in path order. */
function textFiles(pid: string) {
	const all = listFiles(pid);
	return all
		.filter((f) => f.kind === 'text')
		.map((f) => ({ id: f.id, path: pathOf(f.id, all) }))
		.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
}

/** Matches in every text file `userId` can see, grouped by file, at most MATCH_CAP in all. */
// ponytail: decodes and scans every text file per request, fine for the 2,000-file limit; cache per document
// version or keep an index if large projects get slow
export function searchProject(pid: string, userId: string, o: SearchOptions): SearchResult {
	const re = regExp(o);
	const { roleOf } = fileRoles(pid, userId);
	const out: SearchFile[] = [];
	let total = 0;
	let truncated = false;
	for (const f of textFiles(pid)) {
		const role = roleOf(f.id);
		if (!role) continue; // ponytail: per-file roles never hide a file today (overrides are editor/reader); this keeps it so if they do
		const text = currentText(f.id);
		// one more than room is left: tells whether the cap cut something off
		const found = [...matches(text, re, MATCH_CAP - total + 1)];
		if (total + found.length > MATCH_CAP) {
			truncated = true;
			found.length = MATCH_CAP - total;
		}
		if (found.length) {
			const starts = lineStarts(text);
			out.push({ fileId: f.id, path: f.path, canEdit: canEdit(role), matches: found.map((m) => describe(text, m, starts)) });
			total += found.length;
		}
		if (truncated) break;
	}
	return { files: out, total, truncated };
}

export type ReplaceScope = { fileId?: string; at?: number };
export type ReplaceResult = { replaced: number; files: number; skipped: number };

/** Replaces matches as `userId`: the one starting at `at` in `fileId`, every match in `fileId`, or (no `fileId`)
 *  every match in every file the user may edit; `skipped` counts the matches left in read-only files. Matches are
 *  found again on the current text inside the Yjs transaction, so a stale `at` is a 409, never a wrong edit.
 *  A project-wide replace becomes a history version of its own (plan D3). */
export async function replaceMatches(pid: string, userId: string, o: SearchOptions, replacement: string, scope: ReplaceScope = {}): Promise<ReplaceResult> {
	const re = regExp(o);
	const { roleOf } = fileRoles(pid, userId);
	let targets: string[];
	let skipped = 0;
	if (scope.fileId !== undefined) {
		const row = fileOr404(pid, scope.fileId);
		if (row.kind !== 'text') fail(400, 'Only text files can be searched.');
		if (!canEdit(roleOf(row.id))) fail(403, 'You can view this file but not edit it.');
		targets = [row.id];
	} else {
		targets = [];
		for (const f of textFiles(pid)) {
			const role = roleOf(f.id);
			if (!role) continue;
			const n = [...matches(currentText(f.id), re)].length;
			if (!n) continue;
			if (canEdit(role)) targets.push(f.id);
			else skipped += n;
		}
		closeVersion(pid, 'edit'); // what came before stays a version of its own
	}

	let replaced = 0;
	let changedFiles = 0;
	let stale = false;
	for (const id of targets) {
		const conn = await getServer().hocuspocus.openDirectConnection(id, { userId, projectId: pid });
		try {
			await conn.transact((doc) => {
				const t = doc.getText('content');
				let found = [...matches(t.toString(), re)];
				if (scope.at !== undefined) found = found.filter((m) => m.index === scope.at);
				if (!found.length) return void (stale = scope.at !== undefined);
				// from the end: earlier offsets stay valid
				for (const m of found.reverse()) {
					const by = expand(replacement, m, o.regex);
					t.delete(m.index, m[0].length);
					if (by) t.insert(m.index, by);
				}
				replaced += found.length;
				changedFiles++;
			});
		} finally {
			await conn.disconnect();
		}
	}
	if (stale) fail(409, 'That match has changed since the search. Search again.');
	if (scope.fileId === undefined && replaced) closeVersion(pid, 'edit');
	return { replaced, files: changedFiles, skipped };
}
