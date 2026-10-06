import { json } from '@sveltejs/kit';
import { canEdit, requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { getServer } from '#lib/server/collab.ts';
import { getProject } from '#lib/server/projects.ts';
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
