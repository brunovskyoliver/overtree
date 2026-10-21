import { json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { searchOptions, searchProject } from '#lib/server/search.ts';
import type { RequestHandler } from './$types';

// Project search (014): `?q=…&case=1&word=1&regex=1`, matches in every text file the caller can see; 400 with
// the reason for an invalid regex.
export const GET: RequestHandler = ({ locals, params, url }) => {
	const { user } = api(() => requireProject(locals, params.pid, 'read'));
	return json(api(() => searchProject(params.pid, user.id, searchOptions(url.searchParams))));
};
