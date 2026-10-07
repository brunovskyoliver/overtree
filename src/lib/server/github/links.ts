import { randomUUID } from 'node:crypto';
import { desc, eq, inArray } from 'drizzle-orm';
import { kindForName, limits, validateName } from '../../files.ts';
import type { GitHubLinkInfo, GitHubPreview, GitHubRun, GitHubState, GitHubStatus, GitHubSyncResult, MergeNote } from '../../github-types.ts';
import { broadcast, canEdit, projectRole } from '../access.ts';
import { getServer } from '../collab.ts';
import { editText, fail, FileError, putBlob, textUpdate } from '../files.ts';
import { closeVersion, currentText } from '../history.ts';
import { getProject } from '../projects.ts';
import { applyTree, type TreePlan } from '../restore.ts';
import { files, githubLinks, githubRuns, updates, users } from '../schema.ts';
import { isStarterText } from '../templates.ts';
import { branchExists, branchGone, branchHead, branchPath, checkAccess, findRepo, getAccount, recheckLink, repoPath, type Link } from './accounts.ts';
import { gh, GitHubError, installationToken } from './api.ts';
import { githubConfig } from './config.ts';
import { DEFAULT_IGNORE, ignoreFilter, projectFiles, writeBase, type BaseMap } from './paths.ts';
import { inBatches } from './pull.ts';
import { logWatermark, TITLE_MAX } from './push.ts';
import { catchUp, hasUnpushed, isSyncing, requestSync, type SyncKind } from './sync.ts';

// A project's repository link (012 FR-005–010, data-model "github_links", research R7, R12): status for members,
// link/patch/unlink/confirm for the owner. Route guards check the role; these check the link's own rules.
// Loaded unbundled by server.ts in production: no SvelteKit imports here.

const db = () => getServer().db;
const IGNORE_MAX = 50;
const PATTERN_MAX = 200;
const CONFIRM_WAIT_MS = 60_000;
const SYNC_WAIT_MS = 30_000; // manual push/pull and create-branch answer 202 after this
const RUNS_SHOWN = 20;
const PREVIEW_MAX = 500;

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

/** `PATCH`: new "not pulled" patterns, another branch (back to `pending`, base reset), dismissing the merge note,
 *  after an ownership transfer the new owner taking the link over (`confirmOwner`, FR-027) and/or checking a paused
 *  link's access again ("Check again", `recheck`, research R12). */
export async function patchLink(
	pid: string,
	ownerId: string,
	body: { ignore?: unknown; branch?: unknown; dismissNote?: unknown; confirmOwner?: unknown; recheck?: unknown }
) {
	const link = need(pid);
	if (body.recheck === true) return recheck(link, ownerId);
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
	if (set.status === 'active') catchUp(pid, ownerId);
}

/** "Check again" for a `needs-access` or `needs-reconnect` link: the linker's access is checked again; back → `active`
 *  with its base kept (a missed GitHub edit is merged, not overwritten) and a catch-up sync. Still refused → 409 with
 *  the reason. */
