import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { leaveProject } from '#lib/server/projects.ts';
import type { RequestHandler } from './$types';

/** A collaborator removes their own access; the owner gets 403. */
export const POST: RequestHandler = ({ locals, params }) => {
	api(() => {
		const { user } = requireProject(locals, params.pid, 'read');
		leaveProject(params.pid, user.id);
	});
	return new Response(null, { status: 204 });
};
