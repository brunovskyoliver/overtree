import { and, eq, ne } from 'drizzle-orm';
import type { GitHubBranches, GitHubRepos } from '../../github-types.ts';
import { broadcast } from '../access.ts';
import { getServer } from '../collab.ts';
import { githubAccounts, githubLinks } from '../schema.ts';
import { gh, githubError, GitHubError, refreshUserToken, type UserTokens } from './api.ts';
import { githubConfig } from './config.ts';
import { open, seal } from './crypto.ts';

// GitHub connections of Overtree users (012 FR-001–003, research R2, R10): sealed user-to-server tokens, the
// repositories a user may link, and the "is the linker still allowed" check. Clerk sign-in is untouched.
// Loaded unbundled by server.ts in production: no SvelteKit imports here.

const db = () => getServer().db;
const REFRESH_EARLY_MS = 5 * 60_000;
const PAGE = 100;
const MAX_PAGES = 10; // ponytail: 1000 installations or repositories per installation are listed, no more

// refreshes in flight per user, shared by server.ts' copy and the bundled routes' copy: GitHub rotates the refresh
// token, so a second concurrent refresh with the old one would fail
const shared = (globalThis.__overtreeGitHub ??= {
	refreshing: new Map(),
	sync: new Map()
});

export type Account = typeof githubAccounts.$inferSelect;
export type Link = typeof githubLinks.$inferSelect;
export type AccessCheck = 'ok' | 'needs-reconnect' | 'needs-access';

export const getAccount = (userId: string): Account | null =>
	db().select().from(githubAccounts).where(eq(githubAccounts.userId, userId)).get() ?? null;

/** Stores (or replaces) the user's connection with freshly obtained tokens. */
export function saveAccount(userId: string, t: UserTokens, ghUser: { id: number; login: string }) {
	const now = Date.now();
	const row = {
		githubId: ghUser.id,
		login: ghUser.login,
		accessToken: seal(t.token),
		accessExpiresAt: t.expiresAt,
		refreshToken: seal(t.refreshToken),
		refreshExpiresAt: t.refreshExpiresAt,
		updatedAt: now
	};
	db()
		.insert(githubAccounts)
		.values({ userId, ...row, createdAt: now })
		.onConflictDoUpdate({ target: githubAccounts.userId, set: row })
		.run();
}

const RECONNECT = 'The GitHub connection of the person who linked this project is gone. They need to reconnect GitHub.';

/** Removes the user's connection (FR-010: nothing on GitHub changes); links it authorized → `needs-reconnect`, except
 *  links waiting for a new owner (`owner-changed` stays until they take it over). */
export function disconnect(userId: string) {
	const d = db();
	const theirs = and(eq(githubLinks.userId, userId), ne(githubLinks.status, 'owner-changed'));
	const pids = d
		.select({ pid: githubLinks.projectId })
		.from(githubLinks)
		.where(theirs)
		.all()
		.map((r) => r.pid);
	d.transaction((tx) => {
		tx.update(githubLinks)
			.set({
				status: 'needs-reconnect',
				error: RECONNECT,
				nextAttemptAt: null,
				updatedAt: Date.now()
			})
			.where(theirs)
			.run();
		tx.delete(githubAccounts).where(eq(githubAccounts.userId, userId)).run();
	});
	for (const pid of pids) broadcast(pid, { type: 'github' });
}

/** A usable user-to-server token, refreshed when it expires within 5 minutes. No connection, a dead refresh token
 *  or a sealed token that no longer opens (App key rotated, R10) → `needs-reconnect`; the row is kept. */
export async function userToken(userId: string): Promise<string> {
	const acc = getAccount(userId);
	if (!acc) throw githubError(401, 'No GitHub connection.');
	if (acc.accessExpiresAt - Date.now() > REFRESH_EARLY_MS) {
		try {
			return open(acc.accessToken);
		} catch {
			throw githubError(401, 'The stored GitHub connection can no longer be read.');
		}
	}
	let running = shared.refreshing.get(userId);
	if (!running) {
		running = (async () => {
			if (acc.refreshExpiresAt <= Date.now()) throw githubError(401, 'The GitHub connection expired.');
			let refresh: string;
			try {
				refresh = open(acc.refreshToken);
			} catch {
				throw githubError(401, 'The stored GitHub connection can no longer be read.');
			}
			const t = await refreshUserToken(refresh);
			const now = Date.now();
			db()
				.update(githubAccounts)
				.set({
					accessToken: seal(t.token),
					accessExpiresAt: t.expiresAt,
					refreshToken: seal(t.refreshToken),
					refreshExpiresAt: t.refreshExpiresAt,
					updatedAt: now
				})
				.where(eq(githubAccounts.userId, userId))
				.run();
			return t.token;
		})().finally(() => shared.refreshing.delete(userId));
		shared.refreshing.set(userId, running);
	}
	return running;
}

