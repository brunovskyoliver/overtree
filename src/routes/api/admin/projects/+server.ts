import { json } from '@sveltejs/kit';
import { requireAdmin } from '#lib/server/access.ts';
import { listAllProjects } from '#lib/server/admin.ts';
import { api } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	api(() => requireAdmin(locals));
	return json({ projects: listAllProjects() });
};
