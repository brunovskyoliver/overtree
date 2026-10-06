import type { Clerk } from '@clerk/clerk-js';
import { PUBLIC_CLERK_PUBLISHABLE_KEY, PUBLIC_TEST_HOOKS } from '$app/env/public';

// Browser side of sign-in (research R1, R4): Clerk's SDK, loaded lazily, or the test cookie when test hooks are on.

/** `GET /api/me` (contracts/http-api.md). */
export type Me = { id: string; email: string; name: string; avatarUrl: string | null; role: 'admin' | 'user'; color: string };

export const TEST_COOKIE = 'overtree-test-user';

/** The test sign-in email, only with PUBLIC_TEST_HOOKS (the server checks OVERTREE_TEST_AUTH itself). */
function testEmail(): string | undefined {
	if (!PUBLIC_TEST_HOOKS) return;
	const part = document.cookie.split('; ').find((c) => c.startsWith(`${TEST_COOKIE}=`));
	return part && decodeURIComponent(part.slice(TEST_COOKIE.length + 1));
}

let clerk: Promise<Clerk> | undefined;

/** The loaded Clerk instance with its bundled UI; one per page. */
export function loadClerk(): Promise<Clerk> {
	return (clerk ??= (async () => {
		const [{ Clerk }, { ui }] = await Promise.all([import('@clerk/clerk-js'), import('@clerk/ui')]);
		const c = new Clerk(PUBLIC_CLERK_PUBLISHABLE_KEY ?? '');
		await c.load({ ui });
		return c;
	})());
}

class Auth {
	me = $state<Me | null>(null);

	/** Loads `me`; null when signed out or blocked. */
	async loadMe() {
		const res = await fetch('/api/me').catch(() => undefined);
		this.me = res?.ok ? await res.json() : null;
		return this.me;
	}
}

export const auth = new Auth();

/** Token for the WebSocket (research R3): a fresh Clerk session JWT per (re)connect, or `test:<email>`. */
export async function getToken(): Promise<string> {
	const email = testEmail();
	if (email) return `test:${email}`;
	if (PUBLIC_TEST_HOOKS && !PUBLIC_CLERK_PUBLISHABLE_KEY) return '';
	const c = await loadClerk();
	return (await c.session?.getToken()) ?? '';
}

/** Sign out (Clerk, or clear the test cookie) and go to the sign-in page. */
export async function signOut() {
	if (testEmail()) document.cookie = `${TEST_COOKIE}=; path=/; max-age=0`;
	else if (PUBLIC_CLERK_PUBLISHABLE_KEY) await (await loadClerk()).signOut();
	location.assign('/sign-in');
}

/** Calls `onEnd` once when the Clerk session ends, e.g. a sign-out in another tab (Clerk syncs it, analyze M1).
 *  Returns the unsubscribe function. The test sign-in has no session to watch. */
export function watchSession(onEnd: () => void): () => void {
	if (testEmail() || !PUBLIC_CLERK_PUBLISHABLE_KEY) return () => {};
	let stop = () => {};
	let stopped = false;
	loadClerk().then((c) => {
		if (stopped) return;
		let had = !!c.session;
		stop = c.addListener(({ session }) => {
			if (had && !session) {
				stop();
				onEnd();
			}
			had = !!session;
		});
	});
	return () => {
		stopped = true;
		stop();
	};
}
