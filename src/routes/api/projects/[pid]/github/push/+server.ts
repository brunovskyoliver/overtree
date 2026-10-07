import { json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api, requireGitHub } from '#lib/server/api.ts';
import { manualSync } from '#lib/server/github/links.ts';
import type { RequestHandler } from './$types';

/** Owner or editor (readers 403, FR-026): `{ title? }` pushes now (a pull first). 200 with the run's result within
 *  30 s, else 202 (the status follows by broadcast). */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const { user } = api(() => {
		const r = requireProject(locals, params.pid, 'edit');
		requireGitHub();
		return r;
	});
	const body = (await request.json().catch(() => null)) ?? {};
	const result = await api(() => manualSync(params.pid, user.id, 'push', body));
	return result ? json(result) : json({ result: 'queued' }, { status: 202 });
};
