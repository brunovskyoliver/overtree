import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { withdrawInvite } from '#lib/server/projects.ts';
import type { RequestHandler } from './$types';

/** Withdraw a pending invite, owner only. */
export const DELETE: RequestHandler = ({ locals, params }) => {
	api(() => {
		requireProject(locals, params.pid, 'owner');
		withdrawInvite(params.pid, params.email);
	});
	return new Response(null, { status: 204 });
};
