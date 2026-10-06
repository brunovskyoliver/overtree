import { json } from '@sveltejs/kit';
import { canEdit, requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { getServer } from '#lib/server/collab.ts';
import { deleteProject, getProject } from '#lib/server/projects.ts';
import { users } from '#lib/server/schema.ts';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals, params }) => {
	const { role } = api(() => requireProject(locals, params.pid, 'read'));
	const p = getProject(params.pid)!;
	const owner = p.ownerId
		? (getServer().db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, p.ownerId)).get() ?? null)
		: null;
	return json({
		id: p.id,
		title: p.title,
		owner,
		role,
		mainFileId: p.mainFileId,
		link: role === 'owner' && p.linkToken ? { token: p.linkToken, role: p.linkRole } : null,
		permissions: { canEdit: canEdit(role) }
	});
};

/** The owner, or a site admin even without access (US5 scenario 7); 404 for anyone else (ids don't leak). */
export const DELETE: RequestHandler = ({ locals, params }) => {
	api(() => {
		if (!(locals.user?.role === 'admin' && getProject(params.pid))) requireProject(locals, params.pid, 'owner');
		deleteProject(params.pid);
	});
	return new Response(null, { status: 204 });
};
