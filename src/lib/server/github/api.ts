import { createAppAuth, createOAuthUserAuth } from '@octokit/auth-app';
import { request } from '@octokit/request';
import { githubConfig, type GitHubConfig } from './config.ts';

// GitHub REST over fetch plus App/user tokens via @octokit/auth-app (research R3). Errors become a GitHubError whose
// `reason` drives the link status (research R12) and whose message is plain language without tokens (SC-006).
// Loaded unbundled by server.ts in production: no SvelteKit imports here.

export type GitHubReason = 'needs-reconnect' | 'needs-access' | 'conflict' | 'retry';

const TIMEOUT_MS = 30_000;
const TOKEN_RE = /\b(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g;

export class GitHubError extends Error {
	readonly status: number; // HTTP status; 0 for network errors
	readonly reason: GitHubReason;
	/** GitHub's own message (tokens masked), for telling refusals apart (branch protection) */
	readonly said: string;
	constructor(status: number, reason: GitHubReason, message: string, said = '') {
		super(message);
		this.name = 'GitHubError';
		this.status = status;
		this.reason = reason;
		this.said = said;
	}
}

/** 401 → reconnect; 403/404 and a redirect (a renamed or transferred repository, answered to a write) → access (a
 *  403 that is a rate limit → retry); 409/422 → conflict; 429, 5xx and the network → retry. Other 4xx count as
 *  conflicts: retried with backoff, never silently dropped. */
export function reasonFor(status: number, rateLimited = false): GitHubReason {
	if (status === 401) return 'needs-reconnect';
	if (status === 403 && !rateLimited) return 'needs-access';
	if (status === 404 || status === 301 || status === 307 || status === 308) return 'needs-access';
	if (status === 429 || status === 403 || status === 0 || status >= 500) return 'retry';
	return 'conflict';
}

const MESSAGES: Record<GitHubReason, string> = {
	'needs-reconnect': 'GitHub no longer accepts this GitHub connection. Reconnect GitHub.',
	'needs-access': 'GitHub refused access to the repository or branch: it may have been removed, renamed away, or the App lost access.',
	conflict: 'GitHub refused the change.',
	retry: 'GitHub could not be reached or had a temporary problem; Overtree retries.'
};

/** GitHub's own message, without anything that looks like a token, cut short. */
const clean = (m: unknown) => (typeof m === 'string' ? m.replace(TOKEN_RE, '[token]').slice(0, 200) : '');

export function githubError(status: number, githubMessage?: unknown, rateLimited = false): GitHubError {
	const reason = reasonFor(status, rateLimited);
	const said = clean(githubMessage);
	const code = status ? ` (${status})` : '';
	return new GitHubError(status, reason, `${MESSAGES[reason]}${said ? ` GitHub said: ${said}` : ''}${code}`, said);
}

/** Any error from fetch or @octokit as a GitHubError (network failures: status 0, `retry`). */
export function toGitHubError(e: unknown): GitHubError {
	if (e instanceof GitHubError) return e;
	const err = e as { status?: number; response?: { data?: { message?: string; error_description?: string } } };
	if (typeof err?.status === 'number' && err.status > 0) {
		const data = err.response?.data;
		return githubError(err.status, data?.message ?? data?.error_description);
	}
	return githubError(0);
}

function config(): GitHubConfig {
	const c = githubConfig();
	if (!c) throw new Error('GitHub sync is not configured');
	return c;
}

/** One REST call with `token` (user or installation); JSON in and out, null for an empty body. GETs follow GitHub's
 *  redirect for a renamed or transferred repository; writes don't (fetch would resend a POST as a GET): they fail
 *  as `needs-access` and the sync looks the repository up again by id (sync.ts). */
export async function gh<T = any>(token: string, method: string, path: string, body?: unknown): Promise<T> {
	let res: Response;
	try {
		res = await fetch(config().apiUrl + path, {
			method,
			headers: {
				accept: 'application/vnd.github+json',
				authorization: `Bearer ${token}`,
				'x-github-api-version': '2022-11-28',
				'user-agent': 'overtree',
				...(body === undefined ? {} : { 'content-type': 'application/json' })
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			redirect: method === 'GET' ? 'follow' : 'manual',
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch {
		throw githubError(0);
	}
	const text = await res.text();
	let data: any = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = null;
	}
	if (!res.ok) throw githubError(res.status, data?.message, res.headers.get('x-ratelimit-remaining') === '0');
	return data as T;
}

// --- tokens (research R3) -------------------------------------------------------------------------------------------

type Auth = ReturnType<typeof createAppAuth>;
// one auth-app instance per configuration: it caches installation tokens (1 h) in memory
let app: { key: string; auth: Auth; req: typeof request } | null = null;
function appAuth() {
	const c = config();
	const key = `${c.appId}\n${c.apiUrl}\n${c.clientId}\n${c.privateKey}`;
	if (app?.key !== key) {
		// OAuth endpoints are derived from baseUrl by @octokit/oauth-methods (github.com, or GHES without /api/v3)
		const req = request.defaults({ baseUrl: c.apiUrl, headers: { 'user-agent': 'overtree' } });
		app = { key, req, auth: createAppAuth({ appId: c.appId, privateKey: c.privateKey, clientId: c.clientId, clientSecret: c.clientSecret, request: req }) };
	}
	return app;
}

/** An installation access token (minted from the App key, cached by @octokit/auth-app until near expiry). */
export async function installationToken(installationId: number): Promise<string> {
	try {
		const { token } = await appAuth().auth({ type: 'installation', installationId });
		return token;
	} catch (e) {
		throw toGitHubError(e);
	}
}

export type UserTokens = { token: string; expiresAt: number; refreshToken: string; refreshExpiresAt: number };

// Apps with expiring user tokens switched off return neither expiry nor refresh token
const FAR = 100 * 365 * 24 * 3600_000;
const tokens = (a: { token: string; expiresAt?: string; refreshToken?: string; refreshTokenExpiresAt?: string }): UserTokens => ({
	token: a.token,
	expiresAt: a.expiresAt ? Date.parse(a.expiresAt) : Date.now() + FAR,
	refreshToken: a.refreshToken ?? '',
	refreshExpiresAt: a.refreshTokenExpiresAt ? Date.parse(a.refreshTokenExpiresAt) : Date.now() + FAR
});

/** The user-to-server tokens for an OAuth callback `code`; a bad or used code → `needs-reconnect`. */
export async function exchangeCode(code: string): Promise<UserTokens> {
	try {
		return tokens((await appAuth().auth({ type: 'oauth-user', code })) as Parameters<typeof tokens>[0]);
	} catch (e) {
		const err = toGitHubError(e);
		throw err.status === 400 ? githubError(401, 'The authorization code was refused.') : err;
	}
}

/** New tokens for refresh token `refresh` (GitHub rotates it); refused → `needs-reconnect`. */
export async function refreshUserToken(refresh: string): Promise<UserTokens> {
	const c = config();
	if (!refresh) throw githubError(401);
	const auth = createOAuthUserAuth({
		clientType: 'github-app',
		clientId: c.clientId,
		clientSecret: c.clientSecret,
		request: appAuth().req,
		// a placeholder access token marked expired: only the refresh token matters for `refresh`
		token: 'expired',
		refreshToken: refresh,
		expiresAt: new Date(0).toISOString(),
		refreshTokenExpiresAt: new Date(Date.now() + FAR).toISOString()
	});
	try {
		return tokens((await auth({ type: 'refresh' })) as Parameters<typeof tokens>[0]);
	} catch (e) {
		const err = toGitHubError(e);
		throw err.status === 400 ? githubError(401, 'The refresh token was refused.') : err;
	}
}
