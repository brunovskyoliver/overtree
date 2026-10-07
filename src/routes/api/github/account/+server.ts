import { json } from '@sveltejs/kit';
import { api, requireGitHubUser } from '#lib/server/api.ts';
import { disconnect, getAccount } from '#lib/server/github/accounts.ts';
import { githubConfig } from '#lib/server/github/config.ts';
import type { GitHubAccountInfo } from '#lib/github-types.ts';
import type { RequestHandler } from './$types';

/** The signed-in user's GitHub connection, never its tokens (SC-006). */
export const GET: RequestHandler = ({ locals }) => {
	const user = api(() => requireGitHubUser(locals));
	const c = githubConfig()!;
	const installUrl = `${c.webUrl}/apps/${encodeURIComponent(c.slug)}/installations/new`;
	const acc = getAccount(user.id);
	const body: GitHubAccountInfo = acc
		? {
				connected: true,
				login: acc.login,
				avatarUrl: `${c.webUrl}/${encodeURIComponent(acc.login)}.png?size=64`,
				installUrl,
				manageUrl: `${c.webUrl}/settings/installations`
			}
		: { connected: false, installUrl };
	return json(body);
};

/** Disconnect (FR-010): the user's links become `needs-reconnect`; nothing on GitHub changes. */
export const DELETE: RequestHandler = ({ locals }) => {
	const user = api(() => requireGitHubUser(locals));
	disconnect(user.id);
	return new Response(null, { status: 204 });
};
