import { and, eq, gt, isNotNull } from 'drizzle-orm';
import type { GitHubLinkInfo, GitHubState, GitHubStatus, MergeNote } from '../../github-types.ts';
import { broadcast, canEdit, projectRole } from '../access.ts';
import { getServer } from '../collab.ts';
import { fail } from '../files.ts';
import { flushHistory } from '../history.ts';
import { githubLinks, githubRuns, historyLog, users } from '../schema.ts';
import { branchExists, branchPath, findRepo, type Link } from './accounts.ts';
import { gh, GitHubError, installationToken } from './api.ts';
import { githubConfig } from './config.ts';
import { DEFAULT_IGNORE, ignoreFilter, projectFiles, writeBase, type BaseMap } from './paths.ts';
import { isSyncing, requestSync } from './sync.ts';

// A project's repository link (012 FR-005–010, data-model "github_links", research R7, R12): status for members,
// link/patch/unlink/confirm for the owner. Route guards check the role; these check the link's own rules.
// Loaded unbundled by server.ts in production: no SvelteKit imports here.

const db = () => getServer().db;
const IGNORE_MAX = 50;
const PATTERN_MAX = 200;
const CONFIRM_WAIT_MS = 60_000;

export const getLink = (pid: string): Link | null => db().select().from(githubLinks).where(eq(githubLinks.projectId, pid)).get() ?? null;

function need(pid: string): Link {
	const link = getLink(pid);
	if (!link) fail(404, 'This project isn’t linked to a GitHub repository.');
	return link!;
}

const changed = (pid: string) => broadcast(pid, { type: 'github' });

/** Edits by people (not pulls, which log as the system) since GitHub last got the project, or a pull result that
 *  differs from GitHub's head (data-model "Derived values"). */
export function hasUnpushed(link: Pick<Link, 'projectId' | 'watermark' | 'pendingPush'>): boolean {
	if (link.pendingPush) return true;
	flushHistory();
	return !!db()
		.select({ id: historyLog.id })
		.from(historyLog)
		.where(and(eq(historyLog.projectId, link.projectId), gt(historyLog.id, link.watermark), isNotNull(historyLog.userId)))
		.limit(1)
		.get();
}

/** What the top bar shows (FR-025, data-model "Display state"). */
export function displayState(link: Link): GitHubState {
	if (isSyncing(link.projectId)) return 'syncing';
	switch (link.status) {
		case 'failing':
			return 'failed';
		case 'needs-reconnect':
		case 'needs-access':
		case 'owner-changed':
		case 'pending':
			return link.status;
		default:
			return hasUnpushed(link) ? 'unpushed' : 'in-sync';
	}
}

/** `GET /api/projects/:pid/github` for a member (contracts GitHubStatus); `ignore` only for the owner. */
export function getStatus(pid: string, userId: string): GitHubStatus {
	const role = projectRole(pid, userId);
	const link = getLink(pid);
	const owner = role === 'owner';
	if (!link) return { configured: true, link: null, canManage: owner, canSync: false };
	const web = githubConfig()?.webUrl ?? 'https://github.com';
	const linker = link.userId ? db().select({ id: users.id, name: users.name }).from(users).where(eq(users.id, link.userId)).get() : undefined;
	const info: GitHubLinkInfo = {
		repo: link.repo,
		branch: link.branch,
		url: `${web}/${link.repo}/tree/${branchPath(link.branch)}`,
		state: displayState(link),
		error: link.error,
		nextAttemptAt: link.nextAttemptAt,
		lastCommit: link.baseCommit
			? {
					sha: link.baseCommit,
					url: `${web}/${link.repo}/commit/${link.baseCommit}`,
					at: Math.max(link.lastPushAt ?? 0, link.lastPullAt ?? 0) || link.updatedAt
				}
			: null,
		lastPushAt: link.lastPushAt,
		lastPullAt: link.lastPullAt,
		note: link.note ? (JSON.parse(link.note) as MergeNote) : null,
		...(owner ? { ignore: JSON.parse(link.ignore) as string[] } : {}),
		linkedBy: linker ?? { id: link.userId ?? '', name: 'Unknown' }
	};
	return {
		configured: true,
		link: info,
		canManage: owner,
		canSync: canEdit(role) && (link.status === 'active' || link.status === 'failing')
	};
}