async function recheck(link: Link, ownerId: string) {
	if (link.status !== 'needs-access' && link.status !== 'needs-reconnect') fail(409, 'The link doesn’t need to be checked again.');
	const status = await recheckLink(link);
	if (status === null) fail(409, 'GitHub couldn’t be reached. Try again in a moment.');
	if (status === 'needs-reconnect') fail(409, 'The GitHub connection of the person who linked this project stopped working. They need to reconnect GitHub.');
	if (status === 'needs-access')
		fail(409, `GitHub still refuses access to ${getLink(link.projectId)?.repo ?? link.repo}. Grant the Overtree App access to it, then check again.`);
	if (status === 'active') catchUp(link.projectId, ownerId);
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

type Blob = { path: string; sha: string; size?: number };

/** `head`'s commit (first message line, author) and the files of its tree. */
async function headTree(token: string, link: Link, head: string) {
	const commit = await gh<{ tree: { sha: string }; author: { name: string } | null; message: string }>(
		token,
		'GET',
		`/repos/${repoPath(link.repo)}/git/commits/${head}`
	);
	// ponytail: a truncated tree (over 100 000 entries) is not handled
	const tree = await gh<{ tree: (Blob & { type: string })[] }>(token, 'GET', `/repos/${repoPath(link.repo)}/git/trees/${commit.tree.sha}?recursive=1`);
	const blobs: Blob[] = tree.tree.filter((e) => e.type === 'blob').map(({ path, sha, size }) => ({ path, sha, size }));
	return { author: commit.author?.name ?? 'Unknown', message: commit.message.split('\n')[0], blobs };
}

/** `head`'s tree entries for the non-ignored paths that also exist in the project (see firstBase). */
async function treeBase(token: string, link: Link, head: string): Promise<BaseMap> {
	const base: BaseMap = {};
	const { blobs } = await headTree(token, link, head);
	const project = projectFiles(link.projectId);
	const ignored = ignoreFilter(JSON.parse(link.ignore) as string[], [...blobs.map((e) => e.path), ...project.keys()]);
	for (const e of blobs) if (!ignored(e.path) && project.has(e.path)) base[e.path] = { sha: e.sha };
	return base;
}

/** Whether the project is empty for an import (FR-009): no files, or only the root `main.tex` a template created,
 *  still with the starter text (a new blank project). Folders count as content. */
export function isProjectEmpty(pid: string): boolean {
	const rows = db()
		.select({ id: files.id, parentId: files.parentId, name: files.name, kind: files.kind })
		.from(files)
		.where(eq(files.projectId, pid))
		.all();
	if (!rows.length) return true;
	const [only] = rows;
	if (rows.length > 1 || only.kind !== 'text' || only.parentId !== null || only.name !== 'main.tex') return false;
	return isStarterText(currentText(only.id), getProject(pid)?.title ?? '');
}

/** `GET …/github/preview` (owner, link `pending`; FR-008): what confirming with `merge` does, from the same
 *  comparison: GitHub's head tree against the project's files by git blob SHA, with the "not pulled" patterns over
 *  both sides. Paths only in the project that match a pattern are neither pushed nor listed. */
export async function preview(pid: string): Promise<GitHubPreview> {
	const link = need(pid);
	if (link.status !== 'pending') fail(409, 'The link is already set up.');
	const token = await installationToken(link.installationId);
	const { head } = await branchHead(token, link.repo, link.branch);
	const blobs = head ? (await headTree(token, link, head)).blobs : [];
	const project = projectFiles(pid);
	const ignored = ignoreFilter(JSON.parse(link.ignore) as string[], [...blobs.map((e) => e.path), ...project.keys()]);
	const lists = { overwrite: [] as string[], same: [] as string[], addToGitHub: [] as string[], addToProject: [] as string[], githubOnly: [] as string[] };
	for (const e of blobs) {
		if (ignored(e.path)) lists.githubOnly.push(e.path);
		else if (!project.has(e.path)) lists.addToProject.push(e.path);
		else lists[project.get(e.path)!.sha() === e.sha ? 'same' : 'overwrite'].push(e.path);
	}
	const onGitHub = new Set(blobs.map((e) => e.path));
	for (const path of project.keys()) if (!onGitHub.has(path) && !ignored(path)) lists.addToGitHub.push(path);
	let truncated = false;
	const cap = (l: string[]) => {
		if (l.length > PREVIEW_MAX) truncated = true;
		return l.sort().slice(0, PREVIEW_MAX);
	};
	return {
		head,
		projectEmpty: isProjectEmpty(pid),
		overwrite: cap(lists.overwrite),
		same: cap(lists.same),
		addToGitHub: cap(lists.addToGitHub),
		addToProject: cap(lists.addToProject),
		githubOnly: cap(lists.githubOnly),
		truncated
	};
}

/** A failed first sync: the link stays `pending` with the reason (contracts confirm). */
function setupFailed(pid: string, e: unknown) {
	if (!(e instanceof GitHubError || e instanceof FileError)) return;
	db().update(githubLinks).set({ error: e.message, updatedAt: Date.now() }).where(eq(githubLinks.projectId, pid)).run();
	changed(pid);
}

/** `POST …/github/confirm` (owner, link `pending`). `merge` (T020): sets the first-sync base, makes the link `active`
 *  and requests the first pull and push (trigger `link`), waiting up to 60 s for them. `import` (FR-009): the
 *  branch's files become the project's (see importRepo). A failure keeps the link `pending` with the reason in
 *  `error`. */
export async function confirmLink(pid: string, mode: unknown, userId: string | null = null) {
	const link = need(pid);
	if (mode !== 'merge' && mode !== 'import') fail(422, 'Unknown mode.');
	if (link.status !== 'pending') fail(409, 'The link is already set up.');
	if (mode === 'import') {
		if (!isProjectEmpty(pid)) fail(409, 'Only an empty project can import a repository.');
		try {
			return await importRepo(link, userId);
		} catch (e) {
			setupFailed(pid, e);
			throw e;
		}
	}
	let first: Awaited<ReturnType<typeof firstBase>>;
	try {
		first = await firstBase(link);
	} catch (e) {
		setupFailed(pid, e);
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

/** UTF-8 text, byte for byte (a BOM stays), or null. */
const decodeText = (bytes: Buffer): string | null => {
	try {
		return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		return null;
	}
};

/** `confirm` with `import` (FR-009, US5 #2): the branch head's non-ignored files become the project's files (texts
 *  editable, others as blobs; over the upload limit or with a name Overtree can't use: skipped and noted, like a
 *  pull), the main file is root `main.tex` or else the first root `.tex` with `\documentclass`, and the base is the
 *  head, so the project is in sync with it. The starter `main.tex` of a blank project takes the repository's
 *  `main.tex` text in place (its open editors keep their document), or goes. One `github` version, one `import` run. */
async function importRepo(link: Link, userId: string | null) {
	const pid = link.projectId;
	const startedAt = Date.now();
	const token = await installationToken(link.installationId);
	const { head } = await branchHead(token, link.repo, link.branch);
	if (!head) fail(409, `The branch “${link.branch}” has no files to import.`);
	const { author, message, blobs } = await headTree(token, link, head!);
	const ignored = ignoreFilter(JSON.parse(link.ignore) as string[], blobs.map((e) => e.path));
	const capBytes = limits.uploadMaxFileMb * 1024 * 1024;
	const notes: MergeNote['files'] = [];

	// the tree: folders as needed (keys lower-case, names are unique case-insensitively)
	const folders = new Map<string, string>();
	const taken = new Set<string>();
	const plan: TreePlan = { creates: [], moves: [], binaries: [], deletes: new Set(), main: undefined };
	const wanted: (Blob & { id: string; parentId: string | null; name: string })[] = [];
	const folderFor = (dir: string[]): string | null | undefined => {
		let parentId: string | null = null;
		for (let i = 0; i < dir.length; i++) {
			const key = dir.slice(0, i + 1).join('/').toLowerCase();
			if (taken.has(key)) return undefined; // a file is in the way
			let id = folders.get(key);
			if (!id) {
				id = randomUUID();
				folders.set(key, id);
				plan.creates.push({ id, parentId, name: dir[i], kind: 'folder', hash: null, size: null });
			}
			parentId = id;
		}
		return parentId;
	};
	for (const e of [...blobs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
		if (ignored(e.path)) continue;
		const parts = e.path.split('/');
		const key = e.path.toLowerCase();
		if (parts.some((s) => validateName(s, []) !== null) || taken.has(key) || folders.has(key)) {
			notes.push({ path: e.path, reason: 'skipped-name' });
			continue;
		}
		if ((e.size ?? 0) > capBytes) {
			notes.push({ path: e.path, reason: 'skipped-size' });
			continue;
		}
		const parentId = folderFor(parts.slice(0, -1));
		if (parentId === undefined) {
			notes.push({ path: e.path, reason: 'skipped-name' });
			continue;
		}
		taken.add(key);
		wanted.push({ ...e, id: randomUUID(), parentId, name: parts.at(-1)! });
	}
	if (!wanted.length) fail(409, `The branch “${link.branch}” has no files Overtree can import.`);
	if (plan.creates.length + wanted.length > limits.projectMaxFiles) fail(413, `A project can have at most ${limits.projectMaxFiles} files.`);

	const fetched = new Map<string, Buffer>();
	await inBatches(wanted, async (e) => {
		const blob = await gh<{ content: string }>(token, 'GET', `/repos/${repoPath(link.repo)}/git/blobs/${e.sha}`);
		fetched.set(e.path, Buffer.from(blob.content.replace(/\n/g, ''), 'base64'));
	});
	// someone may have started writing meanwhile
	if (!isProjectEmpty(pid)) fail(409, 'Only an empty project can import a repository.');
	const starter = db().select({ id: files.id }).from(files).where(eq(files.projectId, pid)).get();

	const base: BaseMap = {};
	const newTexts: { id: string; text: string }[] = [];
	let starterText: string | null = null;
	const rootTex: { id: string; name: string; text: string }[] = [];
	for (const e of wanted) {
		const bytes = fetched.get(e.path)!;
		if (bytes.length > capBytes) {
			notes.push({ path: e.path, reason: 'skipped-size' });
			continue;
		}
		const text = kindForName(e.name) === 'text' ? decodeText(bytes) : null;
		base[e.path] = { sha: e.sha, hash: putBlob(bytes) };
		if (text === null) {
			plan.creates.push({ id: e.id, parentId: e.parentId, name: e.name, kind: 'binary', hash: base[e.path].hash!, size: bytes.length });
			continue;
		}
		if (starter && e.path === 'main.tex') {
			e.id = starter.id; // the starter document takes the repository's text
			starterText = text;
		} else {
			plan.creates.push({ id: e.id, parentId: e.parentId, name: e.name, kind: 'text', hash: null, size: null });
			newTexts.push({ id: e.id, text });
		}
		if (e.parentId === null && /\.tex$/i.test(e.name)) rootTex.push({ id: e.id, name: e.name, text });
	}
	if (starter && starterText === null) plan.deletes.add(starter.id);
	plan.main = (rootTex.find((t) => t.name === 'main.tex') ?? rootTex.find((t) => t.text.includes('\\documentclass')))?.id ?? null;

	// new documents' first state before the tree lists them (as in a pull or a zip import)
	const now = Date.now();
	if (newTexts.length) db().insert(updates).values(newTexts.map((t) => ({ docName: t.id, update: textUpdate(t.text), createdAt: now }))).run();
	try {
		applyTree(pid, null, plan);
	} catch (e) {
		if (newTexts.length) db().delete(updates).where(inArray(updates.docName, newTexts.map((t) => t.id))).run();
		throw e;
	}
	if (starter && starterText !== null) {
		const conn = await getServer().hocuspocus.openDirectConnection(starter.id, {});
		try {
			await conn.transact((doc) => editText(doc.getText('content'), starterText!));
		} finally {
			await conn.disconnect();
		}
	}
	const source = { commits: [{ sha: head!, author, message }], notes };
	closeVersion(pid, 'github', { source });
	const note: MergeNote | null = notes.length ? { at: now, commit: head!, files: notes } : null;
	const watermark = logWatermark(pid); // the import is logged as the system: nothing to push
	const finishedAt = Date.now();
	db().transaction((tx) => {
		tx.update(githubLinks)
			.set({
				status: 'active',
				baseCommit: head,
				baseFiles: writeBase(base),
				watermark,
				pendingPush: false,
				failCount: 0,
				nextAttemptAt: null,
				error: null,
				note: note && JSON.stringify(note),
				lastPullAt: finishedAt,
				updatedAt: finishedAt
			})
			.where(eq(githubLinks.projectId, pid))
			.run();
		tx.insert(githubRuns)
			.values({ projectId: pid, kind: 'import', trigger: 'link', userId, result: 'pulled', commit: head, error: null, startedAt, finishedAt })
			.run();
	});
	changed(pid);
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
