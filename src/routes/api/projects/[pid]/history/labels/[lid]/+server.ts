import { json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { deleteLabel, renameLabel } from '#lib/server/history.ts';
import type { RequestHandler } from './$types';

// The label's author or the owner (checked by renameLabel/deleteLabel); members get past the project guard.

/** `{ name }` → `Label` */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const { user } = api(() => requireProject(locals, params.pid, 'read'));
	const body = await request.json().catch(() => ({}));
	return json(api(() => renameLabel(params.pid, Number(params.lid), user.id, body?.name)));
};

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { user } = api(() => requireProject(locals, params.pid, 'read'));
	api(() => deleteLabel(params.pid, Number(params.lid), user.id));
	return new Response(null, { status: 204 });
};
