import { json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api, requireGitHub } from '#lib/server/api.ts';
import { confirmLink, getStatus } from '#lib/server/github/links.ts';
import type { RequestHandler } from './$types';

/** Owner, link `pending`: `{ mode: 'merge' }` sets up the first sync (FR-008; `import` comes with US5). */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const { user } = api(() => {
		const r = requireProject(locals, params.pid, 'owner');
		requireGitHub();
		return r;
	});
	const body = (await request.json().catch(() => null)) ?? {};
	await api(() => confirmLink(params.pid, body.mode));
	return json(getStatus(params.pid, user.id));
};
