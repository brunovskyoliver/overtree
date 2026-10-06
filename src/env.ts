import { defineEnvVars } from '@sveltejs/kit/env';

// Unset means undefined; an empty string counts as unset.
const optional = (value: string | undefined) => value || undefined;

// src/lib/server runs unbundled in production (`node server.ts`), so it reads the private ones from
// process.env; listing them here documents them and lets the app see them through `$app/env/private`.
export const variables = defineEnvVars({
	PUBLIC_TEST_HOOKS: {
		public: true,
		description: 'Set to 1 to expose window.__overtree and the test sign-in (Playwright).',
		schema: (value) => value === '1'
	},
	PUBLIC_CLERK_PUBLISHABLE_KEY: {
		public: true,
		description: 'Clerk publishable key for the browser SDK. Required unless OVERTREE_TEST_AUTH=1.',
		schema: optional
	},
	CLERK_SECRET_KEY: {
		description: 'Clerk secret key: verifies sessions and reads user profiles. Required unless OVERTREE_TEST_AUTH=1.',
		schema: optional
	},
	CLERK_JWT_KEY: {
		description: 'Optional PEM public key from the Clerk dashboard for networkless session verification.',
		schema: optional
	},
	ADMIN_EMAILS: {
		description: 'Comma-separated emails that are always site admins.',
		schema: optional
	},
	OVERTREE_TEST_AUTH: {
		description: 'Set to 1 to enable the test sign-in bypass (tests only); refused when NODE_ENV=production.',
		schema: (value) => value === '1'
	}
});
