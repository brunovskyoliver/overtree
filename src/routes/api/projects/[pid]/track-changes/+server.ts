import { error } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { setTrackChanges } from '#lib/server/projects.ts';
import type { RequestHandler } from './$types';

// `{ on }`: track changes on or off for the whole project (013), owner and editors; everyone's details refetch.
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	api(() => requireProject(locals, params.pid, 'edit'));
	const body = await request.json().catch(() => null);
	if (typeof body?.on !== 'boolean') error(400, 'expected { on: boolean }');
	api(() => setTrackChanges(params.pid, body.on));
	return new Response(null, { status: 204 });
};
