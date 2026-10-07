import { json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { listVersions } from '#lib/server/history.ts';
import type { RequestHandler } from './$types';

/** `?before=<versionId>&limit=50&labels=1` → `{ versions, hasMore }`, newest first; every member. */
export const GET: RequestHandler = ({ locals, params, url }) => {
	const { user } = api(() => requireProject(locals, params.pid, 'read'));
	const q = url.searchParams;
	const before = q.has('before') ? Number(q.get('before')) : undefined;
	return json(
		listVersions(params.pid, user.id, {
			before: Number.isInteger(before) ? before : undefined,
			limit: q.has('limit') ? Number(q.get('limit')) : undefined,
			labelsOnly: q.get('labels') === '1'
		})
	);
};
