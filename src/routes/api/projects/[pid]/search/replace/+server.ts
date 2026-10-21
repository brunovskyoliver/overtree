import { error, json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { replaceMatches, searchOptions } from '#lib/server/search.ts';
import type { RequestHandler } from './$types';

// Replace (014): body = the search options (`q`, `case`, `word`, `regex`) plus `replacement`, and optionally
// `fileId` (that file only) and `at` (only the match starting there). Per-file edit rights are checked inside.
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const { user } = api(() => requireProject(locals, params.pid, 'read'));
	const body = await request.json().catch(() => null);
	if (!body || typeof body.replacement !== 'string') error(400, 'expected { q, replacement, case?, word?, regex?, fileId?, at? }');
	const { fileId, at } = body;
	if ((fileId !== undefined && typeof fileId !== 'string') || (at !== undefined && (!Number.isInteger(at) || fileId === undefined)))
		error(400, 'fileId must be a string; at needs a fileId and must be an integer');
	const opts = api(() => searchOptions(body));
	return json(await api(() => replaceMatches(params.pid, user.id, opts, body.replacement, { fileId, at })));
};
