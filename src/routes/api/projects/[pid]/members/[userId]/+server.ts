import { json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { removeMember, setMemberRole } from '#lib/server/projects.ts';
import type { RequestHandler } from './$types';

/** `{ role }`, owner only. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json().catch(() => null);
	api(() => {
		requireProject(locals, params.pid, 'owner');
		setMemberRole(params.pid, params.userId, body?.role);
	});
	return json({ role: body.role });
};

/** Owner only; their file overrides go too. */
export const DELETE: RequestHandler = ({ locals, params }) => {
	api(() => {
		requireProject(locals, params.pid, 'owner');
		removeMember(params.pid, params.userId);
	});
	return new Response(null, { status: 204 });
};
