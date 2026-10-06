import { json, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { authenticateRequest } from '#lib/server/auth.ts';

// Every request is authenticated (plan decision 1, research R2). Public pages still get `locals.user` when
// signed in (the share landing page joins with it).
const isPublic = (path: string) =>
	path === '/sign-in' || path === '/blocked' || path.startsWith('/share/') || path.startsWith('/_app/') || path === '/robots.txt';

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const api = path.startsWith('/api/');
	const auth = await authenticateRequest(event.request);
	// Clerk's handshake refreshes the session cookie through a redirect; an API call gets a 401 and the client retries
	if (auth && 'redirect' in auth && !api) return auth.redirect;

	const user = auth && 'user' in auth ? auth.user : null;
	const blocked = auth && 'refused' in auth ? 'not-allowed' : user?.disabled ? 'disabled' : null;
	event.locals.user = blocked ? null : user;
	if (isPublic(path)) return resolve(event);

	if (blocked) {
		if (api) return json({ message: blocked === 'disabled' ? 'Your account is disabled.' : 'Your email isn’t allowed on this instance.', reason: blocked }, { status: 403 });
		redirect(303, `/blocked?reason=${blocked}`);
	}
	if (!user) {
		if (api) return json({ message: 'Sign in to continue.' }, { status: 401 });
		redirect(303, `/sign-in?redirect=${encodeURIComponent(path + event.url.search)}`);
	}
	return resolve(event);
};
