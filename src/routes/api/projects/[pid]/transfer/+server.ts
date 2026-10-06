import { json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { transferOwnership } from '#lib/server/projects.ts';
import type { RequestHandler } from './$types';

/** `{ userId }` of a collaborator, owner only: they become owner, the caller an Editor. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json().catch(() => null);
	api(() => {
		const { user } = requireProject(locals, params.pid, 'owner');
		transferOwnership(params.pid, user.id, body?.userId);
	});
	return json({ ownerId: body.userId });
};
