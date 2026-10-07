import { json } from '@sveltejs/kit';
import { api, requireGitHubUser } from '#lib/server/api.ts';
import { branches } from '#lib/server/github/accounts.ts';
import type { RequestHandler } from './$types';

/** The first 100 branches of a repository and its default branch, through the user's connection. */
export const GET: RequestHandler = async ({ locals, params }) => {
	const user = api(() => requireGitHubUser(locals));
	return json(await api(() => branches(user.id, params.owner, params.repo)));
};
