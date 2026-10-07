import { json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { diffVersion } from '#lib/server/history-diff.ts';
import type { RequestHandler } from './$types';

/** `?compare=current|previous` (default current) → `{ version, files, users }`; every member. */
export const GET: RequestHandler = ({ locals, params, url }) => {
	const { user } = api(() => requireProject(locals, params.pid, 'read'));
	const compare = url.searchParams.get('compare') === 'previous' ? 'previous' : 'current';
	return json(api(() => diffVersion(params.pid, Number(params.vid), compare, user.id)));
};
