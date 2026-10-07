import { json } from '@sveltejs/kit';
import { api, requireGitHubUser } from '#lib/server/api.ts';
import { listRepos } from '#lib/server/github/accounts.ts';
import type { RequestHandler } from './$types';

/** Repositories the user's connection can push to, grouped by installation account (FR-006); 409 with
 *  `reconnect` when the connection is dead. */
export const GET: RequestHandler = async ({ locals }) => {
	const user = api(() => requireGitHubUser(locals));
	return json(await api(() => listRepos(user.id)));
};
