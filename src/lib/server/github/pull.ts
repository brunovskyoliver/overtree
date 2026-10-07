import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { diff3Merge } from 'node-diff3';
import { kindForName, limits, validateName } from '../../files.ts';
import type { MergeNote, MergeNoteReason } from '../../github-types.ts';
import type { GitHubSource } from '../../history-types.ts';
import { broadcast } from '../access.ts';
import { getServer } from '../collab.ts';
import { editText, FileError, putBlob, readBlob, textUpdate } from '../files.ts';
import { closeVersion, manifestPaths } from '../history.ts';
import { applyTree, type TreePlan } from '../restore.ts';
import { files, githubLinks, updates } from '../schema.ts';
import { branchHead, repoPath, type Link } from './accounts.ts';
import { gh, GitHubError, installationToken } from './api.ts';
import { ignoreFilter, projectFiles, readBase, writeBase, type BaseMap } from './paths.ts';

// GitHub → Overtree (012 research R6, FR-016–021): the branch head's tree, filtered by the "not pulled" patterns,
// against the stored base map; text files changed on GitHub are merged with diff3 into the live documents (one Yjs
// transaction per file through Hocuspocus, logged as a system edit), tree changes go through restore's applyTree,
// and a `github` version records the result when the project changed.
// The fast path (head = base commit → nothing to do) is only taken once a pull has run since the link was confirmed
// (`last_pull_at` set): confirming leaves GitHub-only files out of the base map, so the first pull diffs the head
// tree against the base map even though head equals the base commit, which brings those files in.
// Loaded unbundled by server.ts in production: no SvelteKit imports here.

const db = () => getServer().db;

export type PullResult = { result: 'pulled' | 'noop'; commit?: string };

const COMMITS_MAX = 20;
const BATCH = 8; // blob downloads in parallel
export const REWRITTEN = 'The branch history was rewritten on GitHub; review and confirm the sync again.';
/** The `needs-access` reason when the linked branch is gone: the popover offers "Create branch" for it (T040). */
export const branchGone = (branch: string) => `The branch “${branch}” no longer exists on GitHub.`;

type GhCommit = { sha: string; commit: { author: { name: string } | null; message: string } };
type TreeEntry = { path: string; type: string; sha: string; size?: number };
type Note = { path: string; reason: MergeNoteReason };

/** Lines with their line breaks, so joining gives the text back (a last line without `\n` stays without). */
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const block = (ls: string[]) => {
	const s = ls.join('');
	return s && !s.endsWith('\n') ? `${s}\n` : s;
};

/** Three-way line merge of `ours` and `theirs` against `base` (research R6). Overlapping changes keep both sides
 *  between LaTeX comment markers, so the file still compiles. */
export function mergeText(ours: string, base: string, theirs: string, shortSha: string): { text: string; overlap: boolean } {
	let overlap = false;
	let text = '';
	for (const region of diff3Merge(lines(ours), lines(base), lines(theirs), { excludeFalseConflicts: true })) {
		if (region.ok) text += region.ok.join('');
		else if (region.conflict) {
			overlap = true;
			// a marker must start on a line of its own
			if (text && !text.endsWith('\n')) text += '\n';
			text += `% <<<<<<< Overtree\n${block(region.conflict.a)}% ======= GitHub ${shortSha}\n${block(region.conflict.b)}% >>>>>>>\n`;
		}
	}
	return { text, overlap };
}

const decode = (bytes: Buffer): string | null => {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
};

/** `fn` over `items`, at most BATCH at a time. */
async function inBatches<T>(items: T[], fn: (item: T) => Promise<void>) {
	for (let i = 0; i < items.length; i += BATCH) await Promise.all(items.slice(i, i + BATCH).map(fn));
}

/** The link back to `pending` with its base reset (edge case "history rewritten", T036). */
function rewritten(pid: string) {
	db()
		.update(githubLinks)
		.set({
			status: 'pending',
			baseCommit: null,
			baseFiles: null,
			watermark: 0,
			pendingPush: false,
			failCount: 0,
			nextAttemptAt: null,
			lastPullAt: null,
			note: null,
			error: REWRITTEN,
			updatedAt: Date.now()
		})
		.where(eq(githubLinks.projectId, pid))
		.run();
	broadcast(pid, { type: 'github' });
	return new GitHubError(409, 'conflict', REWRITTEN);
}

/** Brings GitHub's side of project `link.projectId` into the project (research R6). Throws GitHubError; a rewritten
 *  branch history sets the link back to `pending` first. */
