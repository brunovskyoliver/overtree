import { json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { setOverride } from '#lib/server/projects.ts';
import type { RequestHandler } from './$types';

/** `{ userId, fileId, role: 'editor' | 'reader' | null }`, owner only; null removes the override. */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json().catch(() => null);
	api(() => {
		requireProject(locals, params.pid, 'owner');
		setOverride(params.pid, body?.userId, body?.fileId, body?.role);
	});
	return json({ userId: body.userId, fileId: body.fileId, role: body.role });
};
