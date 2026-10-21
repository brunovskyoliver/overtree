import { error, json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { addEntries, referenceContext } from '#lib/server/references/project.ts';
import type { RequestHandler } from './$types';

// "Add reference" (017 plan.md "Routes"): where entries can go and the keys in use, and the insert. Editors only:
// readers have nothing to insert into.
export const GET: RequestHandler = async ({ locals, params }) => {
	const { user } = api(() => requireProject(locals, params.pid, 'edit'));
	return json(await api(() => referenceContext(params.pid, user.id)));
};

/** `{ fileId } | { path }` (a new file the GET offered) and `entries`: BibTeX texts, one entry each. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const { user } = api(() => requireProject(locals, params.pid, 'edit'));
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'expected { fileId | path, entries }');
	return json(await api(() => addEntries(params.pid, user.id, body, body.entries)));
};
