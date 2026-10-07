import { desc, eq } from 'drizzle-orm';
import type { GitHubLinkInfo, GitHubRun, GitHubState, GitHubStatus, GitHubSyncResult, MergeNote } from '../../github-types.ts';
import { broadcast, canEdit, projectRole } from '../access.ts';
import { getServer } from '../collab.ts';
import { fail } from '../files.ts';
import { githubLinks, githubRuns, users } from '../schema.ts';
import { branchExists, branchHead, branchPath, checkAccess, findRepo, getAccount, repoPath, type Link } from './accounts.ts';
import { gh, GitHubError, installationToken } from './api.ts';
import { githubConfig } from './config.ts';
import { DEFAULT_IGNORE, ignoreFilter, projectFiles, writeBase, type BaseMap } from './paths.ts';
import { branchGone } from './pull.ts';
import { TITLE_MAX } from './push.ts';
import { hasUnpushed, isSyncing, requestSync, type SyncKind } from './sync.ts';

// A project's repository link (012 FR-005–010, data-model "github_links", research R7, R12): status for members,
// link/patch/unlink/confirm for the owner. Route guards check the role; these check the link's own rules.
// Loaded unbundled by server.ts in production: no SvelteKit imports here.

const db = () => getServer().db;
const IGNORE_MAX = 50;
const PATTERN_MAX = 200;
const CONFIRM_WAIT_MS = 60_000;
const SYNC_WAIT_MS = 30_000; // manual push/pull and create-branch answer 202 after this
const RUNS_SHOWN = 20;

export const getLink = (pid: string): Link | null => db().select().from(githubLinks).where(eq(githubLinks.projectId, pid)).get() ?? null;

function need(pid: string): Link {
	const link = getLink(pid);
	if (!link) fail(404, 'This project isn’t linked to a GitHub repository.');
	return link!;
}

const changed = (pid: string) => broadcast(pid, { type: 'github' });

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
		branchMissing: link.status === 'needs-access' && link.error === branchGone(link.branch),
		...(owner ? { ignore: JSON.parse(link.ignore) as string[] } : {}),
		linkedBy: linker ?? { id: link.userId ?? '', name: 'Unknown' }
	};
	return {
		configured: true,
		link: info,
		canManage: owner,
		canSync: canEdit(role) && (link.status === 'active' || link.status === 'failing'),
		runs: recentRuns(pid)
	};
}

