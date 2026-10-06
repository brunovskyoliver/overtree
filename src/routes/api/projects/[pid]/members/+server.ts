import { json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { inviteMember, listMembers } from '#lib/server/projects.ts';
import type { RequestHandler } from './$types';

/** Everyone with access sees the list; pending invites and file overrides only the owner. */
export const GET: RequestHandler = ({ locals, params }) => {
	const { role } = api(() => requireProject(locals, params.pid, 'read'));
	return json(api(() => listMembers(params.pid, role === 'owner')));
};

/** `{ email, role }`, owner only: an account becomes a collaborator, an unknown email gets a pending invite. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json().catch(() => null);
	const status = api(() => {
		requireProject(locals, params.pid, 'owner');
		return inviteMember(params.pid, body?.email, body?.role);
	});
	return json({ status }, { status: 201 });
};
