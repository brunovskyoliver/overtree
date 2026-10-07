import { api, requireGitHubUser } from '#lib/server/api.ts';
import { recheckLinks, saveAccount } from '#lib/server/github/accounts.ts';
import { exchangeCode, gh } from '#lib/server/github/api.ts';
import { verifyState } from '#lib/server/github/crypto.ts';
import { fail } from '#lib/server/files.ts';
import { samePath, STATE_COOKIE, STATE_PATH } from '../state.ts';
import type { RequestHandler } from './$types';

/** `?code&state[&installation_id&setup_action]`: the end of the authorization (and of an App install). The state
 *  must equal the cookie, carry a valid signature and belong to the signed-in user (403 otherwise). Exchanges the
 *  code, stores the connection, re-checks the user's `needs-reconnect` links and goes back to `return`. Without a
 *  code (install without OAuth) it only goes back. */
export const GET: RequestHandler = async ({ locals, url, cookies }) => {
	const user = api(() => requireGitHubUser(locals));
	const given = url.searchParams.get('state') ?? '';
	const cookie = cookies.get(STATE_COOKIE);
	const state = api(() => {
		const s = given && cookie === given ? verifyState(given) : null;
		if (!s || s.userId !== user.id) fail(403, 'This GitHub sign-in didn’t start here or expired. Try connecting again.');
		return s!;
	});
	cookies.delete(STATE_COOKIE, { path: STATE_PATH });
	const code = url.searchParams.get('code');
	if (code) {
		await api(async () => {
			const tokens = await exchangeCode(code);
			const me = await gh<{ id: number; login: string }>(tokens.token, 'GET', '/user');
			saveAccount(user.id, tokens, me);
			await recheckLinks(user.id);
		});
	}
	return new Response(null, {
		status: 302,
		headers: { location: samePath(state.return) ?? '/' }
	});
};