/** Every page of a list endpoint (`key`: the array in GitHub's wrapper object). */
async function pages<T>(token: string, path: string, key: string): Promise<T[]> {
	const out: T[] = [];
	for (let page = 1; page <= MAX_PAGES; page++) {
		const sep = path.includes('?') ? '&' : '?';
		const data = await gh<Record<string, T[]>>(token, 'GET', `${path}${sep}per_page=${PAGE}&page=${page}`);
		const items = data?.[key] ?? [];
		out.push(...items);
		if (items.length < PAGE) break;
	}
	return out;
}

type GhAccount = {
	login: string;
	type: 'User' | 'Organization';
	avatar_url: string;
};
type GhRepo = {
	id: number;
	full_name: string;
	default_branch: string;
	private: boolean;
	permissions?: { push?: boolean };
};

/** The repositories of one installation the user can push to (GitHub only lists those both cover). */
async function installationRepos(token: string, installationId: number) {
	const repos = await pages<GhRepo>(token, `/user/installations/${installationId}/repositories`, 'repositories');
	return repos.filter((r) => r.permissions?.push);
}

/** Repositories the user's connection may link (FR-006, contracts "GET /api/github/repos"): those of the App's
 *  installations the user can see, with push permission, grouped by installation account. */
export async function listRepos(userId: string): Promise<GitHubRepos> {
	const token = await userToken(userId);
	const installs = await pages<{ id: number; account: GhAccount }>(token, '/user/installations', 'installations');
	const accounts = await Promise.all(
		installs.map(async (i) => ({
			login: i.account.login,
			type: i.account.type,
			avatarUrl: i.account.avatar_url,
			installationId: i.id,
			repos: (await installationRepos(token, i.id))
				.map((r) => ({
					id: r.id,
					fullName: r.full_name,
					defaultBranch: r.default_branch,
					private: r.private
				}))
				.sort((a, b) => a.fullName.localeCompare(b.fullName))
		}))
	);
	return { accounts };
}

/** The repository `repoId` as the user sees it through installation `installationId`, or null when it isn't in
 *  that installation or the user can't push to it. */
export async function findRepo(userId: string, installationId: number, repoId: number) {
	const token = await userToken(userId);
	return (await installationRepos(token, installationId)).find((r) => r.id === repoId) ?? null;
}

const seg = (s: string) => encodeURIComponent(s);
export const branchPath = (branch: string) => branch.split('/').map(seg).join('/');

/** `owner/name` as a URL path. */
export const repoPath = (repo: string) => repo.split('/').map(seg).join('/');

/** The branch's head commit (`head` null: the branch doesn't exist; `empty`: the repository has no commits, where
 *  GitHub refuses every Git Data call with 409 "Git Repository is empty."). */
export async function branchHead(token: string, repo: string, branch: string): Promise<{ head: string | null; empty: boolean }> {
	try {
		const ref = await gh<{ object: { sha: string } }>(token, 'GET', `/repos/${repoPath(repo)}/git/ref/heads/${branchPath(branch)}`);
		return { head: ref.object.sha, empty: false };
	} catch (e) {
		if (e instanceof GitHubError && e.status === 404) return { head: null, empty: false };
		if (e instanceof GitHubError && e.status === 409) return { head: null, empty: true };
		throw e;
	}
}

/** The first 100 branches of `owner/repo` and its default branch (an empty repository has none). */
export async function branches(userId: string, owner: string, repo: string): Promise<GitHubBranches> {
	const token = await userToken(userId);
	const r = await gh<GhRepo>(token, 'GET', `/repos/${seg(owner)}/${seg(repo)}`);
	const list = await gh<{ name: string }[]>(token, 'GET', `/repos/${seg(owner)}/${seg(repo)}/branches?per_page=${PAGE}`);
	return {
		branches: (list ?? []).map((b) => b.name),
		defaultBranch: r.default_branch
	};
}

