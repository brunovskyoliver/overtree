import { json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api, requireGitHub } from '#lib/server/api.ts';
import { getStatus, linkRepo, patchLink, unlink } from '#lib/server/github/links.ts';
import type { RequestHandler } from './$types';

/** Any member: the link's status (contracts GitHubStatus). */
export const GET: RequestHandler = ({ locals, params }) => {
	const { user } = api(() => {
		const r = requireProject(locals, params.pid, 'read');
		requireGitHub();
		return r;
	});
	return json(api(() => getStatus(params.pid, user.id)));
};

/** Owner: `{ installationId, repoId, branch, ignore? }` links the project (pending until confirmed). */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	const { user } = api(() => {
		const r = requireProject(locals, params.pid, 'owner');
		requireGitHub();
		return r;
	});
	const body = (await request.json().catch(() => null)) ?? {};
	await api(() => linkRepo(params.pid, user.id, body));
	return json(getStatus(params.pid, user.id));
};

/** Owner: `{ ignore?, branch?, dismissNote? }`. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const { user } = api(() => {
		const r = requireProject(locals, params.pid, 'owner');
		requireGitHub();
		return r;
	});
	const body = (await request.json().catch(() => null)) ?? {};
	await api(() => patchLink(params.pid, user.id, body));
	return json(getStatus(params.pid, user.id));
};

/** Owner: unlink (FR-010); nothing on GitHub or in the project is deleted. */
export const DELETE: RequestHandler = ({ locals, params }) => {
	api(() => {
		requireProject(locals, params.pid, 'owner');
		requireGitHub();
		unlink(params.pid);
	});
	return new Response(null, { status: 204 });
};
