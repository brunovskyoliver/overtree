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
	},
	GITHUB_APP_ID: {
		description: 'Numeric GitHub App id; set it (with the other GITHUB_APP_* variables) to enable GitHub sync (012 quickstart.md).',
		schema: optional
	},
	GITHUB_APP_SLUG: {
		description: "The GitHub App's URL name, used for install links. Required with GITHUB_APP_ID.",
		schema: optional
	},
	GITHUB_APP_CLIENT_ID: {
		description: "The GitHub App's client id for user authorization. Required with GITHUB_APP_ID.",
		schema: optional
	},
	GITHUB_APP_CLIENT_SECRET: {
		description: "The GitHub App's client secret for user authorization. Required with GITHUB_APP_ID.",
		schema: optional
	},
	GITHUB_APP_PRIVATE_KEY: {
		description: "The GitHub App's PEM private key (literal \\n allowed). Required with GITHUB_APP_ID.",
		schema: optional
	},
	GITHUB_API_URL: {
		description: 'GitHub REST API URL; default https://api.github.com (tests, GitHub Enterprise Server).',
		schema: optional
	},
	GITHUB_URL: {
		description: 'GitHub web URL (OAuth, install links); default https://github.com (tests, GitHub Enterprise Server).',
		schema: optional
	},
	GITHUB_GRACE_MS: {
		description: 'Tests only: wait after the last collaborator leaves before pushing; default 120000.',
		schema: optional
	},
	GITHUB_LONG_MS: {
		description: 'Tests only: push interval during long sessions; default 1800000.',
		schema: optional
	},
	GITHUB_PULL_MS: {
		description: 'Tests only: pull interval while a project is open; default 120000.',
		schema: optional
	},
	GITHUB_TICK_MS: {
		description: 'Tests only: GitHub scheduler tick; default 15000.',
		schema: optional
	}
});
