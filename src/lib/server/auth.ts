// Authentication (research R2–R5). Loaded unbundled by server.ts in production: no SvelteKit imports here.

/** The test sign-in bypass is on: OVERTREE_TEST_AUTH=1 and not a production build (research R4). */
export const testAuth = () => process.env.OVERTREE_TEST_AUTH === '1' && process.env.NODE_ENV !== 'production';

/** Why the app can't start with this auth configuration, or null when it can. */
export function authConfigProblem(): string | null {
	const env = process.env;
	if (env.OVERTREE_TEST_AUTH === '1' && env.NODE_ENV === 'production')
		return 'OVERTREE_TEST_AUTH=1 is refused with NODE_ENV=production: the test sign-in must never run in a deployed app.';
	if (!testAuth() && !(env.PUBLIC_CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY))
		return 'PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY must be set (see README.md, Clerk setup).';
	return null;
}