/** The last 20 sync runs, newest first, with the name of whoever asked for a manual one (US4, contracts `runs`). */
function recentRuns(pid: string): GitHubRun[] {
	return db()
		.select({
			kind: githubRuns.kind,
			trigger: githubRuns.trigger,
			result: githubRuns.result,
			commit: githubRuns.commit,
			error: githubRuns.error,
			at: githubRuns.finishedAt,
			name: users.name
		})
		.from(githubRuns)
		.leftJoin(users, eq(users.id, githubRuns.userId))
		.where(eq(githubRuns.projectId, pid))
		.orderBy(desc(githubRuns.id))
		.limit(RUNS_SHOWN)
		.all()
		.map(({ name, ...r }) => ({ ...r, user: name === null ? null : { name } }));
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
	note: null,
	lastPullAt: null // the first pull after confirming diffs the whole tree (pull.ts)
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

/** `PATCH`: new "not pulled" patterns, another branch (back to `pending`, base reset), dismissing the merge note
 *  and/or, after an ownership transfer, the new owner taking the link over (`confirmOwner`, FR-027). */
export async function patchLink(pid: string, ownerId: string, body: { ignore?: unknown; branch?: unknown; dismissNote?: unknown; confirmOwner?: unknown }) {
	const link = need(pid);
	const set: Partial<Link> = {};
	if (body.confirmOwner === true) Object.assign(set, await takeOver(link, ownerId));
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
	// taken over: catch up with what waited during the pause (a push pulls first)
	if (set.status === 'active') void requestSync(pid, { kind: hasUnpushed(getLink(pid)!) ? 'push' : 'pull', trigger: 'manual', userId: ownerId });
}

/** The new owner takes an `owner-changed` link over (research R12, FR-027): it syncs through their connection from
 *  now on, after checking that connection can push to the repository (409 otherwise). */
async function takeOver(link: Link, ownerId: string): Promise<Partial<Link>> {
	if (link.status !== 'owner-changed') fail(409, 'The link doesn’t need to be taken over.');
	if (!getAccount(ownerId)) fail(409, 'Connect GitHub first: the link syncs through your GitHub connection.');
	const access = await checkAccess({ ...link, userId: ownerId });
	if (access === 'needs-reconnect') fail(409, 'Your GitHub connection stopped working. Reconnect GitHub, then take over the link.');
	if (access === 'needs-access') fail(409, `Your GitHub connection can’t push to ${link.repo}. Grant Overtree access to it on GitHub, then take over the link.`);
	return {
		userId: ownerId,
		status: link.baseFiles === null ? 'pending' : 'active',
		error: null,
		failCount: 0,
		nextAttemptAt: null
	};
}

/** Waits up to 30 s for `run`: its result, or null when it is still going (the route answers 202). */
async function waitFor<T>(run: Promise<T>): Promise<T | null> {
	let timer: NodeJS.Timeout | undefined;
	return Promise.race([run, new Promise<null>((r) => (timer = setTimeout(() => r(null), SYNC_WAIT_MS)))]).finally(() => clearTimeout(timer));
}

/** `POST …/github/push|pull` (owner or editor, checked by the route; FR-026): a manual run, a push with an optional
 *  commit title of at most 72 characters after trimming (422 above). 409 unless the link is active (or retrying).
 *  Resolves with the run's result, or null when it takes longer than 30 s. */
export async function manualSync(pid: string, userId: string, kind: SyncKind, body: { title?: unknown }): Promise<GitHubSyncResult | null> {
	let title: string | undefined;
	if (kind === 'push' && body.title !== undefined && body.title !== null) {
		if (typeof body.title !== 'string') fail(422, 'The commit title must be text.');
		title = (body.title as string).trim() || undefined;
		if (title && title.length > TITLE_MAX) fail(422, `The commit title can have at most ${TITLE_MAX} characters.`);
	}
	const link = getLink(pid);
	if (!link) fail(409, 'This project isn’t linked to a GitHub repository.');
	if (link!.status !== 'active' && link!.status !== 'failing') fail(409, 'The GitHub link needs attention before it can sync.');
	return waitFor(requestSync(pid, { kind, trigger: 'manual', title, userId }));
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

/** The first-sync base (T020): GitHub's head with its tree entries (SHA only, no `hash`: no base text yet) restricted
 *  to non-ignored paths that also exist in the project. Diffing against it, project files win where both exist,
 *  GitHub-only files are pulled and identical files stay untouched (FR-008). */
async function firstBase(link: Link): Promise<{ head: string | null; base: BaseMap }> {
	const token = await installationToken(link.installationId);
	const { head } = await branchHead(token, link.repo, link.branch);
	return { head, base: head ? await treeBase(token, link, head) : {} };
}

/** `head`'s tree entries for the non-ignored paths that also exist in the project (see firstBase). */
async function treeBase(token: string, link: Link, head: string): Promise<BaseMap> {
	const base: BaseMap = {};
	const commit = await gh<{ tree: { sha: string } }>(token, 'GET', `/repos/${repoPath(link.repo)}/git/commits/${head}`);
	// ponytail: a truncated tree (over 100 000 entries) is not handled
	const tree = await gh<{
		tree: { path: string; type: string; sha: string }[];
	}>(token, 'GET', `/repos/${repoPath(link.repo)}/git/trees/${commit.tree.sha}?recursive=1`);
	const blobs = tree.tree.filter((e) => e.type === 'blob');
	const project = projectFiles(link.projectId);
	const ignored = ignoreFilter(JSON.parse(link.ignore) as string[], [...blobs.map((e) => e.path), ...project.keys()]);
	for (const e of blobs) if (!ignored(e.path) && project.has(e.path)) base[e.path] = { sha: e.sha };
	return base;
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

/** `POST …/github/create-branch` (owner, T040): the linked branch is gone (`needs-access` with branchGone). Creates it
 *  at the repository's default branch head (`POST git/refs`), sets that as a first-sync base (project files win,
 *  GitHub-only files are pulled later, as on confirm) and pushes the project on top. Without a default branch head
 *  (an empty repository, or one without that branch) the push makes the branch from the project's files alone (the
 *  Contents API seed when empty). A branch that came back meanwhile is used as it is. Waits up to 30 s for the push:
 *  its result, or null. */
export async function createBranch(pid: string, userId: string): Promise<GitHubSyncResult | null> {
	const link = need(pid);
	if (link.status !== 'needs-access' || link.error !== branchGone(link.branch)) fail(409, 'The linked branch isn’t missing.');
	const token = await installationToken(link.installationId);
	let { head } = await branchHead(token, link.repo, link.branch);
	if (!head) {
		const repo = await gh<{ default_branch: string }>(token, 'GET', `/repos/${repoPath(link.repo)}`);
		const from = repo.default_branch && repo.default_branch !== link.branch ? (await branchHead(token, link.repo, repo.default_branch)).head : null;
		if (from) {
			await gh(token, 'POST', `/repos/${repoPath(link.repo)}/git/refs`, { ref: `refs/heads/${link.branch}`, sha: from });
			head = from;
		}
	}
	const base = head ? await treeBase(token, link, head) : {};
	const now = Date.now();
	db()
		.update(githubLinks)
		.set({
			status: 'active',
			baseCommit: head,
			baseFiles: writeBase(base),
			pendingPush: true,
			failCount: 0,
			nextAttemptAt: null,
			error: null,
			note: null,
			lastPullAt: null,
			lastCheckAt: now,
			updatedAt: now
		})
		.where(eq(githubLinks.projectId, pid))
		.run();
	changed(pid);
	return waitFor(requestSync(pid, { kind: 'push', trigger: 'manual', userId }));
}
