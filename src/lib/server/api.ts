import { error } from '@sveltejs/kit';
import { requireUser } from './access.ts';
import type { User } from './auth.ts';
import { FileError } from './files.ts';
import { GitHubError, type GitHubReason } from './github/api.ts';
import { githubConfig } from './github/config.ts';

// GitHub failures as HTTP (012 contracts/http-api.md): a dead connection is a 409 with `reconnect`, a repository or
// branch out of reach a 422, GitHub refusing a change a 409, GitHub down a 502.
const GITHUB_STATUS: Record<GitHubReason, number> = { 'needs-reconnect': 409, 'needs-access': 422, conflict: 409, retry: 502 };

/** Runs a file-service call in a route, turning its FileError (or GitHubError) into SvelteKit's `error()`
 *  (`{ message }` + status). Async calls work too: the returned promise rejects with the converted error. */
export function api<T>(fn: () => T): T {
	const convert = (e: unknown): never => {
		if (e instanceof FileError) error(e.status, { message: e.message, ...(e.existingId && { existingId: e.existingId }) });
		if (e instanceof GitHubError) error(GITHUB_STATUS[e.reason], { message: e.message, ...(e.reason === 'needs-reconnect' && { reconnect: true }) });
		throw e;
	};
	try {
		const r = fn();
		return (r instanceof Promise ? r.catch(convert) : r) as T;
	} catch (e) {
		return convert(e);
	}
}

/** 404 unless GitHub sync is configured (FR-004): call after the auth guard. */
export function requireGitHub() {
	if (!githubConfig()) throw new FileError(404, 'Not found.');
}

/** Guard for the per-user GitHub routes: 401 signed out, then 404 when GitHub sync isn't configured. */
export function requireGitHubUser(locals: { user?: User | null }): User {
	const user = requireUser(locals);
	requireGitHub();
	return user;
}

// RFC 5987 (`filename*=UTF-8''…`): encodeURIComponent leaves ' ( ) * as they are
export const attrChars = (s: string) => encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
