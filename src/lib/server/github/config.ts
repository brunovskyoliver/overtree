// GitHub sync configuration (012 contracts/http-api.md "Server environment", FR-004). Read from process.env on every
// call (tests change it between cases); unset GITHUB_APP_ID means the integration doesn't exist.
// Loaded unbundled by server.ts in production: no SvelteKit imports here.

export type GitHubConfig = {
	appId: string;
	slug: string;
	clientId: string;
	clientSecret: string;
	privateKey: string;
	apiUrl: string;
	webUrl: string;
	graceMs: number;
	longMs: number;
	pullMs: number;
	tickMs: number;
};

const REQUIRED = ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET', 'GITHUB_APP_PRIVATE_KEY'] as const;

const envMs = (name: string, fallback: number) => Number(process.env[name] || fallback);
const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** The App's settings, or null when GitHub sync is off (`GITHUB_APP_ID` unset). Assumes `githubConfigProblem()`
 *  is null, which server.ts checks at startup. */
export function githubConfig(): GitHubConfig | null {
	const env = process.env;
	if (!env.GITHUB_APP_ID) return null;
	return {
		appId: env.GITHUB_APP_ID,
		slug: env.GITHUB_APP_SLUG ?? '',
		clientId: env.GITHUB_APP_CLIENT_ID ?? '',
		clientSecret: env.GITHUB_APP_CLIENT_SECRET ?? '',
		// env files and compose often carry the PEM on one line with literal \n
		privateKey: (env.GITHUB_APP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
		apiUrl: trimSlash(env.GITHUB_API_URL || 'https://api.github.com'),
		webUrl: trimSlash(env.GITHUB_URL || 'https://github.com'),
		// env overrides exist only so tests can shorten them (research R5)
		graceMs: envMs('GITHUB_GRACE_MS', 120_000),
		longMs: envMs('GITHUB_LONG_MS', 1_800_000),
		pullMs: envMs('GITHUB_PULL_MS', 120_000),
		tickMs: envMs('GITHUB_TICK_MS', 15_000)
	};
}

/** Why the app can't start with this GitHub configuration (some GITHUB_APP_* set, others missing), or null. */
export function githubConfigProblem(): string | null {
	const set = REQUIRED.filter((name) => process.env[name]);
	if (!set.length) return null;
	const missing = REQUIRED.find((name) => !process.env[name]);
	if (missing) return `${missing} must be set when ${set[0]} is (GitHub sync, see specs/012-github-sync/quickstart.md).`;
	if (!/^\d+$/.test(process.env.GITHUB_APP_ID!)) return 'GITHUB_APP_ID must be the numeric GitHub App id.';
	return null;
}
