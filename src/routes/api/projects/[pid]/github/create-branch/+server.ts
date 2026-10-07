import { json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api, requireGitHub } from '#lib/server/api.ts';
import { createBranch } from '#lib/server/github/links.ts';
import type { RequestHandler } from './$types';

/** Owner, link `needs-access` because the branch is gone (T040): creates it again and pushes the project. 200 with
 *  the push's result within 30 s, else 202. */
export const POST: RequestHandler = async ({ locals, params }) => {
	const { user } = api(() => {
		const r = requireProject(locals, params.pid, 'owner');
		requireGitHub();
		return r;
	});
	const result = await api(() => createBranch(params.pid, user.id));
	return result ? json(result) : json({ result: 'queued' }, { status: 202 });
};