/** `ignore` as given: trimmed, blank lines dropped, ≤ 50 patterns of ≤ 200 characters (422 otherwise). */
export function normalizeIgnore(ignore: unknown): string[] {
	if (!Array.isArray(ignore) || ignore.some((p) => typeof p !== 'string')) fail(422, 'The patterns must be a list of strings.');
	const list = (ignore as string[]).map((p) => p.trim()).filter(Boolean);
	if (list.length > IGNORE_MAX) fail(422, `At most ${IGNORE_MAX} patterns.`);
	if (list.some((p) => p.length > PATTERN_MAX)) fail(422, `A pattern can have at most ${PATTERN_MAX} characters.`);
	return [...new Set(list)];
}

/** A plausible git branch name (GitHub has the final word). */
function normalizeBranch(branch: unknown): string {
	const b = typeof branch === 'string' ? branch.trim() : '';
	if (!b || b.length > 255 || /[\s~^:?*[\\\x00-\x1f\x7f]|\.\.|\/\/|^[/.-]|[/.]$|\.lock$|@\{/.test(b)) fail(422, 'Enter a valid branch name.');
	return b;
}

const positiveInt = (v: unknown, what: string) => {
	if (!Number.isSafeInteger(v) || (v as number) <= 0) fail(422, `Invalid ${what}.`);
	return v as number;
};

// the next sync after any of these is a first sync again (contracts PUT)
const reset = {
	status: 'pending' as const,
	baseCommit: null,
	baseFiles: null,
	watermark: 0,
	pendingPush: false,
	failCount: 0,
	nextAttemptAt: null,
	error: null,
	note: null
};

/** Links project `pid` to a repository through the owner's connection (FR-005–007, contracts PUT): the repository
 *  must be in that installation with push permission (R2) and the branch must exist (422 otherwise). Creates or
 *  replaces the link as `pending` with no base. */
export async function linkRepo(
	pid: string,
	ownerId: string,
	body: {
		installationId?: unknown;
		repoId?: unknown;
		branch?: unknown;
		ignore?: unknown;
	}
) {
	const installationId = positiveInt(body.installationId, 'installation');
	const repoId = positiveInt(body.repoId, 'repository');
	const branch = normalizeBranch(body.branch);
	const ignore = body.ignore === undefined ? DEFAULT_IGNORE : normalizeIgnore(body.ignore);
	const repo = await findRepo(ownerId, installationId, repoId);
	if (!repo) fail(422, 'Your GitHub connection can’t push to that repository. Grant Overtree access to it on GitHub.');
	if (!(await branchExists(ownerId, repo!.full_name, branch))) fail(422, `The branch “${branch}” doesn’t exist in ${repo!.full_name}.`);
	const now = Date.now();
	const row = {
		userId: ownerId,
		installationId,
		repoId,
		repo: repo!.full_name,
		branch,
		ignore: JSON.stringify(ignore),
		lastPushAt: null,
		lastPullAt: null,
		lastCheckAt: now,
		updatedAt: now,
		...reset
	};
	db().transaction((tx) => {
		tx.delete(githubRuns).where(eq(githubRuns.projectId, pid)).run();
		tx.insert(githubLinks)
			.values({ projectId: pid, ...row, createdAt: now })
			.onConflictDoUpdate({ target: githubLinks.projectId, set: row })
			.run();
	});
	changed(pid);
}

/** `PATCH`: new "not pulled" patterns, another branch (back to `pending`, base reset) and/or dismissing the merge
 *  note. `confirmOwner` is Phase 6 (T041). */
export async function patchLink(pid: string, ownerId: string, body: { ignore?: unknown; branch?: unknown; dismissNote?: unknown }) {
	const link = need(pid);
	const set: Partial<Link> = {};
	if (body.ignore !== undefined) set.ignore = JSON.stringify(normalizeIgnore(body.ignore));
	if (body.branch !== undefined) {
		const branch = normalizeBranch(body.branch);
		if (branch !== link.branch) {
			if (!(await branchExists(ownerId, link.repo, branch))) fail(422, `The branch “${branch}” doesn’t exist in ${link.repo}.`);
			Object.assign(set, { branch, userId: ownerId }, reset);
		}
	}
	if (body.dismissNote === true) set.note = null;
	if (!Object.keys(set).length) return;
	db()
		.update(githubLinks)
		.set({ ...set, updatedAt: Date.now() })
		.where(eq(githubLinks.projectId, pid))
		.run();
	changed(pid);
}

/** Unlinks (FR-010): the link and its run log go; nothing on GitHub or in the project changes. */
export function unlink(pid: string) {
	need(pid);
	db().transaction((tx) => {
		tx.delete(githubRuns).where(eq(githubRuns.projectId, pid)).run();
		tx.delete(githubLinks).where(eq(githubLinks.projectId, pid)).run();
	});
	changed(pid);
}

const repoPath = (repo: string) => repo.split('/').map(encodeURIComponent).join('/');

/** The branch's head commit, or null for an empty repository or a branch that doesn't exist (yet). */
async function headCommit(token: string, repo: string, branch: string): Promise<string | null> {
	try {
		const ref = await gh<{ object: { sha: string } }>(token, 'GET', `/repos/${repoPath(repo)}/git/ref/heads/${branchPath(branch)}`);
		return ref.object.sha;
	} catch (e) {
		if (e instanceof GitHubError && (e.status === 404 || e.status === 409)) return null;
		throw e;
	}
}

/** The first-sync base (T020): GitHub's head with its tree entries (SHA only, no `hash`: no base text yet) restricted
 *  to non-ignored paths that also exist in the project. Diffing against it, project files win where both exist,
 *  GitHub-only files are pulled and identical files stay untouched (FR-008). */
async function firstBase(link: Link): Promise<{ head: string | null; base: BaseMap }> {
	const token = await installationToken(link.installationId);
	const head = await headCommit(token, link.repo, link.branch);
	const base: BaseMap = {};
	if (!head) return { head, base };
	const commit = await gh<{ tree: { sha: string } }>(token, 'GET', `/repos/${repoPath(link.repo)}/git/commits/${head}`);
	// ponytail: a truncated tree (over 100 000 entries) is not handled
	const tree = await gh<{
		tree: { path: string; type: string; sha: string }[];
	}>(token, 'GET', `/repos/${repoPath(link.repo)}/git/trees/${commit.tree.sha}?recursive=1`);
	const blobs = tree.tree.filter((e) => e.type === 'blob');
	const project = projectFiles(link.projectId);
	const ignored = ignoreFilter(JSON.parse(link.ignore) as string[], [...blobs.map((e) => e.path), ...project.keys()]);
	for (const e of blobs) if (!ignored(e.path) && project.has(e.path)) base[e.path] = { sha: e.sha };
	return { head, base };
}

/** `POST …/github/confirm` with `merge` (T020; `import` is Phase 7): sets the first-sync base, makes the link
 *  `active` and requests the first pull and push (trigger `link`), waiting up to 60 s for them. A GitHub failure
 *  keeps the link `pending` with the reason in `error`. */
export async function confirmLink(pid: string, mode: unknown) {
	const link = need(pid);
	if (mode !== 'merge') fail(422, 'Unknown mode.');
	if (link.status !== 'pending') fail(409, 'The link is already set up.');
	let first: Awaited<ReturnType<typeof firstBase>>;
	try {
		first = await firstBase(link);
	} catch (e) {
		if (e instanceof GitHubError) {
			db().update(githubLinks).set({ error: e.message, updatedAt: Date.now() }).where(eq(githubLinks.projectId, pid)).run();
			changed(pid);
		}
		throw e;
	}
	db()
		.update(githubLinks)
		.set({
			status: 'active',
			baseCommit: first.head,
			baseFiles: writeBase(first.base),
			error: null,
			failCount: 0,
			nextAttemptAt: null,
			updatedAt: Date.now()
		})
		.where(eq(githubLinks.projectId, pid))
		.run();
	changed(pid);
	let timer: NodeJS.Timeout | undefined;
	await Promise.race([
		(async () => {
			await requestSync(pid, { kind: 'pull', trigger: 'link' });
			await requestSync(pid, { kind: 'push', trigger: 'link' });
		})(),
		new Promise((r) => (timer = setTimeout(r, CONFIRM_WAIT_MS)))
	]).finally(() => clearTimeout(timer));
}
