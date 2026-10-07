import { json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api, requireGitHub } from '#lib/server/api.ts';
import { preview } from '#lib/server/github/links.ts';
import type { RequestHandler } from './$types';

/** Owner, link `pending`: what the first sync would do (FR-008, contracts "preview"). */
export const GET: RequestHandler = async ({ locals, params }) => {
	api(() => {
		requireProject(locals, params.pid, 'owner');
		requireGitHub();
	});
	return json(await api(() => preview(params.pid)));
};