export async function pull(link: Link): Promise<PullResult> {
	const pid = link.projectId;
	const token = await installationToken(link.installationId);
	const api = (path: string) => `/repos/${repoPath(link.repo)}${path}`;
	const { head, empty } = await branchHead(token, link.repo, link.branch);
	const now = Date.now();
	const touch = (set: Partial<Link> = {}) =>
		db()
			.update(githubLinks)
			.set({ lastPullAt: now, ...set })
			.where(eq(githubLinks.projectId, pid))
			.run();

	if (!head) {
		if (!link.baseCommit) {
			touch(); // nothing on GitHub yet (empty repository): the first push creates the branch
			return { result: 'noop' };
		}
		// the branch went away (or the repository was emptied) after a sync
		if (empty) throw new GitHubError(409, 'conflict', 'The GitHub repository was emptied after the last sync.');
		throw new GitHubError(404, 'needs-access', branchGone(link.branch));
	}
	if (head === link.baseCommit && link.lastPullAt !== null) {
		touch();
		return { result: 'noop', commit: head };
	}

	// the commits merged (newest first); a base commit that isn't an ancestor of the head means rewritten history
	const headCommit = await gh<{ tree: { sha: string }; author: { name: string } | null; message: string }>(token, 'GET', api(`/git/commits/${head}`));
	let commits: GitHubSource['commits'] = [{ sha: head, author: headCommit.author?.name ?? 'Unknown', message: headCommit.message.split('\n')[0] }];
	if (link.baseCommit && link.baseCommit !== head) {
		let compare: { status: string; commits?: GhCommit[] };
		try {
			compare = await gh(token, 'GET', api(`/compare/${link.baseCommit}...${head}`));
		} catch (e) {
			if (e instanceof GitHubError && e.status === 404) throw rewritten(pid);
			throw e;
		}
		if (compare.status !== 'ahead' && compare.status !== 'identical') throw rewritten(pid);
		commits = (compare.commits ?? [])
			.slice(-COMMITS_MAX)
			.reverse()
			.map((c) => ({ sha: c.sha, author: c.commit.author?.name ?? 'Unknown', message: c.commit.message.split('\n')[0] }));
	}

	// ponytail: a truncated tree (over 100 000 entries) is not handled
	const tree = await gh<{ tree: TreeEntry[] }>(token, 'GET', api(`/git/trees/${headCommit.tree.sha}?recursive=1`));
	const blobs = tree.tree.filter((e) => e.type === 'blob');
	const base = readBase(link);
	let project = projectFiles(pid);
	const patterns = JSON.parse(link.ignore) as string[];
	const ignored = ignoreFilter(patterns, [...blobs.map((e) => e.path), ...Object.keys(base), ...project.keys()]);
	const theirs = new Map(blobs.filter((e) => !ignored(e.path)).map((e) => [e.path, e]));
	const synced = Object.keys(base).filter((p) => !ignored(p));

	const added = [...theirs.keys()].filter((p) => !base[p]);
	const changed = [...theirs.keys()].filter((p) => base[p] && base[p].sha !== theirs.get(p)!.sha);
	const deleted = synced.filter((p) => !theirs.has(p));
	// only "not pulled" paths changed (the workflow's PDF commit): advance the base commit, nothing else (SC-005)
	if (!added.length && !changed.length && !deleted.length) {
		touch({ baseCommit: head });
		return { result: 'noop', commit: head };
	}

	// --- plan -------------------------------------------------------------------------------------------------------
	const notes: Note[] = [];
	const note = (path: string, reason: MergeNoteReason) => notes.push({ path, reason });
	const capBytes = limits.uploadMaxFileMb * 1024 * 1024;
	const shortSha = head.slice(0, 7);
	const nextBase: BaseMap = {};
	for (const [p, e] of Object.entries(base)) if (ignored(p)) nextBase[p] = e; // neither pushed nor deleted (FR-013)
	for (const [p, e] of theirs) nextBase[p] = base[p]?.sha === e.sha ? base[p] : { sha: e.sha };
	const keepOldBase = (p: string) => {
		if (base[p]) nextBase[p] = base[p];
		else delete nextBase[p];
	};

	// every blob the merge may need, fetched before the project is read: planning and applying the tree then run
	// without a pause in which people could change the tree (ponytail: a renamed file's content is downloaded too)
	const download = async (sha: string) =>
		Buffer.from((await gh<{ content: string }>(token, 'GET', api(`/git/blobs/${sha}`))).content.replace(/\n/g, ''), 'base64');
	const fetched = new Map<string, Buffer | null>(); // path → GitHub's content; null: over the upload limit
	const baseTexts = new Map<string, string>();
	const wanted = [...added, ...changed];
	await inBatches(wanted, async (p) => {
		const e = theirs.get(p)!;
		const bytes = (e.size ?? 0) > capBytes ? null : await download(e.sha);
		fetched.set(p, bytes && bytes.length <= capBytes ? bytes : null);
		const b = base[p];
		// the base text for diff3: stored with the base, or fetched by SHA for entries of the first sync (R6)
		if (b && kindForName(p) === 'text') baseTexts.set(p, (b.hash ? readBlob(b.hash) : await download(b.sha)).toString('utf8'));
	});
	/** GitHub's content of `p` (stored as the next base's text), or null when over the upload limit. */
	const fetchTheirs = (p: string) => {
		const bytes = fetched.get(p);
		if (!bytes) return null;
		nextBase[p] = { sha: theirs.get(p)!.sha, hash: putBlob(bytes) };
		return bytes;
	};

	project = projectFiles(pid); // as it is now, after the downloads
	const rows = db().select().from(files).where(eq(files.projectId, pid)).all();
	const paths = manifestPaths(rows);
	// taken paths, case-insensitive like file names (validateName)
	const byLower = new Map<string, { id: string; kind: string }>(rows.map((r) => [paths.get(r.id)!.toLowerCase(), r]));
	const plan: TreePlan = { creates: [], moves: [], binaries: [], deletes: new Set(), main: undefined };
	const newTexts: { id: string; text: string }[] = [];
	const merges: { id: string; path: string; base: string; theirs: string }[] = [];
	const leaving = new Set<string>(); // folders that may end up empty (parents of files GitHub moved or deleted)

	/** The folder for `path`'s parent, created in the plan as needed; undefined when a file is in the way. */
	const folderFor = (path: string): string | null | undefined => {
		const parts = path.split('/').slice(0, -1);
		let parentId: string | null = null;
		for (let i = 0; i < parts.length; i++) {
			const key = parts.slice(0, i + 1).join('/').toLowerCase();
			const row = byLower.get(key);
			if (row) {
				if (row.kind !== 'folder') return undefined;
				parentId = row.id;
				continue;
			}
			const id = randomUUID();
			plan.creates.push({ id, parentId, name: parts[i], kind: 'folder', hash: null, size: null });
			byLower.set(key, { id, kind: 'folder' });
			parentId = id;
		}
		return parentId;
	};
	const validPath = (path: string) => path.split('/').every((s) => validateName(s, []) === null);
	const parentOf = (id: string) => rows.find((r) => r.id === id)?.parentId ?? null;

	/** A file GitHub has at `p` that the project doesn't: created (folders as needed). */
	const create = (p: string) => {
		if (!validPath(p) || byLower.has(p.toLowerCase())) {
			note(p, 'skipped-name');
			keepOldBase(p);
			return;
		}
		const bytes = fetchTheirs(p);
		if (!bytes) {
			note(p, 'skipped-size');
			keepOldBase(p);
			return;
		}
		const parentId = folderFor(p);
		if (parentId === undefined) {
			note(p, 'skipped-name');
			keepOldBase(p);
			return;
		}
		const name = p.slice(p.lastIndexOf('/') + 1);
		const text = kindForName(name) === 'text' ? decode(bytes) : null;
		const id = randomUUID();
		if (text !== null) {
			plan.creates.push({ id, parentId, name, kind: 'text', hash: null, size: null });
			newTexts.push({ id, text });
		} else plan.creates.push({ id, parentId, name, kind: 'binary', hash: putBlob(bytes), size: bytes.length });
		byLower.set(p.toLowerCase(), { id, kind: text !== null ? 'text' : 'binary' });
	};

	/** GitHub's `p` differs from the base (or is new on both sides): merged into the project's file. */
	const update = (p: string) => {
		const ours = project.get(p)!;
		const theirSha = theirs.get(p)!.sha;
		if (ours.sha() === theirSha) return; // same change on both sides
		if (ours.kind === 'binary') {
			if (base[p] && ours.sha() === base[p].sha) {
				const bytes = fetchTheirs(p);
				if (!bytes) {
					note(p, 'skipped-size');
					keepOldBase(p);
					return;
				}
				plan.binaries.push({ id: ours.id, hash: putBlob(bytes), size: bytes.length });
			} else note(p, 'kept-binary'); // Overtree's version stays and goes up with the next push (US3 #6)
			return;
		}
		const bytes = fetchTheirs(p);
		if (!bytes) {
			note(p, 'skipped-size');
			keepOldBase(p);
			return;
		}
		merges.push({ id: ours.id, path: p, base: baseTexts.get(p) ?? '', theirs: bytes.toString('utf8') });
	};

	// exact-content renames: a path deleted and one added with the same blob (ponytail: edited + renamed = delete + add)
	const movedFrom = new Set<string>();
	const movedTo = new Set<string>();
	for (const from of deleted) {
		const ours = project.get(from);
		const to = added.find((a) => theirs.get(a)!.sha === base[from].sha && !movedTo.has(a));
		if (!ours || !to || !validPath(to)) continue; // handled as delete + add below
		const taken = byLower.get(to.toLowerCase());
		if (taken && taken.id !== ours.id) continue;
		const parentId = folderFor(to);
		if (parentId === undefined) continue;
		plan.moves.push({ id: ours.id, parentId, name: to.slice(to.lastIndexOf('/') + 1) });
		byLower.delete(from.toLowerCase());
		byLower.set(to.toLowerCase(), { id: ours.id, kind: ours.kind });
		const old = parentOf(ours.id);
		if (old) leaving.add(old);
		movedFrom.add(from);
		movedTo.add(to);
	}

	for (const p of added) {
		if (movedTo.has(p)) continue;
		if (project.has(p)) update(p);
		else create(p);
	}
	for (const p of changed) {
		if (project.has(p)) update(p);
		else create(p); // deleted in Overtree, changed on GitHub: GitHub's change comes back (nothing dropped)
	}
	for (const p of deleted) {
		if (movedFrom.has(p)) continue;
		const ours = project.get(p);
		if (!ours) continue;
		if (ours.sha() !== base[p].sha) {
			note(p, 'kept-deleted'); // Overtree's change wins over GitHub's delete (US3 #5)
			continue;
		}
		plan.deletes.add(ours.id);
		const old = parentOf(ours.id);
		if (old) leaving.add(old);
	}

	// folders emptied by GitHub's deletes and moves go too, innermost first
	const moved = new Map(plan.moves.map((m) => [m.id, m.parentId]));
	const finalParent = (r: { id: string; parentId: string | null }) => (moved.has(r.id) ? moved.get(r.id)! : r.parentId);
	for (let more = true; more; ) {
		more = false;
		for (const f of leaving) {
			const keeps =
				rows.some((r) => !plan.deletes.has(r.id) && finalParent(r) === f) || plan.creates.some((c) => c.parentId === f);
			leaving.delete(f);
			if (keeps || plan.deletes.has(f)) continue;
			plan.deletes.add(f);
			const up = parentOf(f);
			if (up) leaving.add(up);
			more = true;
		}
	}

	// --- apply ------------------------------------------------------------------------------------------------------
	closeVersion(pid, 'edit'); // Overtree's edits so far stay a version of their own; the merge is the next one
	// new documents' first state before the tree lists them (an editor opening one at once loads it), like an import
	if (newTexts.length) db().insert(updates).values(newTexts.map((t) => ({ docName: t.id, update: textUpdate(t.text), createdAt: now }))).run();
	let treeChanged = false;
	try {
		treeChanged = applyTree(pid, null, plan);
	} catch (e) {
		if (newTexts.length) db().delete(updates).where(inArray(updates.docName, newTexts.map((t) => t.id))).run();
		if (e instanceof FileError) throw new GitHubError(e.status, 'conflict', `GitHub’s changes don’t fit in the project: ${e.message}`);
		throw e;
	}

	let textChanged = false;
	for (const m of merges) {
		// read ours and write the merge in one transaction: collaborators' updates apply before or after, never between
		const conn = await getServer().hocuspocus.openDirectConnection(m.id, {});
		try {
			await conn.transact((doc) => {
				const t = doc.getText('content');
				const ours = t.toString();
				const r = mergeText(ours, m.base, m.theirs, shortSha);
				if (r.overlap) note(m.path, 'overlap');
				if (r.text !== ours) {
					editText(t, r.text);
					textChanged = true;
				}
			});
		} finally {
			await conn.disconnect();
		}
	}

	const projectChanged = treeChanged || textChanged;
	if (projectChanged) closeVersion(pid, 'github', { source: { commits, notes } });
	const differs = notes.some((n) => n.reason === 'overlap' || n.reason === 'kept-deleted' || n.reason === 'kept-binary');
	const mergeNote: MergeNote | null = notes.length ? { at: now, commit: head, files: notes } : null;
	touch({
		baseCommit: head,
		baseFiles: writeBase(nextBase),
		...(differs ? { pendingPush: true } : {}),
		...(mergeNote ? { note: JSON.stringify(mergeNote) } : {}),
		updatedAt: now
	});
	if (mergeNote) broadcast(pid, { type: 'github' });
	return { result: projectChanged || notes.length ? 'pulled' : 'noop', commit: head };
}
