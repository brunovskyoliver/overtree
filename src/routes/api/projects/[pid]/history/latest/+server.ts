import { json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { latestBy } from '#lib/server/history.ts';
import type { RequestHandler } from './$types';

/** `?user=<id>` → `{ versionId, compare }` for that user's newest edits (latestBy), null when they have none; every member. */
export const GET: RequestHandler = ({ locals, params, url }) => {
	api(() => requireProject(locals, params.pid, 'read'));
	return json(latestBy(params.pid, url.searchParams.get('user') ?? ''));
};