/** Whether `branch` exists in `fullName` (`owner/repo`), checked with the user's token. An empty repository has no
 *  branches yet: any branch is fine there (the first push creates it). */
export async function branchExists(userId: string, fullName: string, branch: string): Promise<boolean> {
	const token = await userToken(userId);
	try {
		await gh(token, 'GET', `/repos/${fullName.split('/').map(seg).join('/')}/git/ref/heads/${branchPath(branch)}`);
		return true;
	} catch (e) {
		if (!(e instanceof GitHubError)) throw e;
		if (e.status === 409) return true; // "Git Repository is empty."
		if (e.status === 404) return false;
		throw e;
	}
}

/** Is the link's linker still allowed (research R2)? `GET /repositories/:id` with their user token: follows renames
 *  and transfers (stored in `repo`), sets `last_check_at`. A dead connection → `needs-reconnect`; repo gone, out of
 *  the App's reach or no push permission → `needs-access`. Temporary failures throw (GitHubError `retry`). */
export async function checkAccess(link: Pick<Link, 'projectId' | 'userId' | 'repoId' | 'repo'>): Promise<AccessCheck> {
	const done = (result: AccessCheck, repo?: string) => {
		db()
			.update(githubLinks)
			.set({
				lastCheckAt: Date.now(),
				...(repo && repo !== link.repo ? { repo } : {})
			})
			.where(eq(githubLinks.projectId, link.projectId))
			.run();
		return result;
	};
	if (!link.userId || !githubConfig()) return done('needs-reconnect');
	try {
		const token = await userToken(link.userId);
		const r = await gh<GhRepo>(token, 'GET', `/repositories/${link.repoId}`);
		return done(r.permissions?.push ? 'ok' : 'needs-access', r.full_name);
	} catch (e) {
		if (e instanceof GitHubError && (e.reason === 'needs-reconnect' || e.reason === 'needs-access')) return done(e.reason);
		throw e;
	}
}

/** The `needs-access` reason when the linked branch is gone: the popover offers "Create branch" for it (T040). */
export const branchGone = (branch: string) => `The branch “${branch}” no longer exists on GitHub.`;

/** A link that may come back by checking access again: `needs-reconnect`, or `needs-access` other than a missing
 *  branch (that one has "Create branch"). */
export const recheckable = (l: Pick<Link, 'status' | 'error' | 'branch'>) =>
	l.status === 'needs-reconnect' || (l.status === 'needs-access' && l.error !== branchGone(l.branch));

const ACCESS_ERROR = 'GitHub refused access to the linked repository.';

/** Checks a paused link's access again (research R12): ok → `active` with its base, watermark and `pending_push` kept
 *  (`pending` when it was never confirmed), so the next sync merges what changed meanwhile instead of starting over;
 *  otherwise the matching `needs-*` status. Returns the status now, or null when GitHub was unreachable or the link
 *  changed meanwhile (it stays as it is). */
export async function recheckLink(link: Link): Promise<Link['status'] | null> {
	let result: AccessCheck;
	try {
		result = await checkAccess(link);
	} catch {
		return null;
	}
	const status = result === 'ok' ? (link.baseFiles === null ? 'pending' : 'active') : result;
	if (status === link.status) return status;
	const error = result === 'ok' ? null : result === 'needs-access' ? ACCESS_ERROR : RECONNECT;
	const res = db()
		.update(githubLinks)
		.set({ status, error, failCount: 0, nextAttemptAt: null, updatedAt: Date.now() })
		.where(and(eq(githubLinks.projectId, link.projectId), eq(githubLinks.status, link.status), eq(githubLinks.userId, link.userId ?? '')))
		.run();
	if (!res.changes) return null;
	broadcast(link.projectId, { type: 'github' });
	return status;
}

/** After the user (re)connects or comes back from granting the App access: their `needs-reconnect` and `needs-access`
 *  links (not a missing branch) are checked again (R12). Returns the projects whose link is `active` again (the caller
 *  asks for a catch-up sync); a link that was never confirmed goes back to `pending`. */
export async function recheckLinks(userId: string): Promise<string[]> {
	const links = db().select().from(githubLinks).where(eq(githubLinks.userId, userId)).all();
	const resumed: string[] = [];
	for (const link of links.filter(recheckable)) if ((await recheckLink(link)) === 'active') resumed.push(link.projectId);
	return resumed;
}
