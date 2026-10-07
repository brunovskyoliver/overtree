import { api, requireGitHubUser } from '#lib/server/api.ts';
import { getAccount, recheckLinks, saveAccount } from '#lib/server/github/accounts.ts';
import { exchangeCode, gh } from '#lib/server/github/api.ts';
import { verifyState } from '#lib/server/github/crypto.ts';
import { catchUp } from '#lib/server/github/sync.ts';
import { fail } from '#lib/server/files.ts';
import { samePath, STATE_COOKIE, STATE_PATH } from '../state.ts';
import type { RequestHandler } from './$types';

/** `?code&state[&installation_id&setup_action]`: the end of the authorization (and of an App install). With a code
 *  the state must equal the cookie, carry a valid signature and belong to the signed-in user (403 otherwise); the
 *  code is exchanged and the connection stored. With or without a code (GitHub's Setup URL redirect after installing
 *  the App or granting it a repository carries none, and no state of ours either) the signed-in user's paused links
 *  are checked again and resumed ones catch up (R12): that only re-checks their own links, so it needs no state.
 *  Then back to `return` (a valid state's), else `/`. */
export const GET: RequestHandler = async ({ locals, url, cookies }) => {
	const user = api(() => requireGitHubUser(locals));
	const given = url.searchParams.get('state') ?? '';
	const cookie = cookies.get(STATE_COOKIE);
	const verified = given && cookie === given ? verifyState(given) : null;
	const state = verified && verified.userId === user.id ? verified : null;
	const code = url.searchParams.get('code');
	if (code && !state) api(() => fail(403, 'This GitHub sign-in didn’t start here or expired. Try connecting again.'));
	if (state) cookies.delete(STATE_COOKIE, { path: STATE_PATH });
	if (code) {
		await api(async () => {
			const tokens = await exchangeCode(code);
			const me = await gh<{ id: number; login: string }>(tokens.token, 'GET', '/user');
			saveAccount(user.id, tokens, me);
		});
	}
	if (getAccount(user.id)) for (const pid of await recheckLinks(user.id)) catchUp(pid);
	return new Response(null, {
		status: 302,
		headers: { location: (state && samePath(state.return)) || '/' }
	});
};
