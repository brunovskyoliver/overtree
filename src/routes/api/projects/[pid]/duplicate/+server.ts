import { json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { duplicateProject } from '#lib/server/projects.ts';
import type { RequestHandler } from './$types';

/** Anyone who can open the project can copy it; the copy is theirs. */
export const POST: RequestHandler = async ({ locals, params }) => {
	const { user } = api(() => requireProject(locals, params.pid, 'read'));
	const id = await api(() => duplicateProject(params.pid, user.id));
	return json({ id }, { status: 201 });
};
