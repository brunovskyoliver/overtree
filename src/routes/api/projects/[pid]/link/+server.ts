import { error, json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { setLink } from '#lib/server/projects.ts';
import type { RequestHandler } from './$types';

/** `{ role: 'editor' | 'reader' | null, regenerate? }`, owner only → `{ token, role }` or null (link off). */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json().catch(() => null);
	if (!body || !('role' in body)) error(400, 'expected { role: "editor" | "reader" | null, regenerate?: boolean }');
	const link = api(() => {
		requireProject(locals, params.pid, 'owner');
		return setLink(params.pid, body.role, body.regenerate === true);
	});
	return json(link);
};
