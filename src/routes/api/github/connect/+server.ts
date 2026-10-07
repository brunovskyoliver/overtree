import { api, requireGitHubUser } from '#lib/server/api.ts';
import { githubConfig } from '#lib/server/github/config.ts';
import { signState, STATE_MS } from '#lib/server/github/crypto.ts';
import { fail } from '#lib/server/files.ts';
import { samePath, STATE_COOKIE, STATE_PATH } from '../state.ts';
import type { RequestHandler } from './$types';

/** `?return=<path>`: 302 to GitHub's user authorization with a signed state, also set as an HttpOnly cookie
 *  (FR-001). GitHub sends the user back to the App's callback URL (`/api/github/callback`). */
export const GET: RequestHandler = ({ locals, url, cookies }) => {
	const { user, ret } = api(() => {
		const user = requireGitHubUser(locals);
		const given = url.searchParams.get('return');
		const ret = given === null ? '/' : samePath(given);
		if (!ret) fail(422, 'The return address must be a path on this site.');
		return { user, ret: ret! };
	});
	const c = githubConfig()!;
	const state = signState({ userId: user.id, return: ret });
	cookies.set(STATE_COOKIE, state, {
		path: STATE_PATH,
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: STATE_MS / 1000
	});
	const to = new URL(`${c.webUrl}/login/oauth/authorize`);
	to.searchParams.set('client_id', c.clientId);
	to.searchParams.set('state', state);
	return new Response(null, { status: 302, headers: { location: to.href } });
};
